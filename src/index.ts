import "dotenv/config";
import {JsonRpcProvider, Wallet} from "ethers";

async function main() {
    const rpc_url = process.env.RPC_URL;
    if (!rpc_url) throw new Error("Missing Rpc url in environment");

    const private_key = process.env.PRIVATE_KEY;
    if (!private_key) throw new Error("Missing private key in environment");

    const provider = new JsonRpcProvider(rpc_url);
    const wallet = new Wallet(private_key, provider);
}

main();