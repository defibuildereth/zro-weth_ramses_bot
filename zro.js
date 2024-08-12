require('dotenv').config();
const ethers = require('ethers');
const { Web3 } = require('web3');
const fs = require('fs');
const csv = require('csv-parser');

let currentNft = null;
let lastTrade = null;
let limit = 1 * 60;

//thresholds
const minApr = 400;
const maxVolatility = 2;

const logFile = fs.createWriteStream('zro.log', { flags: 'a' });

const originalLog = console.log;
console.log = (...args) => {
    const logMessage = args.map(arg => {
        if (typeof arg === 'object') {
            return JSON.stringify(arg, null, 2);
        }
        return arg;
    }).join(' ');

    originalLog(...args);
    logFile.write(logMessage + '\n');
};

const { managerContractABI, poolContractABI, erc20ABI } = require("./ABIs.js");

const { getCurrentTimestampPlus30x, sleep, bigNumToReadable, readableToBigNum } = require("./utils.js")

let privateKey = process.env.PRIVATE_KEY;
let arbitrumAlchemyApiKey = process.env.ARBITRUM_ALCHEMY_KEY;

const chainId = 42161; // 
const web3RpcUrl = 'https://arb1.arbitrum.io/rpc';
const broadcastApiUrl = "https://api.1inch.dev/tx-gateway/v1.1/" + chainId + "/broadcast";
const apiBaseUrl = "https://api.1inch.dev/swap/v6.0/" + chainId;
const web3 = new Web3(web3RpcUrl);
const headers = { headers: { Authorization: `Bearer ${process.env.INCH_API_KEY}`, accept: "application/json" } };

const managerContractAddress = '0xaa277cb7914b7e5514946da92cb9de332ce610ef';
const poolContractAddress = '0x05ba720fc96ea8969f86d7a0b0767bb8dc265232';
const zroTokenAddress = '0x6985884c4392d348587b19cb9eaaf157f13271cd';
const nullAddress = '0x0000000000000000000000000000000000000000'
const wethTokenAddress = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
const weirdString = '0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff'
const ramTokenAddress = '0xAAA6C1E32C55A7Bfa8066A6FAE9b42650F262418';
const arbTokenAddress = '0x912ce59144191c1204e64559fe8253a0e49e6548';

const alchemyProvider = new ethers.providers.AlchemyProvider("arbitrum", arbitrumAlchemyApiKey);
const signer = new ethers.Wallet(privateKey, alchemyProvider);
const walletAddress = signer.address;

const managerContract = new ethers.Contract(managerContractAddress, managerContractABI, signer);
const poolContract = new ethers.Contract(poolContractAddress, poolContractABI, signer);
const zroTokenContract = new ethers.Contract(zroTokenAddress, erc20ABI, signer);
const wethTokenContract = new ethers.Contract(wethTokenAddress, erc20ABI, signer);

function apiRequestUrl(methodName, queryParams) {
    return apiBaseUrl + methodName + "?" + new URLSearchParams(queryParams).toString();
}

