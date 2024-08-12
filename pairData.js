const fs = require('fs');
const csv = require('csv-parser');

const csvFile = 'pair_data.csv';
const interval = 10 * 60 * 1000; // 10 minute in milliseconds

const pairConfigs = [
    { targetId: '0x2760cc828b2e4d04f8ec261a5335426bb22d9291', rangeName: 'Aggressive', heading: 'WBTC-ETH 1%', volatilityPair: 'ETH-BTC' },
    { targetId: '0x30afbcf9458c3131a6d051c621e307e6278e4110', rangeName: 'Aggressive', heading: 'ETH-USDC 2%', volatilityPair: 'ETH-USDC' },
    { targetId: '0x6ce9bc2d8093d32adde4695a4530b96558388f7e', rangeName: 'Aggressive', heading: 'ETH-ARB 2%', volatilityPair: 'ETH-ARB' },
    { targetId: '0xee5f2e39d8abf28e449327bfd44317fc500eb4d8', rangeName: 'Aggressive', heading: 'ARB-USDC 2%', volatilityPair: 'ARB-USDC' },
    { targetId: '0x05ba720fc96ea8969f86d7a0b0767bb8dc265232', rangeName: 'Aggressive', heading: 'ZRO-ETH 2%', volatilityPair: 'ZRO-ETH' },
];

function readAndSaveLpAprEWMA() {
    const timestamp = new Date().toISOString();
    const csvData = [timestamp];

    fs.readFile('rewards/lpApr_data.csv', 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading CSV file:', err);
            return;
        }

        const rows = data.trim().split('\n');
        const headers = rows[0].split(',');

        const targetColumns = [
            'WBTC-ETH 1%',
            'ETH-USDC 2%',
            'ETH-ARB 2%',
            'ARB-USDC 2%',
            'ZRO-ETH 2%'
        ];

        targetColumns.forEach((column) => {
            const columnIndex = headers.findIndex((header) => header === column);

            if (columnIndex !== -1) {
                const aprValues = rows.slice(1).map((row) => parseFloat(row.split(',')[columnIndex]));
                const aprValuesLast1h = aprValues.slice(-6); // Assuming 10-minute interval data

                // Calculate EWMA of APR values over the last 1 hour
                let ewmaApr = aprValuesLast1h[0];
                const alpha = 0.4;

                for (let i = 1; i < aprValuesLast1h.length; i++) {
                    ewmaApr = alpha * aprValuesLast1h[i] + (1 - alpha) * ewmaApr;
                }

                csvData.push(ewmaApr.toFixed(2));

                // Find the corresponding volatility pair config
                const volatilityPairConfig = pairConfigs.find((config) => config.heading === column);

                if (volatilityPairConfig) {
                    const { volatilityPair } = volatilityPairConfig;

                    // Calculate price range volatility for the pair
                    calculatePriceChangeEWMA(volatilityPair, 0.2, (error, averageVolatility) => {
                        if (error) {
                            console.error('Error calculating volatility:', error);
                        } else {
                            csvData.push(averageVolatility);

                            if (csvData.length === targetColumns.length * 2 + 1) {
                                const csvRow = csvData.join(',') + '\n';

                                fs.appendFile(csvFile, csvRow, (err) => {
                                    if (err) {
                                        console.error('Error writing to CSV file:', err);
                                    } else {
                                        console.log(`Data appended to ${csvFile}`);
                                    }
                                });
                            }
                        }
                    });
                } else {
                    console.log(`No volatility pair config found for column: ${column}`);
                }
            } else {
                csvData.push('');
                console.log(`Column "${column}" not found in the CSV file`);
            }
        });
    });
}

function calculatePriceChangeEWMA(pair, alpha, callback) {
    const returns = [];
    const timestamps = [];
    // const logStream = fs.createWriteStream(`${pair}_volatility.log`, { flags: 'a' });

    fs.createReadStream('./prices/prices.csv')
        .pipe(csv())
        .on('data', (data) => {
            const timestamp = new Date(data.Timestamp);
            const currentTime = new Date();
            const timeDiff = (currentTime - timestamp) / (1000 * 60); // Time difference in minutes

            if (timeDiff <= 240 && timestamp.getMinutes() % 10 === 0) { //4h, every 10m
                const ethPrice = parseFloat(data.ETH);
                const arbPrice = parseFloat(data.ARB);
                const usdcPrice = 1; // Assuming USDC is stable at 1 USD
                const btcPrice = parseFloat(data.BTC);
                const zroPrice = parseFloat(data.ZRO)

                let pairPrice;
                switch (pair) {
                    case 'ETH-ARB':
                        pairPrice = ethPrice / arbPrice;
                        break;
                    case 'ARB-USDC':
                        pairPrice = arbPrice / usdcPrice;
                        break;
                    case 'ETH-USDC':
                        pairPrice = ethPrice / usdcPrice;
                        break;
                    case 'ETH-BTC':
                        pairPrice = ethPrice / btcPrice;
                        break;
                    case 'ZRO-ETH':
                        pairPrice = ethPrice / zroPrice;
                        break;
                    default:
                        callback(new Error('Invalid pair specified'));
                        // logStream.end();
                        return;
                }

                if (!isNaN(pairPrice)) {
                    returns.push(pairPrice);
                    timestamps.push(data.Timestamp);
                }
            }
        })
        .on('end', () => {
            if (returns.length < 2) {
                callback(new Error('Insufficient data points'));
                // logStream.end();
                return;
            }

            const volatilities = [];
            for (let i = 1; i < returns.length; i++) {
                const volatility = Math.pow(Math.log(returns[i] / returns[i - 1]), 2);
                volatilities.push(volatility);
                // const logMessage = `Timestamp: ${timestamps[i]}, Pair: ${pair}, Volatility: ${volatility}\n`;
                // logStream.write(logMessage);
            }

            let ewma = volatilities[0];
            // logStream.write(`Timestamp: ${timestamps[1]}, Pair: ${pair}, Initial EWMA: ${ewma}\n`);

            for (let i = 1; i < volatilities.length; i++) {
                ewma = alpha * volatilities[i] + (1 - alpha) * ewma;
                // const logMessage = `Timestamp: ${timestamps[i + 1]}, Pair: ${pair}, Updated EWMA: ${ewma}\n`;
                // logStream.write(logMessage);
            }

            const finalVolatility = Math.sqrt(ewma) * 1000;
            // const logMessage = `Timestamp: ${timestamps[timestamps.length - 1]}, Pair: ${pair}, Final Volatility: ${finalVolatility}\n`;
            // logStream.write(logMessage);

            // logStream.end(() => {
            callback(null, finalVolatility.toFixed(6));
            // });
        });
}

// Check if the CSV file exists
fs.access(csvFile, fs.constants.F_OK, (err) => {
    if (err) {
        // File doesn't exist, create it with the header row
        const headers = [
            'Timestamp',
            ...pairConfigs.map((config) => `${config.heading} APR`),
            ...pairConfigs.map((config) => `${config.volatilityPair} Volatility`)
        ];
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
readAndSaveLpAprEWMA();

// Set up the interval to run the function every minute
setInterval(readAndSaveLpAprEWMA, interval);