const axios = require('axios');
const fs = require('fs');
const csvWriter = require('csv-writer').createObjectCsvWriter;
require('dotenv').config({ path: '../.env' });

const coingeckoApiKey = process.env.COINGECKO_API_KEY;
// console.log(coingeckoApiKey)

const binanceSymbols = ['ARBUSDT', 'ETHUSDT', 'BTCUSDT'];
const csvFile = 'prices.csv';

const writer = csvWriter({
  path: csvFile,
  header: [
    { id: 'timestamp', title: 'Timestamp' },
    { id: 'ARB', title: 'ARB' },
    { id: 'ETH', title: 'ETH' },
    { id: 'BTC', title: 'BTC' },
    { id: 'ZRO', title: 'ZRO' },
  ],
});

async function getBinancePrices() {
  try {
    const prices = {};
    for (const symbol of binanceSymbols) {
      const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
      prices[symbol.slice(0, -4)] = parseFloat(response.data.price);
    }
    return prices;
  } catch (error) {
    console.error('Error fetching Binance prices:', error);
    return null;
  }
}

async function getZROPrice() {
  try {
    const url = 'https://api.coingecko.com/api/v3/coins/layerzero';
    const options = {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'x-cg-demo-api-key': coingeckoApiKey
      }
    };
    const response = await axios.get(url, options);
    return response.data.market_data.current_price.usd;
  } catch (error) {
    console.error('Error fetching ZRO price:', error);
    return null;
  }
}

async function storePrices() {
  const binancePrices = await getBinancePrices();
  const zroPrice = await getZROPrice();
  
  if (binancePrices && zroPrice !== null) {
    const data = {
      timestamp: new Date().toISOString(),
      ...binancePrices,
      ZRO: zroPrice,
    };
    writer.writeRecords([data])
      .then(() => console.log('Prices stored successfully'))
      .catch((error) => console.error('Error storing prices:', error));
  } else {
    console.error('Failed to fetch all prices');
  }
}

setInterval(storePrices, 60000);