async function broadCastRawTransaction(rawTransaction) {
    return fetch(broadcastApiUrl, {
        method: "post",
        body: JSON.stringify({ rawTransaction }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.INCH_API_KEY}` },
    })
        .then((res) => res.json())
        .then((res) => {
            return res.transactionHash;
        });
}

async function signAndSendTransaction(transaction) {
    const { rawTransaction } = await web3.eth.accounts.signTransaction(transaction, privateKey);

    return await broadCastRawTransaction(rawTransaction);
}

async function buildTxForSwap(swapParams) {
    const url = apiRequestUrl("/swap", swapParams);
    console.log(url)
    // Fetch the swap transaction details from the API
    return fetch(url, headers)
        .then((res) => res.json())
        .then((res) => res.tx);
}

async function getBalance(address, tokenContract, decimals) {
    try {
        let balanceBN = await tokenContract.balanceOf(address)
        let balance = Number(bigNumToReadable(balanceBN, decimals))
        return { bigNum: balanceBN, readable: balance }
    }
    catch (err) {
        console.log('error getBalance: ', err)
    }
}

async function removePosition(dec, positions) {
    try {
        const decreaseLiquidityCall = managerContract.interface.encodeFunctionData("decreaseLiquidity", [
            {
                tokenId: dec,
                liquidity: positions[7],
                amount0Min: 0,
                amount1Min: 0,
                deadline: getCurrentTimestampPlus30x(),
            },
        ]);
        const collectParams = {
            tokenId: dec,
            recipient: nullAddress,
            amount0Max: weirdString,
            amount1Max: weirdString,
        };
        const collectCall = managerContract.interface.encodeFunctionData("collect", [collectParams]);
        const sweepTokenCallWbtc = managerContract.interface.encodeFunctionData("sweepToken", [zroTokenAddress, nullAddress, walletAddress])
        const sweepTokenCallWeth = managerContract.interface.encodeFunctionData("sweepToken", [wethTokenAddress, nullAddress, walletAddress])
        const getRewardCall = managerContract.interface.encodeFunctionData("getReward", [dec, [ramTokenAddress, arbTokenAddress]])
        const burnCall = managerContract.interface.encodeFunctionData("burn", [dec]);
        const calls = [decreaseLiquidityCall, collectCall, sweepTokenCallWbtc, sweepTokenCallWeth, getRewardCall, burnCall]
        const result = await managerContract.multicall(calls);
        currentNft = null;
        console.log('hash of removePosition: ', result.hash);
        await sleep(4000)
    }
    catch (err) {
        console.log('error removePosition: ', err)
    }
}

async function tradeTokens(trade) {
    try {
        let swapParams;
        if (trade.sell === 'quote') {
            // selling quote asset (in this case WETH)
            swapParams = {
                fromTokenAddress: wethTokenAddress,
                toTokenAddress: zroTokenAddress,
                amount: readableToBigNum(trade.amount.toFixed(6)),
                fromAddress: walletAddress,
                slippage: 1, // Maximum acceptable slippage percentage for the swap (e.g., 1 for 1%)
                disableEstimate: false, // Set to true to disable estimation of swap details
                allowPartialFill: false, // Set to true to allow partial filling of the swap order
                // includeProtocols: true,
            };
        } else if (trade.sell === 'base') {
            swapParams = {
                fromTokenAddress: zroTokenAddress,
                toTokenAddress: wethTokenAddress,
                amount: readableToBigNum(trade.amount.toFixed(6)),
                fromAddress: walletAddress,
                slippage: 1, // Maximum acceptable slippage percentage for the swap (e.g., 1 for 1%)
                disableEstimate: false, // Set to true to disable estimation of swap details
                allowPartialFill: false, // Set to true to allow partial filling of the swap order
                // includeProtocols: true,
            };
        }
        console.log(swapParams)
        const swapTransaction = await buildTxForSwap(swapParams);
        await sleep(2000)
        console.log(JSON.stringify(swapTransaction, null, 2));
        const swapTxHash = await signAndSendTransaction(swapTransaction);
        console.log("Swap tx hash: ", swapTxHash);
        lastTrade = getCurrentTimestampPlus30x();
        return swapTxHash;
    } catch (err) {
        console.log('error tradeTokens: ', err)
    }
}

async function addPosition(rangeProportionPrice) {
    await sleep(4000)
    let tickLower = rangeProportionPrice.tickLower
    let tickUpper = rangeProportionPrice.tickUpper
    let zroBalance = await getBalance(walletAddress, zroTokenContract);
    let wethBalance = await getBalance(walletAddress, wethTokenContract);
    console.log(zroBalance, wethBalance)
    if (zroBalance.readable > 100 && wethBalance.readable > 0.1) {
        try {
            let addLiq = await managerContract.mint([
                zroTokenAddress,
                wethTokenAddress,
                10000,
                tickLower,
                tickUpper,
                zroBalance.bigNum.mul(999).div(1000),
                wethBalance.bigNum.mul(999).div(1000),
                0,
                0,
                walletAddress,
                getCurrentTimestampPlus30x(),
                0
            ], { gasLimit: 1000000 }
            )
            console.log('added liquidity, hash: ', addLiq.hash)
        }
        catch (err) {
            console.log('error adding liq', err)
        }
    }
}

async function tradeAndAddPosition(rangeProportionPrice) {
    console.log('tradeTokens time state: ', getCurrentTimestampPlus30x(), lastTrade)

    if (!lastTrade || ((getCurrentTimestampPlus30x() - lastTrade) > limit)) { // if a trade hasn't yet been made, or lastTrade was more than an hour ago
        let zroBalance = await getBalance(walletAddress, zroTokenContract)
        let wethBalance = await getBalance(walletAddress, wethTokenContract);
        console.log('calling figureOutTrade: ,', wethBalance.readable, zroBalance.readable, rangeProportionPrice.price, rangeProportionPrice.proportion);
        let trade = figureOutTrade(wethBalance.readable, zroBalance.readable, rangeProportionPrice.price, rangeProportionPrice.proportion);
        console.log(trade)
        let tradeWorked = await tradeTokens(trade);
        if (tradeWorked) {
            await sleep(4000)
            await addPosition(rangeProportionPrice);
        }
    }
    else {
        console.log('too much trading going on, chill')
        const waitTime = 3600 - (getCurrentTimestampPlus30x() - lastTrade);
        await sleep(waitTime);
    }
}

function rangeFinder(price, multi) {
    function findX(priceDec, multiplier) {
        // console.log('findX: ', priceDec, multiplier)
        const x = Math.ceil(Math.log(priceDec) / Math.log(multiplier));
        return x;
    }

    function calculateProportions(lower, upper, price) {
        let totalRange = upper - lower;
        let rangeAbove = upper - price;
        let proportionAbove = rangeAbove / totalRange;
        proportionAbove = Math.max(0.2, Math.min(0.8, proportionAbove));
        return proportionAbove;
    }

    let sqrtPriceDec = price[0] * 2 ** -96
    let priceRaw = sqrtPriceDec ** 2;
    const multiplier = multi;

    const x = findX(priceRaw, multiplier)
    // console.log('x', x)
    const topRange = (Math.ceil(x / 200) * 200) + 200;
    const bottomRange = topRange - 600;
    // console.log(bottomRange, topRange)

    const upperPriceBound = multiplier ** topRange;
    const lowerPriceBound = multiplier ** bottomRange;
    // console.log(lowerPriceBound, upperPriceBound, )
    const proportion = calculateProportions(lowerPriceBound, upperPriceBound, priceRaw)
    // console.log(proportion)
    return { lowerPriceBound: lowerPriceBound, upperPriceBound: upperPriceBound, tickLower: bottomRange, tickUpper: topRange, price: priceRaw, proportion: proportion }
}

function checkZroEthConditions(X, Y) {
    return new Promise((resolve, reject) => {
        const results = [];

        fs.createReadStream('pair_data.csv')
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => {
                if (results.length === 0) {
                    reject(new Error('No data found in CSV file'));
                    return;
                }

                // Get the latest entry (last row)
                const latestData = results[results.length - 1];

                // Check if the timestamp is within the last hour
                const timestamp = new Date(latestData.Timestamp);
                const currentTime = new Date();
                const timeDifference = currentTime - timestamp;
                const oneHourInMilliseconds = 60 * 60 * 1000;

                if (timeDifference > oneHourInMilliseconds) {
                    resolve({ condition: false, reason: 'Data is stale (older than 1 hour)', apr: null, volatility: null });
                    return;
                }

                const zroEthApr = parseFloat(latestData['ZRO-ETH 2% APR']);
                const zroEthVolatility = parseFloat(latestData['ZRO-ETH Volatility']);

                const aprCondition = zroEthApr > X;
                const volatilityCondition = zroEthVolatility < Y;
                const condition = aprCondition && volatilityCondition;

                let reason;
                if (condition) {
                    reason = 'All conditions met';
                } else if (!aprCondition && !volatilityCondition) {
                    reason = 'APR too low and volatility too high';
                } else if (!aprCondition) {
                    reason = 'APR too low';
                } else {
                    reason = 'Volatility too high';
                }

                resolve({
                    condition,
                    reason,
                    apr: zroEthApr,
                    volatility: zroEthVolatility
                });
            })
            .on('error', (error) => reject(error));
    });
}

async function runCheck() {
    try {
        const result = await checkZroEthConditions(minApr, maxVolatility);
        console.log(`Time: ${new Date().toLocaleString()}, Condition met: ${result.condition}, Reason: ${result.reason}, APR: ${result.apr}, Volatility: ${result.volatility}`);
        if (result.condition) {
            // only if conditions are good for a new position..
            // check if nft, if yes, check (extended) range. if not, tradeAndTakePosition
            await checkPosition();
        }
    } catch (error) {
        console.error('Error checking conditions:', error);
    }
}

async function checkPosition() {
    try {
        let nft = await checkIfNft(walletAddress);
        if (nft) {
            let inRange = await isInRange(nft);
            console.log(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), inRange.inRange)
            if (!inRange.inRange) {
                await removePosition(nft, inRange.positions)
                await sleep(4000)
                await tradeAndAddPosition(inRange.rangeProportionPrice)
            }
        } else {
            let inRange = await isInRange();
            console.log(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), inRange.inRange)
            await tradeAndAddPosition(inRange.rangeProportionPrice)
        }
    } catch (err) {
        console.log('error in checkPosition', err)
    }
}

async function checkIfNft(address) {
    if (!currentNft) {
        try {
            console.log('calling to check NFT')
            let position = await managerContract.tokenOfOwnerByIndex(address, 0)
            // console.log(call)
            let dec = (bigNumToReadable(position) * 10 ** 18)
            currentNft = dec
            return currentNft
        }
        catch (err) {
            if (err.reason == 'EnumerableSet: index out of bounds') {
                return false
            }
        }
    } else {
        return currentNft
    }
}

async function isInRange(nft) {
    let price = await poolContract.slot0()
    let priceTick = price.tick
    let rangeProportionPrice = rangeFinder(price, 1.0001)
    // console.log(rangeProportionPrice)
    if (nft) {
        let inRange;
        let positions = await managerContract.positions(nft)
        // console.log('positions:', positions)
        if (price.tick >= (positions[5] - 200) && price.tick <= (positions[6] + 200)) { // checking extended range
            inRange = true;
        } else {
            inRange = false;
        }
        return { inRange: inRange, positions: positions, rangeProportionPrice: rangeProportionPrice, priceTick: priceTick }
    } else {
        return { rangeProportionPrice: rangeProportionPrice }
    }

}

function figureOutTrade(quoteTokenBalance, baseTokenBalance, quoteTokensPerBaseSoldPrice, proportion) {
    console.log(quoteTokenBalance, baseTokenBalance, quoteTokensPerBaseSoldPrice, proportion)
    // first we price the whole wallet value in terms of the quote token (in this case WETH)
    const totalQuoteTokens = (baseTokenBalance * quoteTokensPerBaseSoldPrice) + quoteTokenBalance;
    // console.log(totalQuoteTokens)
    // then, we figure out how much value we want (in terms of the quote token), above the current price (but within the current tick)
    const desiredQuoteTokensAbove = totalQuoteTokens * proportion;
    // console.log(desiredQuoteTokensAbove)
    // then, we translate that value into the base tokens we want above the current price
    const desiredBaseTokensAbove = desiredQuoteTokensAbove / quoteTokensPerBaseSoldPrice;
    // console.log(desiredBaseTokensAbove)
    // then we subtract the number of base tokens we already have to find the difference..
    const tradeAmount = desiredBaseTokensAbove - baseTokenBalance;
    // console.log(tradeAmount)
    if (tradeAmount < 0) {
        return { sell: "base", amount: -tradeAmount }
    } else {
        return { sell: "quote", amount: tradeAmount * quoteTokensPerBaseSoldPrice }
    }
}

// Run immediately once
runCheck();

// Then run every 10 minutes
setInterval(runCheck, 10 * 60 * 1000);