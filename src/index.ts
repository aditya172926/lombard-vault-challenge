import "dotenv/config";
import { Contract, ContractTransactionReceipt, ContractTransactionResponse, formatUnits, Interface, isAddress, JsonRpcProvider, Log, Wallet } from "ethers";
import BTCeAbi from "./abis/BTCe.json";
import ERC20Abi from "./abis/ERC20.json";
import LBTCvAbi from "./abis/LBTCv.json";
import LAccountantAbi from "./abis/Lombard_Accountant.json";
import TellerAbi from "./abis/Teller.json";
import WithdrawalQAbi from "./abis/WithDrawalQ.json";
import { EVMContract, LogResult, VaultDetails } from "./interface";
import { fetchLogs, getBtcPrice, getPastBlockNumber } from "./service";

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
    const lombard_btce_contract_address = process.env.LOMBARD_BTCE_CONTRACT_ADDRESS;
    if (!lombard_btce_contract_address) throw new Error("LOMBARD_BTCE_CONTRACT_ADDRESS not found in environment");

    const btceContract = new Contract(lombard_btce_contract_address, BTCeAbi, wallet);

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

    const withdrawalQAddress = process.env.LOMBARD_WITHDRAWAL_QUEUE_ADDRESS;
    if (!withdrawalQAddress) throw new Error("LOMBARD_WITHDRAWAL_QUEUE_ADDRESS not found in environment");
    const withdrawalQueueContract = new Contract(withdrawalQAddress, WithdrawalQAbi, wallet);

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
            address: lombard_btce_contract_address,
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
        accountant: { address: accountantAddress, contract: accountantContract },
        withdrawalQueue: {address: withdrawalQAddress, contract: withdrawalQueueContract}
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
    const network = await wallet.provider?.getNetwork();
    if (!network) throw new Error("Failed to get Network data");
    const chainId = Number(network.chainId);
    const pastBlockNumber = await getPastBlockNumber(chainId);
    const currentBlockNumber = await wallet.provider?.getBlockNumber();
    if (!currentBlockNumber) throw new Error("Failed to fetch current block number");

    const accountantInterface = new Interface(LAccountantAbi);
    const exchangeRateEventTopic = accountantInterface.getEvent("ExchangeRateUpdated")?.topicHash;
    if (!exchangeRateEventTopic) throw new Error("Exchange Rate Event Topic hash not found");

    let log: Log | LogResult | undefined;

    try {
        const providerLogs = await wallet.provider?.getLogs({
            fromBlock: pastBlockNumber,
            toBlock: currentBlockNumber,
            topics: [exchangeRateEventTopic],
            address: contracts.accountant.address
        });

        if (providerLogs && providerLogs.length > 0) {
            log = providerLogs[0];
        } else {
            const apiLogs = await fetchLogs(chainId, contracts.accountant.address, exchangeRateEventTopic, pastBlockNumber, currentBlockNumber);
            if (apiLogs && apiLogs.length > 0) {
                log = apiLogs[0];
            }
        }
    } catch (error) {
        const apiLogs = await fetchLogs(chainId, contracts.accountant.address, exchangeRateEventTopic, pastBlockNumber, currentBlockNumber);
        if (apiLogs && apiLogs.length > 0) {
            log = apiLogs[0];
        }
    }

    // Validate
    if (!log?.topics || !log?.data) {
        throw new Error("No valid exchange rate logs found");
    }

    const decodedLog = accountantInterface.parseLog({
        topics: log.topics,
        data: log.data
    });

    const prevShareRate = Number(formatUnits(decodedLog?.args[0], contracts.baseToken.decimals));
    const currentShareRate = Number(formatUnits(await callContractMethod<bigint>(contracts.accountant.contract, "getRate"), contracts.baseToken.decimals));

    const apy = calculateApy(currentShareRate, prevShareRate);
    const tvl = await calculateTVL(contracts.lombardVault.contract, Number(currentShareRate));

    return {
        apy,
        tvl,
        token: contracts.lombardVault.symbol,
        vaultName: contracts.lombardVault.name
    }
}

async function checkBalance(contract: Contract, userAddress: string): Promise<bigint> {
    const userBalance: bigint = await callContractMethod<bigint>(contract, "balanceOf", userAddress);
    return userBalance;
}

async function checkMultipleBalances(contracts: EVMContract, userAddress: string) {
    const [depositTokenBalance, BTCeBalance, LBTCvBalance] = await Promise.all([
        checkBalance(contracts.depositToken.contract, userAddress),
        checkBalance(contracts.btce.contract, userAddress),
        checkBalance(contracts.lombardVault.contract, userAddress)
    ]);

    const formattedDepositTokenBalance = Number(formatUnits(depositTokenBalance, contracts.depositToken.decimals));
    const formattedBTCeBalance = Number(formatUnits(BTCeBalance, contracts.btce.decimals));
    const formattedLBTCvBalance = Number(formatUnits(LBTCvBalance, contracts.lombardVault.decimals));

    console.log("Balances");
    console.log(`Deposit Token ${contracts.depositToken.symbol} balance: ${formattedDepositTokenBalance}`);
    console.log(`Receipt Token ${contracts.btce.symbol} balance: ${formattedBTCeBalance}`);
    console.log(`LBTCv (Vault) Token ${contracts.lombardVault.symbol} balance: ${formattedLBTCvBalance}`)
}

