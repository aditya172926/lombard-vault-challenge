import "dotenv/config";
import { Contract, ContractTransactionReceipt, ContractTransactionResponse, Interface, isAddress, JsonRpcProvider, Wallet } from "ethers";
import BTCeAbi from "./abis/BTCe.json";
import ERC20Abi from "./abis/ERC20.json";
import LBTCvAbi from "./abis/LBTCv.json";
import LAccountantAbi from "./abis/Lombard_Accountant.json";
import TellerAbi from "./abis/Teller.json";
import { LOMBARD_BTCE_CONTRACT_ADDRESS } from "./constants";
import { EVMContract } from "./interface";

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

    const lbtcvAddress: string = await callContractMethod<string>(tellerContract, "vault");
    const lbtcvContract = new Contract(lbtcvAddress, LBTCvAbi, wallet);

    const accountantAddress = await callContractMethod<string>(tellerContract, "accountant");
    const accountantContract = new Contract(accountantAddress, LAccountantAbi, wallet);

    const baseTokenAddress = await callContractMethod<string>(accountantContract, "base");
    const baseTokenContract = new Contract(baseTokenAddress, ERC20Abi, wallet);

    const depositTokenContract = new Contract(tokenToDeposit, ERC20Abi, wallet);

    return {
        btce: { address: LOMBARD_BTCE_CONTRACT_ADDRESS, contract: btceContract },
        lombardVault: { address: lbtcvAddress, contract: lbtcvContract },
        teller: { address: tellerAddress, contract: tellerContract },
        baseToken: { address: baseTokenAddress, contract: baseTokenContract },
        depositToken: { address: tokenToDeposit, contract: depositTokenContract },
        accountant: { address: accountantAddress, contract: accountantContract }
    }
}

function calculateApy(currentRate: bigint, pastRate: bigint): number {
    const growth = Number(currentRate) / Number(pastRate);
    const timeDelta = 365 / 14; // 14 day trailing APY
    const apy = Math.pow(growth, timeDelta) - 1;
    return apy * 100;
}

function calculateTVL() {

}

async function getVaultDetails(contracts: EVMContract, wallet: Wallet) {
    const decimals = await callContractMethod<bigint>(contracts.baseToken.contract, "decimals");

    const currentShareRate: bigint = await callContractMethod<bigint>(contracts.accountant.contract, "getRate");

    // get shareRate of 14 days back
    const currentBlockNumber = await wallet.provider?.getBlockNumber();
    if (!currentBlockNumber) throw new Error("Failed to fetch current block number");

    const pastBlockNumber = currentBlockNumber - (15 * 24 * 60 * 60 / 12); // 12 seconds per block production
    console.log("Current block number ", currentBlockNumber);
    console.log("Past block number ", pastBlockNumber);

    const accountantInterface = new Interface(LAccountantAbi);
    const exchangeRateEventTopic = accountantInterface.getEvent("ExchangeRateUpdated")?.topicHash;
    if (!exchangeRateEventTopic) throw new Error("Exchange Rate Event Topic hash not found");

    const logs = await wallet.provider?.getLogs({
        fromBlock: pastBlockNumber,
        toBlock: currentBlockNumber,
        topics: [exchangeRateEventTopic],
        address: contracts.accountant.address
    });

    if (logs) {
        const log = logs[0];
        if (log?.topics && log?.data) {
            const decodedLog = accountantInterface.parseLog({
                topics: log.topics,
                data: log.data
            });
            const prevShareRate = decodedLog?.args[0];
            console.log("decoded log args ", decodedLog?.args);

            const apy = calculateApy(currentShareRate, prevShareRate);
            console.log("APY ", apy);
        }
    }

    console.log("Current share rate ", currentShareRate);
    console.log("base token address ", contracts.baseToken.address);
    console.log("base token decimals ", decimals);
}

async function checkBalance(contract: Contract, userAddress: string): Promise<bigint> {
    const userBalance: bigint = await callContractMethod<bigint>(contract, "balanceOf", userAddress);
    return userBalance;
}

async function approveTokens(contract: Contract, spender: string, amount: number) {
    const approveTxnReceipt: ContractTransactionReceipt = await sendContractMethod(contract, "approve", spender, amount);
    if (approveTxnReceipt.status === TransactionStatus.SUCCESS) {
        console.log("Token Approval success");
    } else {
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

        await getVaultDetails(contracts, wallet);

        // balance before deposit
        console.log("Starting User Balance BTCe ", await checkBalance(contracts.btce.contract, userAddress));

        // token approval
        await approveTokens(contracts.depositToken.contract, contracts.btce.address, 1000);

        // get latest nonce
        const nonce = await wallet.getNonce();
        console.log("sending deposit with nonce ", nonce);

        // deposit function call
        const depositSuccess = await depositTokens(contracts.btce.contract, contracts.depositToken.address, 1000, userAddress, 0, nonce);
        if (depositSuccess) {
            console.log("User BTCe Balance after deposit ", await checkBalance(contracts.btce.contract, userAddress));
        } else {
            throw new Error(`Deposit Transaction failed`);
        }

        // withdraw flow
        const withdrawSuccess = await withdrawTokens(contracts.btce.contract, BigInt(1000), userAddress, userAddress);
        if (withdrawSuccess) {
            console.log("User BTCe Balance after withdraw ", await checkBalance(contracts.btce.contract, userAddress));
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