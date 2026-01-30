import "dotenv/config";
import {Contract, InterfaceAbi, JsonRpcProvider, Wallet} from "ethers";
import { LOMBARD_BTCE_CONTRACT_ADDRESS, WBTC_TOKEN_ADDRESS } from "./constants";
import BTCeAbi from "./abis/BTCe.json";
import ERC20Abi from "./abis/ERC20.json";

async function main() {
    const rpc_url = process.env.RPC_URL;
    if (!rpc_url) throw new Error("Missing Rpc url in environment");

    const private_key = process.env.PRIVATE_KEY;
    if (!private_key) throw new Error("Missing private key in environment");

    const provider = new JsonRpcProvider(rpc_url);
    const wallet = new Wallet(private_key, provider);
    const user_address = await wallet.getAddress();

    const btce_contract_instance = new Contract(LOMBARD_BTCE_CONTRACT_ADDRESS, BTCeAbi, wallet);
    if (!btce_contract_instance) {
        throw new Error ("Failed to initiate BTCE contract instance");
    }
    const balanceOf = btce_contract_instance["balanceOf"];
    if (!balanceOf) throw new Error("Balance Of method from contract failed");
    const user_btce_balance = await balanceOf(user_address);
    console.log("balance ", user_btce_balance);

    // token approval
    const wBTC_contract_instance = new Contract(WBTC_TOKEN_ADDRESS, ERC20Abi, wallet);
    const approveFn = wBTC_contract_instance["approve"];
    if (!approveFn) throw new Error("Approve transaction failed on wBTC");
    const approveTransaction = await approveFn(LOMBARD_BTCE_CONTRACT_ADDRESS, 1000);
    const approveTransactionReceipt = await approveTransaction.wait();
    console.log("approve txn receipt ", approveTransactionReceipt);

    // get latest nonce
    const nonce = 1+ await provider.getTransactionCount(
        await wallet.getAddress(),
        "pending"
    )

    console.log("sending deposit with nonce ", nonce);

    // deposit function call
    const depositFunction = btce_contract_instance["deposit(address,uint256,address,uint256)"];
    if (!depositFunction) throw new Error("Failed to initiate Deposit call instance");
    const depositTransaction = await depositFunction(WBTC_TOKEN_ADDRESS, 1000, user_address, 0, {nonce});
    const depositTransactionReceipt = await depositTransaction.wait();
    console.log("Deposit transaction receipt ", depositTransactionReceipt);

    // check balance after deposit
    const user_btce_balance_after = await balanceOf(user_address);
    console.log("balance ", user_btce_balance_after);

    // withdraw flow
    const withdrawFunction = btce_contract_instance["withdraw"];
    if (!withdrawFunction) throw new Error("Failed to initiate Withdraw call instance");
    const withdrawTransaction = await withdrawFunction();
}

main();