async function approveTokens(contract: Contract, spender: string, amount: number) {
    const approveTxnReceipt: ContractTransactionReceipt = await sendContractMethod(contract, "approve", spender, amount);
    if (approveTxnReceipt.status !== TransactionStatus.SUCCESS) {
        throw new Error("Token Approval Failed");
    }
}

async function depositTokens(contract: Contract, tokenAddress: string, amount: bigint, receiver: string, minShareAmt: bigint, nonce: number): Promise<boolean> {
    const depositTxnReceipt: ContractTransactionReceipt = await sendContractMethod(contract, "deposit(address,uint256,address,uint256)", tokenAddress, amount, receiver, minShareAmt, { nonce });
    return depositTxnReceipt.status == TransactionStatus.SUCCESS;
}

async function withdrawTokens(contracts: EVMContract, amount: bigint, receiver: string, owner: string): Promise<boolean> {
    const withdrawTxnReceipt: ContractTransactionReceipt = await sendContractMethod(contracts.btce.contract, "withdraw", amount, receiver, owner);
    if (withdrawTxnReceipt.status == TransactionStatus.SUCCESS) {
        // submit to queue
        const lbtcTokenAddress = process.env.LBTC_TOKEN_ADDRESS;
        if (!lbtcTokenAddress) throw new Error("LBTC_TOKEN_ADDRESS not found in the environment");

        const deadline = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
        const withdrawalQTxnReceipt = await sendContractMethod(
            contracts.withdrawalQueue.contract, 
            "safeUpdateAtomicRequest", 
            contracts.lombardVault.address, // offer token
            lbtcTokenAddress, // want address
            [
                deadline,
                0, // atomic price
                amount, // offer amount
                false // inSolve
            ],
            contracts.accountant.address,
            100 // discount
        )

        return withdrawalQTxnReceipt.status == TransactionStatus.SUCCESS;
    } else {
        throw new Error("Withdrawal Transaction failed");
    }
}

async function main(tokenToDeposit: string, amount: number) {
    try {
        const wallet: Wallet = setup_wallet();
        const userAddress: string = await wallet.getAddress();
        const contracts: EVMContract = await initialize_contracts(wallet, tokenToDeposit);

        const tokenUserBalance = Number(formatUnits(await checkBalance(contracts.depositToken.contract, userAddress), contracts.depositToken.decimals));
        const formattedAmount = Number(formatUnits(amount, contracts.depositToken.decimals));
        if (formattedAmount > tokenUserBalance) throw new Error("Not enough Balance");

        const data: VaultDetails = await getVaultDetails(contracts, wallet);
        console.log("User Wallet Address ", userAddress);
        console.log(`Vault: ${data.vaultName}\nAPY: ${data.apy.toFixed(2)} %\nTVL: $ ${data.tvl.toFixed(2)}\nToken: ${data.token} (Decimals: ${contracts.lombardVault.decimals})\n`);

        // balance before deposit
        await checkMultipleBalances(contracts, userAddress);

        // token approval
        await approveTokens(contracts.depositToken.contract, contracts.btce.address, amount);

        // get latest nonce
        const nonce = await wallet.getNonce();

        // deposit function call
        console.log("\nDepositing...");
        const depositSuccess = await depositTokens(contracts.btce.contract, contracts.depositToken.address, BigInt(amount), userAddress, BigInt(0), nonce);
        if (depositSuccess) {
            await checkMultipleBalances(contracts, userAddress);
        } else {
            throw new Error(`Deposit Transaction failed`);
        }

        // withdraw flow
        console.log("\nWithdrawing...");
        const withdrawSuccess = await withdrawTokens(contracts, BigInt(amount), userAddress, userAddress);
        if (withdrawSuccess) {
            await checkMultipleBalances(contracts, userAddress);
        } else {
            throw new Error(`Withdraw Transaction failed`);
        }

        console.log("Complete ✅");
    } catch (error) {
        console.error("Error: ", error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

const tokenToDeposit = process.argv[2];
if (!tokenToDeposit) {
    console.error("Usage: npm run start -- <tokenAddress> <amount>");
    process.exit(1);
}

if (!isAddress(tokenToDeposit)) {
    throw new Error("Invalid token address");
}

const amount = Number(process.argv[3]);
if (!amount) {
    console.error("Usage: npm run start -- <tokenAddress> <amount>");
    process.exit(1);
}

main(tokenToDeposit, amount);