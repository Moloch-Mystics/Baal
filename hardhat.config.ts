import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";
import "hardhat-gas-reporter"
import "@nomiclabs/hardhat-etherscan";
import "solidity-coverage";
import "hardhat-typechain";
import "hardhat-contract-sizer";

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.7',
    settings: {
      optimizer: {
        enabled: true,
        runs: 5
      }
    }
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true
    }
  },
  typechain: {
    outDir: "src/types",
    target: "ethers-v5",
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: "61ED96HQAY6PASTEWRXN6AMYQEKM8SYTRY" // etherscan
  },
};

export default config;