### Setup

1. From prices subdirectory, run `node prices.js` (by default uses last 4h of data)
2. From rewards subdirectory, run `node rewards.js`
3. From main directory, run `node pairData.js`
4. Set thresholds (lines 12 and 13 or zro.js)
5. Approve 1inch to spend ZRO and WETH
6. Run `node zro.js`

Notes: will leave any position in until both:
1. Position is > 2% out of range
2. Volatility is < threshold level

Requires 1inch API key, coingecko api key and alchemy. 