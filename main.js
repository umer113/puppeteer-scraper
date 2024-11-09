const puppeteer = require('puppeteer-core');
const puppeteerExtra = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const ExcelJS = require('exceljs');

puppeteerExtra.use(stealthPlugin());

// Function to introduce a delay
function delay(time) {
  return new Promise(function(resolve) {
    setTimeout(resolve, time);
  });
}

// Function to extract the total number of listings
async function extractTotalListings(page) {
  await page.waitForSelector('.flex');

  const totalListings = await page.evaluate(() => {
    const element = document.querySelector('.flex p b');
    return element ? parseInt(element.innerText.trim()) : 0;
  });

  return totalListings;
}

// Function to remove HTML tags from a string
function removeHTMLTags(text) {
  return text.replace(/<[^>]*>?/gm, '').replace(/\s\s+/g, ' ').trim();
}

// Function to extract data from the property URL
async function extractPropertyData(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Add a delay of 3 seconds to mimic human behavior
    await delay(3000);

    await page.waitForSelector('#__NEXT_DATA__');

    const propertyData = await page.evaluate(() => {
      const scriptTag = document.querySelector('#__NEXT_DATA__');
      const jsonData = JSON.parse(scriptTag.innerHTML);
      return jsonData.props.pageProps.initialState.objectView.object;
    });

    const characteristics = await page.evaluate(() => {
      const characteristicsObj = {};
      const characteristicSection = document.querySelector('section.bg-white.flex.flex-wrap.md\\:p-6.my-4.rounded-md ul');
      if (characteristicSection) {
        const items = characteristicSection.querySelectorAll('li');
        items.forEach(item => {
          const keyElement = item.querySelector('span.text-basic');
          const valueElement = item.querySelector('p');
          if (keyElement && valueElement) {
            const key = keyElement.innerText.trim();
            const value = valueElement.innerText.trim();
            characteristicsObj[key] = value;
          }
        });
      }
      return characteristicsObj;
    });

    const transactionType = url.includes('sale') ? 'Sale' : 'Rent';

    // Extract the property type
    const propertyType = await page.evaluate(() => {
      const spanElement = document.querySelector('span[itemprop="name"]');
      return spanElement ? spanElement.innerText.trim() : '';
    });

    // Extract the property name from the meta tag
    const propertyName = await page.evaluate(() => {
      const metaTag = document.querySelector('meta[property="og:title"]');
      return metaTag ? metaTag.content : '';
    });

    // Extract the description, first try from the earlier selector, then fall back to the meta tag
    let cleanDescription = removeHTMLTags(propertyData.description || '');
    if (!cleanDescription) {
      const metaDescription = await page.evaluate(() => {
        const metaTag = document.querySelector('meta[property="og:description"]');
        return metaTag ? metaTag.content : '';
      });
      cleanDescription = metaDescription;
    }

    return {
      name: propertyName,
      address: propertyData.address || '',
      price_in_$: propertyData.priceRates ? propertyData.priceRates['840'] : '',
      price_in_ruble: propertyData.priceRates ? propertyData.priceRates['933'] : '',
      description: cleanDescription,
      area: propertyData.areaTotal || '',
      longitude: propertyData.location ? propertyData.location[0] : '',
      latitude: propertyData.location ? propertyData.location[1] : '',
      propertyType: propertyType,  // Use the extracted property type here
      transactionType: transactionType,
      characteristics: characteristics || '',
      url: url
    };
  } catch (error) {
    console.error(`Failed to scrape property data from ${url}: ${error.message}`);
    return null;
  }
}

// Function to create an Excel file and save the data
async function saveToExcel(data, url) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Properties');

  worksheet.columns = [
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Address', key: 'address', width: 30 },
    { header: 'price_in_$', key: 'price_in_$', width: 15 },
    { header: 'price_in_ruble', key: 'price_in_ruble', width: 15 },
    { header: 'Description', key: 'description', width: 50 },
    { header: 'Area', key: 'area', width: 10 },
    { header: 'Longitude', key: 'longitude', width: 15 },
    { header: 'Latitude', key: 'latitude', width: 15 },
    { header: 'Property Type', key: 'propertyType', width: 20 },
    { header: 'Transaction Type', key: 'transactionType', width: 20 },
    { header: 'Characteristics', key: 'characteristics', width: 50 },
    { header: 'URL', key: 'url', width: 50 }
  ];

  data.forEach(item => {
    if (item) {
      worksheet.addRow(item);
    }
  });

    const fileName = `output/${url.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.xlsx`;
    await workbook.xlsx.writeFile(fileName);
    console.log(`Data saved to ${fileName}`);

}

// Main function to handle the scraping process
(async () => {
const browser = await puppeteerExtra.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
  const page = await browser.newPage();

  const urls = [
    'https://realt.by/rent/offices/',
    // Add more URLs here
  ];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      const totalListings = await extractTotalListings(page);
      console.log(`Total listings found: ${totalListings}`);

      const totalPages = Math.ceil(totalListings / 30); // Assuming 30 listings per page
      console.log(`Total pages to scrape: ${totalPages}`);

      const allPropertyUrls = [];

      // Iterate through all pages
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const pageUrl = `${url}&page=${pageNum}`;
        try {
          await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          await page.waitForSelector('.p-0.bg-white.block');

          const propertyUrls = await page.evaluate(() => {
            const listings = document.querySelectorAll('.p-0.bg-white.block a.z-1');
            const urlSet = new Set(); // Initialize a new Set to store URLs
          
            Array.from(listings).forEach(listing => {
              urlSet.add(listing.href); // Add each URL to the Set
            });
          
            return Array.from(urlSet); // Convert the Set back to an Array and return
          });

          console.log(`Found ${propertyUrls.length} properties on page ${pageNum}`);
          allPropertyUrls.push(...propertyUrls);
        } catch (error) {
          console.error(`Failed to load page ${pageUrl}: ${error.message}`);
        }
      }

      console.log(`Total properties found: ${allPropertyUrls.length}`);

      const allPropertyData = [];
      let count = 1
      for (const propertyUrl of allPropertyUrls) {
        const data = await extractPropertyData(page, propertyUrl);
        console.log(`Scraping ${count} of total ${allPropertyUrls.length}`)
        if (data) {
          allPropertyData.push(data);
          count+=1
        }
      }

      await saveToExcel(allPropertyData, url);
    } catch (error) {
      console.error(`Failed to process URL ${url}: ${error.message}`);
    }
  }

  await browser.close();
})();
