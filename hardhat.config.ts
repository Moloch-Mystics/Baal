import dotenv from "dotenv";
import * as fs from "fs";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
// import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";
import "hardhat-contract-sizer";
import "hardhat-abi-exporter";
import "hardhat-deploy";

import "./tasks/setup";

dotenv.config();

/*
  when compiled contracts do not exist,
  importing "tasks/setup" will fail the compile task itself.

  this is a circular dependency that exists on the tasks themselves.

  conditionally loading tasks if the artifacts folder exists
  allows the config to skip the first compile.
*/
// if (fs.existsSync("./artifacts")) {
//   import("./tasks/setup");
// }

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const defaultNetwork = "localhost";

const infuraKey = () => {
  return process.env.INFURA_API_KEY || '' // <---- YOUR INFURA ID! (or it won't work)
};

const mnemonic = () => {
  try {
    return process.env.MNEMONIC || fs.readFileSync("./mnemonic.txt").toString().trim();
  } catch (e) {
    if (defaultNetwork !== "localhost") {
      console.log(
        "☢️ WARNING: No mnemonic file created for a deploy account. Try `yarn run generate` and then `yarn run account`."
      );
    }
  }
  return "";
}

const explorerApiKey = (networkName: string) => {
  const fromEnv = () => {
    switch (networkName) {
      case "ethereum":
        return process.env.ETHERSCAN_API_KEY;
      case "gnosis":
        return process.env.GNOSISSCAN_API_KEY;
      case "polygon":
        return process.env.POLYGONSCAN_API_KEY;
      case "optimism":
        return process.env.OPTIMISTICSCAN_API_KEY;
      case "arbitrumOne":
        return process.env.ARBISCAN_API_KEY;
      case "base":
        return process.env.BASESCAN_API_KEY;
      default:
        break;
    }
  }
  return fromEnv() || '';
}

const config: HardhatUserConfig = {
  networks: {
    localhost: {
      url: "http://localhost:8545",
      /*
        notice no mnemonic here? it will just use account 0 of the hardhat node to deploy
        (you can put in a mnemonic here to set the deployer locally)
      */
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${infuraKey()}`,
      accounts: {
        mnemonic: mnemonic(),
      },
      verify: {
        etherscan: {
          apiKey: explorerApiKey('ethereum'),
        },
      },
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${infuraKey()}`,
      // gas: 5000000,
      // gasPrice: 100000000000,
      // gasMultiplier: 2,
      accounts: process.env.ACCOUNT_PK
        ? [process.env.ACCOUNT_PK]
        : {
          mnemonic: mnemonic(),
        },
      verify: {
        etherscan: {
          apiKey: explorerApiKey('ethereum'),
        },
      },
    },
    sepolia: {
      url: `https://sepolia.infura.io/v3/${infuraKey()}`,
      // gas: 5000000,
      // gasPrice: 100000000000,
      // gasMultiplier: 2,
      accounts: process.env.ACCOUNT_PK
        ? [process.env.ACCOUNT_PK]
        : {
          mnemonic: mnemonic(),
        },
      verify: {
        etherscan: {
          apiKey: explorerApiKey('ethereum'),
        },
      },
    },
    xdai: {
      url: "https://rpc.gnosischain.com/",
      gas: 5000000,
      gasPrice: 8000000000,
      accounts: {
        mnemonic: mnemonic(),
      },
      verify: {
        etherscan: {
          apiKey: explorerApiKey('gnosis'),
        },
      }
    },
    gnosis: {
      url: "https://rpc.gnosischain.com/",
      gas: 5000000,
      gasPrice: 8000000000,
      accounts: {
        mnemonic: mnemonic(),
      },
      verify: {
        etherscan: {
          apiKey: explorerApiKey('gnosis'),
        },
      },
    },
    polygon: {
      url: `https://polygon-mainnet.infura.io/v3/${infuraKey()}`,
      accounts: {
        mnemonic: mnemonic(),
      },
      verify: {
        etherscan: {
          apiKey: explorerApiKey('polygon'),
        },
      },
    },
    polygonMumbai: {
      url: `https://polygon-mumbai.infura.io/v3/${infuraKey()}`,
      accounts: {
        mnemonic: mnemonic(),
      },
      verify: {
        etherscan: {
          apiKey: explorerApiKey('polygon'),
        },
      },
    },
    arbitrumOne: {
      url: `https://arbitrum-mainnet.infura.io/v3/${infuraKey()}`,
      accounts: {
        mnemonic: mnemonic(),
      },
      verify: {
        etherscan: {
          apiKey: explorerApiKey('arbitrumOne'),
        },
      },
    },
    optimisticEthereum: {
      url: `https://optimism-mainnet.infura.io/v3/${infuraKey()}`,
      accounts: {
        mnemonic: mnemonic(),
      },
      verify: {
        etherscan: {
          apiKey: explorerApiKey('optimism'),
        },
      },
    },
    base: {
      url: `https://mainnet.base.org`,
      accounts: {
        mnemonic: mnemonic(),
      },
      verify: {
        etherscan: {
          apiKey: explorerApiKey('base'),
        },
      },
    },
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    // apiKey: "61ED96HQAY6PASTEWRXN6AMYQEKM8SYTRY" // etherscan
    apiKey: {
      gnosis: explorerApiKey('gnosis'),
      xdai: explorerApiKey('gnosis'),
      goerli: explorerApiKey('ethereum'),
      mainnet: explorerApiKey('ethereum'),
      polygon: explorerApiKey('polygon'),
      polygonMumbai: explorerApiKey('polygon'),
      arbitrumOne: explorerApiKey('arbitrumOne'),
      optimisticEthereum: explorerApiKey('optimism'),
      base: explorerApiKey('base'),
    },
    customChains: [
      {
        network: "gnosis",
        chainId: 100,
        urls: {
          apiURL: "https://api.gnosisscan.io/api",
          browserURL: "https://gnosisscan.io/",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        }
      },
    ]
  },
  solidity: {
    compilers: [
      {
        version: "0.8.7",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            // coverage only
            // details: {
            //   yul: true
            // },
          },
        },
      },
      {
        version: "0.8.10",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            // coverage only
            // details: {
            //   yul: true
            // },
          },
        },
      }
    ],
  },
  namedAccounts: {
    deployer: 0,
  },
  abiExporter: {
    path: './abi',
    clear: true,
    flat: true,
    except: ['@gnosis.pm', '@openzeppelin'],
  },
  typechain: {
    outDir: "src/types",
    target: "ethers-v5",
  },
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS === 'true',
    excludeContracts: [],
    src: "./contracts",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
};

export default config;
