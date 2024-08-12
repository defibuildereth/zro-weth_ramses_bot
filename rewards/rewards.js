const https = require('https');
const fs = require('fs');

const url = 'https://kingdom-api-backups.s3.amazonaws.com/ramses_mixed-pairs.json';
const csvFile = 'lpApr_data.csv';
const interval = 10 * 60 * 1000; // 1 hour in milliseconds

const pairConfigs = [
  { targetId: '0x2760cc828b2e4d04f8ec261a5335426bb22d9291', rangeName: 'Aggressive', heading: 'WBTC-ETH 1%' },
  { targetId: '0x2d4bfb17db454cf582a74902c91fb09a3883a5cc', rangeName: 'Aggressive', heading: 'weETH-ETH 1-tick' },
  { targetId: '0x562d29b54d2c57f8620c920415c4dceadd6de2d2', rangeName: 'Aggressive', heading: 'USDC.e-USDC 1-tick' },
  { targetId: '0x30afbcf9458c3131a6d051c621e307e6278e4110', rangeName: 'Aggressive', heading: 'ETH-USDC 2%' },
  { targetId: '0x30afbcf9458c3131a6d051c621e307e6278e4110', rangeName: 'Insane', heading: 'ETH-USDC 1-tick' },
  { targetId: '0x2ed095289b2116d7a3399e278d603a4e4015b19d', rangeName: 'Aggressive', heading: 'wstETH-ETH 1-tick' },
  { targetId: '0x6ce9bc2d8093d32adde4695a4530b96558388f7e', rangeName: 'Aggressive', heading: 'ETH-ARB 2%' },
  { targetId: '0xee5f2e39d8abf28e449327bfd44317fc500eb4d8', rangeName: 'Aggressive', heading: 'ARB-USDC 2%' },
  { targetId: '0x05ba720fc96ea8969f86d7a0b0767bb8dc265232', rangeName: 'Aggressive', heading: 'ZRO-ETH 2%' },
];

function fetchAndSaveLpApr() {
  https.get(url, (response) => {
    let data = '';

    response.on('data', (chunk) => {
      data += chunk;
    });

    response.on('end', () => {
      const jsonData = JSON.parse(data);
      const pairs = jsonData.pairs;
      const timestamp = new Date().toISOString();
      const csvData = [timestamp];

      pairConfigs.forEach((config) => {
        const { targetId, rangeName, heading } = config;
        const targetPair = pairs.find((pair) => pair.id === targetId);

        if (targetPair) {
          const recommendedRanges = targetPair.recommendedRangesNew;
          const targetRange = recommendedRanges.find((range) => range.name === rangeName);

          if (targetRange) {
            const lpApr = targetRange.lpApr;
            csvData.push(lpApr);
          } else {
            csvData.push('');
            console.log(`No "${rangeName}" range found for pair with id: ${targetId}`);
          }
        } else {
          csvData.push('');
          console.log(`No pair found with id: ${targetId}`);
        }
      });

      const csvRow = csvData.join(',') + '\n';

      fs.appendFile(csvFile, csvRow, (err) => {
        if (err) {
          console.error('Error writing to CSV file:', err);
        } else {
          console.log(`Data appended to ${csvFile}`);
        }
      });
    });
  }).on('error', (error) => {
    console.error('Error:', error.message);
  });
}

// Check if the CSV file exists
fs.access(csvFile, fs.constants.F_OK, (err) => {
  if (err) {
    // File doesn't exist, create it with the header row
    const headers = ['Timestamp', ...pairConfigs.map((config) => config.heading)];
    const headerRow = headers.join(',') + '\n';

    fs.writeFile(csvFile, headerRow, (err) => {
      if (err) {
        console.error('Error creating CSV file:', err);
      } else {
        console.log(`CSV file ${csvFile} created.`);
      }
    });
  } else {
    console.log(`CSV file ${csvFile} already exists. Appending data...`);
  }
});

// Run the function initially
fetchAndSaveLpApr();

// Set up the interval to run the function every hour
setInterval(fetchAndSaveLpApr, interval);