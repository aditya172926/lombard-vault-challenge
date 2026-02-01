# Lombard Vault Challenge

A Typescript script that interacts with Lombard Defi Vault on Ethereum Mainnet to Deposit Tokens,reading user balance, withdraw tokens and show vault metadata.

## Setup

```bash
git clone https://github.com/aditya172926/lombard-vault-challenge.git

cp .sample.env .env
```

### Environment Variables
- RPC_URL: Rpc url for Ethereum mainnet network. You can get one from Infura for better performance.
- PRIVATE_KEY: User Private key to be used in the script for making deposits and withdrawals in the vault. Make sure this account has some token balance for deposits and native ETH to pay for gas.
- ETHERSCAN_API_KEY: Etherscan api key used to get past block data and logs for APY calculation. You can generate one from Etherscan.
- TOKEN_ADDRESS: (required if using Docker to run) Token address used to make the deposit. Lombard Defi Vault supports some tokens like WBTC, LBTC for making deposits and withdrawals on Ethereum mainnet.
- TOKEN_AMOUNT:(required if using Docker to run) Amount of tokens you want to deposit and withdraw. This value should account for token decimals. So if depositing WBTC (decimals 8), 100000000 means 1 WBTC token.

## Running

After the environment variables are set, here are some ways you can run this script.

### Using Docker

This gives you more flexibility to run this script and simulate transactions. With all the environment variables set, using Docker you can either run the script in **Fork** mode or **mainnet** mode.

#### Using Docker in Fork Mode

```bash
npm run fork
```

or directly

```bash
docker compose --profile fork up --build --abort-on-container-exit --exit-code-from app-fork
```

This will create a Fork anvil node of Ethereum mainnet using the RPC_URL and run the script on this forked network, executing the transactions like it would happen in the read network.

In this your tokens won't be spent on the real network and it will show the output as it would be executed on the real Ethereum Mainnet network.

#### Using Docker in Mainnet mode
```bash
npm run mainnet
```

or directly

```bash
docker compose --profile mainnet up --build
```

This will run the script directly on Ethereum Mainnet executing real transactions.

### Directly using npm

You can run the script using this command and by specifying which token to use for deposit and how much.
This will run the script directly on Ethereum Mainnet, or whichever RPC_URL have you set in the environment variables.

Install Dependencies first
```bash
npm install
```

```bash
npm run start -- <token_address> <token_amount>
```

Example, depositing 0.00001 WBTC on Ethereum Mainnet
```bash
npm run start -- 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 1000
```

## Output

The output of the script looks like this

```bash
User Wallet Address  0x4eff290c1a734411b39aaA96eAbE1E25f0E223ae
Vault: Lombard BTC Vault
APY: 1.55 %
TVL: $ 69355156.99
Token: LBTCv (Decimals: 8)

Balances
Deposit Token WBTC balance: 0.00002298
Receipt Token BTCe balance: 0.00014601

Depositing...
Balances
Deposit Token WBTC balance: 0.00001298
Receipt Token BTCe balance: 0.00015578

Withdrawing...
Balances
Deposit Token WBTC balance: 0.00001298
Receipt Token BTCe balance: 0.00014578
```

The output logs shows the balance of both the token that was deposited and receipt token received and burned after a successful deposit and withdrawal transaction in the Lombard Defi Vault.

# Design Decisions
- Why using BTCe instead of LBTCv?
BTCe is Lombard's official wrapper around the LBTCv token vault contract. Lombard's dashboard makes the deposits and withdrawals transactions using BTCe contract. On withdrawal BTCe burns immediately and its balance for the user reduces.

On the Veda app platform, the dashboard uses a teller contract which calls the Lombard's Vault contract on Ethereum Mainnet. But the withdrawal transaction still happens using the BTCe contract.

The script just executes the deposit and withdrawal using the BTCe contract and user receives the BTCe tokens as a receipt token for their deposit.

- Getting contracts dynamically.
The script uses BTCe contract as a starting point to fetch other contract addresses like LBTCv vault address, Teller contract address, Accountant Contract address, Base Token Contract address (WBTC for Ethereum Mainnet).
This is better than hardcoding these in the script to ensure it remains up to date if Lombard makes some changes on their side.

- Etherscan for APY.
For APY calculation the script needs the exchange rate from 14 days ago. It gets the exchange rate from the Accountant contract but it doesn't store past rates.

First the script gets the nearest block number of 14 days ago using Etherscan api. Then using the RPC_URL the script attempts to fetch the logs of *ExchangeRateUpdated* event on the Accountant contract from the past block, that contains the old exchange rate used for APY calculation.

If fetching past logs fails due to RPC limits, it falls back on using Etherscan api again to fetch the logs from past blocknumber from which the script decodes the old exchange rate of the vault shares in terms of base token.

- Two Docker profiles?
The Fork mode is good for testing and seeing how the script would run on the real network without actually spending real money. Further more we can do more configurations in the fork mode like adding more gas, try different tokens, impersonate accounts, etc.

The mainnet profile spins up the required environment quickly to do the transactions on the actual Ethereum Mainnet network.