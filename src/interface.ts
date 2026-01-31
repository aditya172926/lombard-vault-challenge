import { Contract } from "ethers"

export interface EVMContract {
    btce: EVMData,
    lombardVault: EVMData,
    teller: EVMData,
    baseToken: EVMData,
    depositToken: EVMData,
    accountant: EVMData
}

export interface EVMData {
    address: string,
    contract: Contract
}

export interface VaultDetails {
    vaultName: string,
    token: string,
    apy: number,
    tvl: number
}