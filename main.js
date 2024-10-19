const puppeteer = require('puppeteer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// Helper function to delay execution
const delay = (time) => new Promise(resolve => setTimeout(resolve, time));

(async () => {
    const browser = await puppeteer.launch({
    headless: "new", // Make sure it runs in headless mode
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Optional: avoid memory issues
        '--disable-gpu', // Optional: disable GPU acceleration
    ],
});

    const urlsToScrape = [
        'https://www.propertyfinder.eg/en/search?c=1&t=1&pt=1500000&fu=0&ob=mr',
        // Add more URLs as needed
    ];

    const scrapePropertyData = async (url, browser) => {
        let retries = 3; // Retry logic for better resilience
        let propertyPage;

        while (retries > 0) {
            try {
                propertyPage = await browser.newPage();
                await propertyPage.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
                
                let transaction_type = '';

                if (url.includes('sale')) {
                    transaction_type = 'sale';
                } else if (url.includes('rent')) {
                    transaction_type = 'rent';
                }

                await propertyPage.waitForSelector('script#__NEXT_DATA__');

                const propertyData = await propertyPage.evaluate((transaction_type) => {
                    const scriptTag = document.querySelector('script#__NEXT_DATA__');
                    let propertyDetails = {};

                    if (scriptTag) {
                        const jsonData = JSON.parse(scriptTag.innerText);
                        const property = jsonData.props.pageProps.propertyResult.property;

                        const characteristics = {};
                        const characteristicsContainer = document.querySelector('.styles_desktop_list__Kq7ZK');
                        if (characteristicsContainer) {
                            const items = characteristicsContainer.querySelectorAll('.styles_desktop_list__item__lF_Fh');
                            items.forEach(item => {
                                const label = item.querySelector('.styles_desktop_list__label-text__0YJ8y')?.innerText.trim();
                                const value = item.querySelector('.styles_desktop_list__value__uIdMl')?.innerText.trim();
                                if (label && value) {
                                    characteristics[label] = value;
                                }
                            });
                        }

                        const amenities = [];
                        const amenitiesContainer = document.querySelector('.styles_amenity__container__kL4sm');
                        if (amenitiesContainer) {
                            const items = amenitiesContainer.querySelectorAll('.styles_amenity__c2P5u');
                            items.forEach(item => {
                                const amenity = item.querySelector('p.styles_text__IlyiW')?.innerText.trim();
                                if (amenity) {
                                    amenities.push(amenity);
                                }
                            });
                        }

                        propertyDetails = {
                            name: property.title,
                            address: property.location.full_name,
                            price: property.price.value,
                            description: property.description,
                            area: property.size.value,
                            propertyType: property.property_type,
                            transactionType: transaction_type,
                            latitude: property.location.coordinates.lat,
                            longitude: property.location.coordinates.lon,
                            propertyUrl: property.share_url,
                            characteristics: characteristics,
                            amenities: amenities
                        };
                    }

                    return propertyDetails;
                }, transaction_type);

                await propertyPage.close();
                return propertyData;
            } catch (error) {
                retries--;
                console.error(`Error scraping property data: ${error}. Retries left: ${retries}`);
                await delay(3000); // Delay before retrying
            } finally {
                if (propertyPage) {
                    await propertyPage.close();
                }
            }
        }
        return null; // Return null if all retries fail
    };

    const saveToExcel = (data, url) => {
        const formattedData = data.map(property => {
            return {
                ...property,
                characteristics: JSON.stringify(property.characteristics), // Convert object to JSON string
                amenities: property.amenities.join(', ') // Convert array to comma-separated string
            };
        });

        const ws = xlsx.utils.json_to_sheet(formattedData);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, "Properties");

        const sanitizedFileName = url.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.xlsx';
        const outputDirectory = path.join(__dirname, 'output');

        // Ensure the output directory exists
        if (!fs.existsSync(outputDirectory)) {
            fs.mkdirSync(outputDirectory);
        }

        const filePath = path.join(outputDirectory, sanitizedFileName);
        xlsx.writeFile(wb, filePath);
        console.log(`Data saved to ${filePath}`);
    };

    for (const url of urlsToScrape) {
        console.log(`Scraping URL: ${url}`);

        try {
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 600000 });

            const numberOfPropertiesResult = await page.evaluate(() => {
                const span = document.querySelector('span[aria-label="Search results count"]');
                if (span) {
                    const propertiesText = span.innerText;
                    const numberOfProperties = parseInt(propertiesText.replace(/,/g, '').split(' ')[0]);
                    return {
                        spanText: span.innerText,
                        numberOfProperties: numberOfProperties
                    };
                }
                return { spanText: null, numberOfProperties: null };
            });

            const numberOfProperties = numberOfPropertiesResult.numberOfProperties;

            if (numberOfProperties !== null) {
                console.log(`Number of properties: ${numberOfProperties}`);

                const totalPages = Math.ceil(numberOfProperties / 27);
                console.log(`Total number of pages: ${totalPages}`);

                let allPropertyUrls = [];

                for (let i = 1; i <= totalPages; i++) {
                    try {
                        await page.goto(`${url}&page=${i}`, { waitUntil: 'networkidle2', timeout: 600000 });
                        await page.waitForSelector('a.link-module_link__TaDrq.styles_desktop_gallery-item-wrapper__OW7RH');

                        const propertyUrls = await page.evaluate(() => {
                            return Array.from(document.querySelectorAll('a.link-module_link__TaDrq.styles_desktop_gallery-item-wrapper__OW7RH'))
                                .map(link => link.href);
                        });

                        console.log(`Page ${i}: Found ${propertyUrls.length} property URLs`);
                        allPropertyUrls = allPropertyUrls.concat(propertyUrls);
                    } catch (error) {
                        console.error(`Error navigating to page ${i}: ${error}`);
                    }
                }

                console.log(`Total number of property URLs: ${allPropertyUrls.length}`);

                let scrapedData = [];

                for (const propertyUrl of allPropertyUrls) {
                    console.log(`Visiting: ${propertyUrl}`);
                    const data = await scrapePropertyData(propertyUrl, browser);
                    if (data) {
                        console.log(data);
                        scrapedData.push(data);
                    }
                }

                saveToExcel(scrapedData, url);
            } else {
                console.log('Span element not found');
            }

            await page.close();
        } catch (error) {
            console.error(`Error processing URL ${url}: ${error}`);
        }
    }

    await browser.close();
})();
