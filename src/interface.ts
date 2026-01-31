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