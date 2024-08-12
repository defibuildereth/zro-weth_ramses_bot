const ethers = require('ethers');
const fs = require('fs');
const csv = require('csv-parser');

function calculateAveragePriceRangeVolatility(pair, callback) {
    const prices = [];
  
    fs.createReadStream('./prices/prices.csv')
      .pipe(csv())
      .on('data', (data) => {
        const ethPrice = parseFloat(data.ETH);
        const arbPrice = parseFloat(data.ARB);
        const usdcPrice = 1; // Assuming USDC is stable at 1 USD
        const btcPrice = parseFloat(data.BTC);
  
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
          default:
            callback(new Error('Invalid pair specified'));
            return;
        }
  
        prices.push(pairPrice);
      })
      .on('end', () => {
        const volatilities = [];
  
        // Calculate price range volatility for 24 hours
        const initialPrice24h = prices[0];
        const range24h = (Math.max(...prices) - Math.min(...prices)) / initialPrice24h * 100;
        console.log(`24h Price Range Volatility (${pair}):`, range24h.toFixed(2) + '%');
        volatilities.push(range24h);
  
        // Calculate price range volatility for 6 hours
        const prices6h = prices.slice(-360); // Assuming 1 minute interval, 6 hours = 360 data points
        const initialPrice6h = prices6h[0];
        const range6h = (Math.max(...prices6h) - Math.min(...prices6h)) / initialPrice6h * 100;
        console.log(`6h Price Range Volatility (${pair}):`, range6h.toFixed(2) + '%');
        volatilities.push(range6h);
  
        // Calculate price range volatility for 1 hour
        const prices1h = prices.slice(-60); // Assuming 1 minute interval, 1 hour = 60 data points
        const initialPrice1h = prices1h[0];
        const range1h = (Math.max(...prices1h) - Math.min(...prices1h)) / initialPrice1h * 100;
        console.log(`1h Price Range Volatility (${pair}):`, range1h.toFixed(2) + '%');
        volatilities.push(range1h);
  
        // Calculate the average of the volatilities
        const averageVolatility =
          volatilities.reduce((sum, volatility) => sum + volatility, 0) /
          volatilities.length;
  
        callback(null, averageVolatility);
      })
      .on('error', (error) => {
        callback(error);
      });
  }

function readableToBigNum(readableNumber, decimals = false) {
    if (!decimals) {
        return ethers.utils.parseUnits(readableNumber.toString(), 18)
    } else {
        return ethers.utils.parseUnits(readableNumber.toString(), decimals)
    }
}

function bigNumToReadable(bigNum, decimals = false) {
    if (!decimals) {
        return Number(ethers.utils.formatUnits(bigNum, 18))
    } else {
        return Number(ethers.utils.formatUnits(bigNum, decimals))
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getCurrentTimestampPlus30x() {
    var currentTimeInMillis = new Date().getTime();
    var futureTimeInMillis = currentTimeInMillis + (60 * 1000); // 30 seconds in milliseconds
    return Math.floor(futureTimeInMillis / 1000);
}

function figureOutTrade(quoteTokenBalance, baseTokenBalance, quoteTokensPerBaseSoldPrice, proportion) {
    const totalQuoteTokens = (baseTokenBalance * quoteTokensPerBaseSoldPrice) + quoteTokenBalance;
    const desiredQuoteTokensAbove = totalQuoteTokens * proportion;
    const desiredBaseTokensAbove = desiredQuoteTokensAbove * quoteTokensPerBaseSoldPrice;
    const tradeAmount = desiredBaseTokensAbove - baseTokenBalance;
    if (tradeAmount < 0) {
        const baseTokenSell = -tradeAmount * quoteTokensPerBaseSoldPrice
        return { sell: "base", amount: baseTokenSell }
    } else {
        return { sell: "quote", amount: tradeAmount }
    }
}

function rangeFinder(price) {
    function findX(priceDec, multiplier) {
        const x = Math.ceil(Math.log(priceDec) / Math.log(multiplier));
        return x;
    }

    function calculateProportions(lower, upper, price) {
        let totalRange = upper - lower;
        let rangeAbove = upper - price;
        let proportionAbove = rangeAbove / totalRange;
        proportionAbove = Math.max(0.1, Math.min(0.9, proportionAbove));
        return proportionAbove;
    }
    

    let sqrtPriceDec = price[0] * 2 ** -96
    let priceDec = sqrtPriceDec ** 2
    const multiplier = 1.0005;

    const x = findX(priceDec, multiplier)
    const topRange = (x* 5)
    const bottomRange = topRange - 5;

    const upperPriceBound = multiplier**x;
    const lowerPriceBound = multiplier**(x-1)
    const proportion = calculateProportions(lowerPriceBound, upperPriceBound, priceDec)
    return { lowerPriceBound: lowerPriceBound, upperPriceBound: upperPriceBound, tickLower: bottomRange, tickUpper: topRange, price: priceDec, proportion: proportion}
}

async function getBalance(address, tokenContract) {
    try {
        let balanceBN = await tokenContract.balanceOf(address)
        let balance = Number(bigNumToReadable(balanceBN, 18))
        return { bigNum: balanceBN, readable: balance }
    }
    catch (err) {
        console.log('error getBalance: ', err)
    }
}

module.exports = {calculateAveragePriceRangeVolatility, getBalance, rangeFinder, figureOutTrade, getCurrentTimestampPlus30x, sleep, bigNumToReadable, readableToBigNum}