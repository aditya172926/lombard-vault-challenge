import { Log } from "ethers";
import { LogResult } from "./interface";

export async function getBtcPrice(): Promise<number> {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.bitcoin.usd;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to fetch BTC price: ${error.message}`);
        }
        throw new Error('Failed to fetch BTC price: Unknown error');
    }
}

export async function getPastBlockNumber(
    chainId: number
): Promise<number> {
    try {
        const fourteenDaysAgoTs = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;
        const etherscan_api = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=block&action=getblocknobytime&timestamp=${fourteenDaysAgoTs}&closest=before&apikey=${process.env.ETHERSCAN_API_KEY}`
        const res = await fetch(etherscan_api);
        if (!res.ok) {
            throw new Error(`Etherscan HTTP error: ${res.status}`);
        }

        const data = await res.json();
        if (data.status !== "1") {
            throw new Error(`Etherscan API error: ${data.message}`);
        }
        const pastBlockNumber = Number(data.result);
        return pastBlockNumber;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to fetch past block number: ${error.message}`);
        }
        throw new Error('Failed to fetch past block number: Unknown error');
    }
}

export async function fetchLogs(
    chainId: number,
    address: string,
    topic: string,
    fromBlock: number,
    toBlock: number
): Promise<LogResult[]> {
    try {
        const etherscan_api = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=logs&action=getLogs&address=${address}&fromBlock=${fromBlock}&toBlock=${toBlock}&topic0=${topic}&page=1&offset=1&apikey=${process.env.ETHERSCAN_API_KEY}`;
        const res = await fetch(etherscan_api);
        if (!res.ok) {
            throw new Error(`Etherscan HTTP error: ${res.status}`);
        }

        const data = await res.json();
        if (data.status !== "1") {
            throw new Error(`Etherscan API error: ${data.message}`);
        }
        return data.result;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to fetch logs: ${error.message}`);
        }
        throw new Error('Failed to fetch logs: Unknown error');
    }
}