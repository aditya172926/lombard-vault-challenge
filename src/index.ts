import "dotenv/config";
import { Contract, JsonRpcProvider, TransactionReceipt, Wallet } from "ethers";
import BTCeAbi from "./abis/BTCe.json";
import ERC20Abi from "./abis/ERC20.json";
import { LOMBARD_BTCE_CONTRACT_ADDRESS, WBTC_TOKEN_ADDRESS } from "./constants";
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

function initialize_contracts(wallet: Wallet): EVMContract {
    return {
        btce: new Contract(LOMBARD_BTCE_CONTRACT_ADDRESS, BTCeAbi, wallet),
        wbtc: new Contract(WBTC_TOKEN_ADDRESS, ERC20Abi, wallet)
    }
}

async function checkBalance(contract: Contract, userAddress: string): Promise<bigint> {
    const balanceFn = contract["balanceOf"];
    if (!balanceFn) throw new Error("Balance check function interface not found");
    const userBalance: bigint = await balanceFn(userAddress);
    return userBalance;
}

async function approveTokens(contract: Contract, spender: string, amount: number) {
    const approveFn = contract["approve"];
    if (!approveFn) throw new Error("Approve Tokens function interface not found");
    const approveTransaction = await approveFn(spender, amount);
    const approveTxnReceipt: TransactionReceipt = await approveTransaction.wait();
    if (approveTxnReceipt.status === TransactionStatus.SUCCESS) {
        console.log("Token Approval success");
    } else {
        throw new Error("Token Approval Failed");
    }
}

async function depositTokens(contract: Contract, tokenAddress: string, amount: number, receiver: string, minShareAmt: number, nonce: number): Promise<boolean> {
    const depositFn = contract["deposit(address,uint256,address,uint256)"];
    if (!depositFn) throw new Error("Deposit function interface not found");
    const depositTransaction = await depositFn(tokenAddress, amount, receiver, minShareAmt, { nonce });
    const depositTxnReceipt: TransactionReceipt = await depositTransaction.wait();
    return depositTxnReceipt.status == TransactionStatus.SUCCESS;
}

async function withdrawTokens(contract: Contract, amount: bigint, receiver: string, owner: string): Promise<boolean> {
    const withdrawFn = contract["withdraw"];
    if (!withdrawFn) throw new Error("Withdraw tokens interface not found");
    const withdrawTransaciton = await withdrawFn(amount, receiver, owner);
    const withdrawTxnReceipt: TransactionReceipt = await withdrawTransaciton.wait();
    return withdrawTxnReceipt.status == TransactionStatus.SUCCESS;
}

async function main() {
    try {
        const wallet: Wallet = setup_wallet();
        const userAddress: string = await wallet.getAddress();
        const contracts: EVMContract = initialize_contracts(wallet);

        // balance before deposit
        console.log("Starting User Balance BTCe ", await checkBalance(contracts.btce, userAddress));

        // token approval
        await approveTokens(contracts.wbtc, LOMBARD_BTCE_CONTRACT_ADDRESS, 1000);

        // get latest nonce
        const nonce = await wallet.getNonce();
        console.log("sending deposit with nonce ", nonce);

        // deposit function call
        const depositSuccess = await depositTokens(contracts.btce, WBTC_TOKEN_ADDRESS, 1000, userAddress, 0, nonce);
        if (depositSuccess) {
            console.log("User BTCe Balance after deposit ", await checkBalance(contracts.btce, userAddress));
        } else {
            throw new Error(`Deposit Transaction failed`);
        }

        // withdraw flow
        const withdrawSuccess = await withdrawTokens(contracts.btce, BigInt(1000), userAddress, userAddress);
        if (withdrawSuccess) {
            console.log("User BTCe Balance after withdraw ", await checkBalance(contracts.btce, userAddress));
        } else {
            throw new Error(`Withdraw Transaction failed`);
        }
    } catch (error) {
        console.error("Error: ", error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

main();