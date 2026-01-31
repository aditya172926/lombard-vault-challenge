import "dotenv/config";
import { Contract, ContractTransactionReceipt, ContractTransactionResponse, formatUnits, Interface, isAddress, JsonRpcProvider, Network, Wallet } from "ethers";
import BTCeAbi from "./abis/BTCe.json";
import ERC20Abi from "./abis/ERC20.json";
import LBTCvAbi from "./abis/LBTCv.json";
import LAccountantAbi from "./abis/Lombard_Accountant.json";
import TellerAbi from "./abis/Teller.json";
import { LOMBARD_BTCE_CONTRACT_ADDRESS } from "./constants";
import { EVMContract, TokenBalanceData, VaultDetails } from "./interface";
import { getBtcPrice } from "./service";

enum TransactionStatus {
    SUCCESS = 1,
    FAIL
}

function setup_wallet(): Wallet {
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) throw new Error("Missing Rpc url in environment");

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("Missing private key in environment");

    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);
    return wallet;
}

async function callContractMethod<T>(
    contract: Contract,
    methodName: string,
    ...args: any[]
): Promise<T> {
    const fn = contract[methodName];
    if (!fn) throw new Error(`Function ${methodName} not found on contract`);
    return await fn(...args);
}

async function sendContractMethod(
    contract: Contract,
    methodName: string,
    ...args: any[]
): Promise<ContractTransactionReceipt> {
    const fn = contract[methodName];
    if (!fn) throw new Error(`Function ${methodName} not found on contract`);

    const txn: ContractTransactionResponse = await fn(...args);
    const receipt = await txn.wait();
    if (!receipt) throw new Error(`Failed to get transaction receipt ${txn.hash}`);

    return receipt;
}

async function initialize_contracts(wallet: Wallet, tokenToDeposit: string): Promise<EVMContract> {
    const btceContract = new Contract(LOMBARD_BTCE_CONTRACT_ADDRESS, BTCeAbi, wallet);

    const tellerAddress = await callContractMethod<string>(btceContract, "teller");
    const tellerContract = new Contract(tellerAddress, TellerAbi, wallet);

    const [lbtcvAddress, accountantAddress] = await Promise.all([
        callContractMethod<string>(tellerContract, "vault"),
        callContractMethod<string>(tellerContract, "accountant")
    ]);

    const lbtcvContract = new Contract(lbtcvAddress, LBTCvAbi, wallet);
    const accountantContract = new Contract(accountantAddress, LAccountantAbi, wallet);

    const baseTokenAddress = await callContractMethod<string>(accountantContract, "base");
    const baseTokenContract = new Contract(baseTokenAddress, ERC20Abi, wallet);

    const depositTokenContract = new Contract(tokenToDeposit, ERC20Abi, wallet);

    const btceData = await Promise.all([
        callContractMethod<bigint>(btceContract, "decimals"),
        callContractMethod<string>(btceContract, "symbol"),
        callContractMethod<string>(btceContract, "name")
    ]);

    const lombardVaultData = await Promise.all([
        callContractMethod<bigint>(lbtcvContract, "decimals"),
        callContractMethod<string>(lbtcvContract, "symbol"),
        callContractMethod<string>(lbtcvContract, "name")
    ]);

    const baseTokenData = await Promise.all([
        callContractMethod<bigint>(baseTokenContract, "decimals"),
        callContractMethod<string>(baseTokenContract, "symbol"),
        callContractMethod<string>(baseTokenContract, "name")
    ]);

    const depositTokenData = await Promise.all([
        callContractMethod<bigint>(depositTokenContract, "decimals"),
        callContractMethod<string>(depositTokenContract, "symbol"),
        callContractMethod<string>(depositTokenContract, "name")
    ]);

    return {
        btce: {
            address: LOMBARD_BTCE_CONTRACT_ADDRESS,
            contract: btceContract,
            decimals: Number(btceData[0]),
            symbol: btceData[1],
            name: btceData[2]
        },
        lombardVault: {
            address: lbtcvAddress,
            contract: lbtcvContract,
            decimals: Number(lombardVaultData[0]),
            symbol: lombardVaultData[1],
            name: lombardVaultData[2]
        },
        teller: { address: tellerAddress, contract: tellerContract },
        baseToken: {
            address: baseTokenAddress,
            contract: baseTokenContract,
            decimals: Number(baseTokenData[0]),
            symbol: baseTokenData[1],
            name: baseTokenData[2]
        },
        depositToken: {
            address: tokenToDeposit,
            contract: depositTokenContract,
            decimals: Number(depositTokenData[0]),
            symbol: depositTokenData[1],
            name: depositTokenData[2]
        },
        accountant: { address: accountantAddress, contract: accountantContract }
    }
}

function calculateApy(currentRate: number, pastRate: number): number {
    const growth = currentRate / pastRate;
    const timeDelta = 365 / 14; // 14 day trailing APY
    const apy = Math.pow(growth, timeDelta) - 1;
    return apy * 100;
}

async function calculateTVL(contract: Contract, currentShareRate: number): Promise<number> {
    const decimals = Number(await callContractMethod<bigint>(contract, "decimals"));
    const totalSupply = Number(await callContractMethod<bigint>(contract, "totalSupply")) / Math.pow(10, decimals);
    const totalAssets = totalSupply * currentShareRate;

    const btcPrice = await getBtcPrice();

    const tvl = totalAssets * btcPrice;
    return tvl;
}

