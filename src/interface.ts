import { Contract } from "ethers"

export interface EVMContract {
    btce: TokenData,
    lombardVault: TokenData,
    teller: EVMData,
    baseToken: TokenData,
    depositToken: TokenData,
    accountant: EVMData
}

export interface EVMData {
    address: string,
    contract: Contract
}

export interface TokenData {
    address: string,
    contract: Contract,
    decimals: number,
    name: string,
    symbol: string
}

export interface VaultDetails {
    vaultName: string,
    token: string,
    apy: number,
    tvl: number
}

export interface TokenBalanceData {
    name: string,
    balance: number
}