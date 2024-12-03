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


async function extractPricePerM(page) {
  try {
    const pricePerM = await page.evaluate(() => {
      // Select all elements matching the target class
      const priceElements = document.querySelectorAll('h2.!inline-block.mr-1.lg\\:text-h2Lg.text-h2.font-raleway.font-bold.flex.items-center');
      
      // Ensure the third element exists
      if (priceElements.length >= 3) {
        return priceElements[2].innerText.trim(); // Extract text from the third element
      }
      return null; // Return null if the third element is not present
    });

    return pricePerM;
  } catch (error) {
    console.error(`Failed to extract price/m²: ${error.message}`);
    return null;
  }
}



// Function to extract features in key-value pairs
async function extractFeatures(page) {
  try {
    const features = await page.evaluate(() => {
      const featureObj = {};
      const featureContainer = document.querySelector('.flex.flex-wrap.md\\:justify-start.-mt-6.md\\:mb-0.order-2.mb-6');

      if (featureContainer) {
        const featureItems = featureContainer.querySelectorAll('div.last\\:mr-0.pt-6.mr-10');
        featureItems.forEach(item => {
          const valueElement = item.querySelector('div.text-h3.font-raleway.font-bold');
          const keyElement = item.querySelector('p.mt-0\\.5.md\\:mt-1.text-basic');
          if (valueElement && keyElement) {
            const key = keyElement.innerText.trim();
            const value = valueElement.innerText.trim();
            featureObj[key] = value;
          }
        });
      }

      return featureObj;
    });

    return features;
  } catch (error) {
    console.error(`Failed to extract features: ${error.message}`);
    return {};
  }
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
      const jsonData = scriptTag ? JSON.parse(scriptTag.innerHTML) : {};
      return jsonData.props?.pageProps?.initialState?.objectView?.object || {};
    });

// characteristics

    const transactionType = url.includes('sale') ? 'Sale' : 'Rent';


    const features = await extractFeatures(page);

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

    // Extract price in ruble and USD if not found in JSON
    let priceInRuble = propertyData.priceRatesPerM2?.['933'] || '';
    let priceInUSD = propertyData.priceRatesPerM2?.['840'] || '';

    const pricePerM = await extractPricePerM(page);

    let area = features['Площадь'] || '-'
    let propertyType = features['Тип'] || '-'


    console.log(propertyData)
    return {
      name: propertyName,
      address: propertyData.address || '',
      price_in_$: priceInUSD,
      price_in_ruble: priceInRuble,
      pricePerM:  pricePerM,
      description: cleanDescription,
      area: area || '',
      longitude: propertyData.location ? propertyData.location[0] : '',
      latitude: propertyData.location ? propertyData.location[1] : '',
      propertyType: propertyType, // Use the extracted property type here
      transactionType: transactionType,
      characteristics: characteristics || '',
      features: features || '-',
      url: url
    };
  } catch (error) {
    console.error(`Failed to scrape property data from ${url}: ${error.message}`);
    return null;
  }
}
// Function to create an Excel file and save the data
async function saveToExcel(data, outputDir) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Properties');

  worksheet.columns = [
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Address', key: 'address', width: 30 },
    { header: 'price_in_$', key: 'price_in_$', width: 15 },
    { header: 'price_in_ruble', key: 'price_in_ruble', width: 15 },
    { header: 'Price per m²', key: 'pricePerM', width: 15 },
    { header: 'Description', key: 'description', width: 50 },
    { header: 'Area', key: 'area', width: 10 },
    { header: 'Longitude', key: 'longitude', width: 15 },
    { header: 'Latitude', key: 'latitude', width: 15 },
    { header: 'Property Type', key: 'propertyType', width: 20 },
    { header: 'Transaction Type', key: 'transactionType', width: 20 },
    { header: 'Characteristics', key: 'characteristics', width: 50 },
    { header: 'Features', key: 'features', width: 50 },
    { header: 'URL', key: 'url', width: 50 }
  ];

  data.forEach(item => {
    if (item) {
      worksheet.addRow(item);
    }
  });

  const filePath = path.join(outputDir, 'properties.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log(`Data saved to ${filePath}`);
}
// Main function to handle the scraping process
(async () => {
 const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    protocolTimeout: 120000, // Increase timeout to 2 minutes
});

  const page = await browser.newPage();

  const urls = [
    'https://realt.by/rent/offices/?addressV2=%5B%7B%22stateDistrictUuid%22%3A%22495ebec0-7b00-11eb-8943-0cc47adabd66%22%7D%5D&page=1&townDistanceV2To=10',
    // Add more URLs here
  ];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

      const totalListings = await extractTotalListings(page);
      console.log(`Total listings found: ${totalListings}`);

      const totalPages = Math.ceil(totalListings / 30); // Assuming 30 listings per page
      console.log(`Total pages to scrape: ${totalPages}`);

      const allPropertyUrls = [];

      // Iterate through all pages
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const pageUrl = `${url}?page=${pageNum}`;
        try {
          await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 0 });
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
        console.log(data)
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