async function getVaultDetails(contracts: EVMContract, wallet: Wallet): Promise<VaultDetails> {
    // get shareRate of 14 days back
    const currentBlockNumber = await wallet.provider?.getBlockNumber();
    if (!currentBlockNumber) throw new Error("Failed to fetch current block number");

    const network = await wallet.provider?.getNetwork();
    if (!network) throw new Error("Failed to get Network data");
    const chainId = Number(network.chainId);
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

    const accountantInterface = new Interface(LAccountantAbi);
    const exchangeRateEventTopic = accountantInterface.getEvent("ExchangeRateUpdated")?.topicHash;
    if (!exchangeRateEventTopic) throw new Error("Exchange Rate Event Topic hash not found");

    const logs = await wallet.provider?.getLogs({
        fromBlock: pastBlockNumber,
        toBlock: currentBlockNumber,
        topics: [exchangeRateEventTopic],
        address: contracts.accountant.address
    });

    if (!logs || logs.length == 0) {
        throw new Error("No logs found to calculate APY");
    }
    const log = logs[0];
    if (!log?.topics || !log?.data) {
        throw new Error("No log data to calculate APY");
    }

    const decodedLog = accountantInterface.parseLog({
        topics: log.topics,
        data: log.data
    });

    const baseTokenDecimals = Number(await callContractMethod<bigint>(contracts.baseToken.contract, "decimals"));
    const prevShareRate = Number(decodedLog?.args[0]) / Math.pow(10, baseTokenDecimals);
    const currentShareRate = Number(await callContractMethod<bigint>(contracts.accountant.contract, "getRate")) / Math.pow(10, baseTokenDecimals);

    const apy = calculateApy(currentShareRate, prevShareRate);

    const [tvl, tokenSymbol, vaultName] = await Promise.all([
        calculateTVL(contracts.lombardVault.contract, Number(currentShareRate)),
        callContractMethod<string>(contracts.lombardVault.contract, "symbol"),
        callContractMethod<string>(contracts.lombardVault.contract, "name")
    ]);

    return {
        apy,
        tvl,
        token: tokenSymbol,
        vaultName
    }
}

async function checkBalance(contract: Contract, userAddress: string): Promise<bigint> {
    const userBalance: bigint = await callContractMethod<bigint>(contract, "balanceOf", userAddress);
    return userBalance;
}

async function checkMultipleBalances(contracts: EVMContract, userAddress: string) {
    const [depositTokenBalance, BTCeBalance] = await Promise.all([
        checkBalance(contracts.depositToken.contract, userAddress),
        checkBalance(contracts.btce.contract, userAddress),
    ])
    const tokenBalance: TokenBalanceData[] = [
        { name: contracts.depositToken.symbol, balance: Number(formatUnits(depositTokenBalance, contracts.depositToken.decimals)) },
        { name: contracts.btce.symbol, balance: Number(formatUnits(BTCeBalance, contracts.btce.decimals)) },
    ]

    console.log("Balances")
    console.table(tokenBalance);
}

async function approveTokens(contract: Contract, spender: string, amount: number) {
    const approveTxnReceipt: ContractTransactionReceipt = await sendContractMethod(contract, "approve", spender, amount);
    if (approveTxnReceipt.status !== TransactionStatus.SUCCESS) {
        throw new Error("Token Approval Failed");
    }
}

async function depositTokens(contract: Contract, tokenAddress: string, amount: number, receiver: string, minShareAmt: number, nonce: number): Promise<boolean> {
    const depositTxnReceipt: ContractTransactionReceipt = await sendContractMethod(contract, "deposit(address,uint256,address,uint256)", tokenAddress, amount, receiver, minShareAmt, { nonce });
    return depositTxnReceipt.status == TransactionStatus.SUCCESS;
}

async function withdrawTokens(contract: Contract, amount: bigint, receiver: string, owner: string): Promise<boolean> {
    const withdrawTxnReceipt: ContractTransactionReceipt = await sendContractMethod(contract, "withdraw", amount, receiver, owner)
    return withdrawTxnReceipt.status == TransactionStatus.SUCCESS;
}

async function main(tokenToDeposit: string) {
    try {
        const wallet: Wallet = setup_wallet();
        const userAddress: string = await wallet.getAddress();
        const contracts: EVMContract = await initialize_contracts(wallet, tokenToDeposit);

        const depositTokenDecimals = await callContractMethod<bigint>(contracts.depositToken.contract, "decimals");

        console.log("Vault Details \n", await getVaultDetails(contracts, wallet));

        // balance before deposit
        await checkMultipleBalances(contracts, userAddress);

        // token approval
        await approveTokens(contracts.depositToken.contract, contracts.btce.address, 1000);

        // get latest nonce
        const nonce = await wallet.getNonce();
        console.log("sending deposit with nonce ", nonce);

        // deposit function call
        console.log("\nDepositing...");
        const depositSuccess = await depositTokens(contracts.btce.contract, contracts.depositToken.address, 1000, userAddress, 0, nonce);
        if (depositSuccess) {
            await checkMultipleBalances(contracts, userAddress);
        } else {
            throw new Error(`Deposit Transaction failed`);
        }

        // withdraw flow
        console.log("\nWithdrawing...");
        const withdrawSuccess = await withdrawTokens(contracts.btce.contract, BigInt(1000), userAddress, userAddress);
        if (withdrawSuccess) {
            await checkMultipleBalances(contracts, userAddress);
        } else {
            throw new Error(`Withdraw Transaction failed`);
        }
    } catch (error) {
        console.error("Error: ", error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

const tokenToDeposit = process.argv[2];
if (!tokenToDeposit) {
    console.error("Usage: npm run start -- <tokenAddress>");
    process.exit(1);
}

if (!isAddress(tokenToDeposit)) {
    throw new Error("Invalid token address");
}

main(tokenToDeposit);