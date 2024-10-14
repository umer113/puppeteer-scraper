const puppeteer = require("puppeteer");
const fs = require("fs");
const XLSX = require("xlsx");
const path = require("path");

(async () => {
    const cookiesPath = "cookies.json";
    const properties = []; // Array to hold all property details
    const baseUrls = [
        'https://www.infocasas.com.bo/alquiler'
    ];

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36",
        ],
        defaultViewport: null,
    });

    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
    });

    if (fs.existsSync(cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
        await page.setCookie(...cookies);
        console.log("Cookies loaded.");
    }

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        Object.defineProperty(navigator, "platform", { get: () => "Win32" });
        Object.defineProperty(navigator, "plugins", {
            get: () => [
                {
                    description: "Portable Document Format",
                    filename: "internal-pdf-viewer",
                    length: 1,
                    name: "Chrome PDF Plugin",
                },
                {
                    description: "Portable Document Format",
                    filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
                    length: 1,
                    name: "Chrome PDF Viewer",
                },
            ],
        });
        Object.defineProperty(navigator, "languages", {
            get: () => ["en-US", "en"],
        });
    });

    try {
        for (const baseUrl of baseUrls) {
            await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 0 });

            // Extract total number of pages
            const totalPages = await page.evaluate(() => {
                const paginationLinks = Array.from(document.querySelectorAll('ul.search-results-pagination li a.ant-pagination-item-link'));

                if (paginationLinks.length > 0) {
                    // Extract the page numbers from the href attributes
                    const pageNumbers = paginationLinks.map(link => {
                        const href = link.getAttribute('href');
                        const match = href.match(/pagina(\d+)/);
                        return match ? parseInt(match[1], 10) : null;
                    }).filter(num => num !== null);

                    // Return the maximum page number found, which should be the last page
                    return Math.max(...pageNumbers);
                }

                return 1; // Default to 1 if no pagination links are found
            });

            console.log(`Total pages: ${totalPages}`);

            const propertyUrls = new Set();
            for (let i = 1; i <= totalPages; i++) {
                console.log(`Scraping page ${i} of ${baseUrl}...`);
                await page.goto(`${baseUrl}/pagina${i}`, { waitUntil: 'networkidle2', timeout: 0 });

                const urls = await page.evaluate(() => {
                    const anchors = Array.from(document.querySelectorAll('a.lc-cardCover'));
                    return anchors.map(anchor => anchor.href);
                });

                urls.forEach(url => propertyUrls.add(url));
            }

            console.log(`Total unique property URLs for ${baseUrl}: ${propertyUrls.size}`);

            let count = 1

            for (const url of propertyUrls) {

                const ipUrlPattern = /^https?:\/\/\d+\.\d+\.\d+\.\d+/;
                if (ipUrlPattern.test(url)) {
                    console.log(`Skipping IP URL: ${url}`);
                    continue;  // Skip this URL and move to the next one
                }
                console.log(`Scraping property at URL: ${url}`);
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

                const propertyDetails = await page.evaluate((url) => {
                    const name = document.querySelector('meta[property="og:title"]')?.content || '';
                    const description = document.querySelector('.ant-typography.property-description')?.innerText || '';
                    const addressElements = Array.from(document.querySelectorAll('.property-location-tag p'));
                    const address = addressElements.map(p => p.innerText.trim()).join(', ') || '';
                
                    let price = document.querySelector('.ant-typography.price strong')?.innerText || '';
                
                    const geoJson = document.querySelector('script[type="application/ld+json"]')?.innerText || '{}';
                    const geo = JSON.parse(geoJson).object?.geo || {};
                    const latitude = geo.latitude || '';
                    const longitude = geo.longitude || '';
                
                    // Extract details as key-value pairs from the technical sheet
                    const detailRows = Array.from(document.querySelectorAll('.jsx-952467510.technical-sheet .ant-row'));
                    const details = {};
                    let propertyType = ''; // Variable to hold the property type
                    let area = ''; // Variable to hold the M² edificados
                
                    detailRows.forEach(row => {
                        const keyElement = row.querySelector('.ant-space-item span.ant-typography:not(.ant-typography-secondary)');
                        const valueElement = row.querySelector('strong') || row.querySelector('span:not(.ant-typography-secondary)');
                
                        const key = keyElement?.innerText?.trim();
                        const value = valueElement?.innerText?.trim();
                
                        if (key && value) {
                            details[key] = value;
                
                            // Check if this key is 'Tipo de Propiedad' to extract the property type
                            if (key === 'Tipo de Propiedad') {
                                propertyType = value;
                            }
                
                            // Check if this key is 'M² edificados' to extract the area
                            if (key === 'M² edificados') {
                                area = value;
                            }
                        }
                    });
                
                    // Transaction type
                    let transactionType = '';
                    const transactionElement = document.querySelector('.ant-typography.ant-typography-secondary.operation_type');
                    if (transactionElement && transactionElement.innerText.includes('Venta')) {
                        transactionType = 'sale';
                    } else {
                        transactionType = 'rent';
                    }
                
                    if (price == '') {
                        price = 'ask';
                    }
                
                    return {
                        url,
                        name,
                        description,
                        address,
                        price,
                        propertyType,
                        area, // include the area
                        transactionType,
                        latitude,
                        longitude,
                        details // include scraped details
                    };
                }, url);

                // Flatten the details object and merge with the main property object
                const flattenedDetails = Object.assign({}, propertyDetails.details);
                const completeDetails = { ...propertyDetails, ...flattenedDetails };
                delete completeDetails.details; // Remove the nested details

                console.log(completeDetails);
                properties.push(completeDetails);
                console.log("count: ", count)
                count++;// Push flattened details to properties array
            }

            // Ensure the output directory exists
            const outputDir = path.join(__dirname, 'output');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir);
            }

            // Create an Excel workbook and add the data
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(properties);

            // Create a range for the headers and set them to bold
            const range = XLSX.utils.decode_range(worksheet['!ref']);
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell = worksheet[XLSX.utils.encode_cell({ r: 0, c: C })];
                if (cell && cell.s) {
                    cell.s = {
                        font: {
                            bold: true,
                        }
                    };
                }
            }

            XLSX.utils.book_append_sheet(workbook, worksheet, "Properties");

            // Generate a safe filename from the base URL
            const safeUrl = baseUrl.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const outputPath = path.join(outputDir, `${safeUrl}.xlsx`);

            // Save the Excel file in the output directory
            XLSX.writeFile(workbook, outputPath);
            console.log(`Data saved to ${outputPath}`);
        }

        // Save cookies after the session
        const cookies = await page.cookies();
        fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
        console.log("Cookies saved.");
    } catch (error) {
        console.error("Error during scraping:", error);
    } finally {
        // Close the browser
        await browser.close();
    }
})();
