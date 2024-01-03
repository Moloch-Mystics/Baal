# Baal 👺

Baal (Molochv3) is a minimal yet composable DAO template continuing work from the
Moloch, Minion, Compound/OZ and Safe frameworks to make it easier for people to
combine and command crypto assets with intuitive membership games.

*Guilds, venture clubs and control panels can benefit from Baal:*

<p align="center"><img src="https://media.giphy.com/media/rgwNTGFUbNTgsgiYha/giphy.gif"></p>

## Setup

If you are going to just use this project feel free to clone it.  If you would like to submit any pull requests please create an issue or work on a current issue and fork the repo.  The main groups that are contributing to this project are [Moloch Mystics](https://github.com/Moloch-Mystics/Baal), [DaoHaus](https://discord.com/channels/709210493549674598) [MetaCartel](https://discord.com/channels/702325961433284609).

### Setup Environment

`yarn install` - to install all of the components for the project

`.env.sample` containes the all required environment variables that need to be set to build, deploy & publish the smart contracts on the blockchain. These should be added to a `.env[.*]` file.

### Building

This project uses the [hardhat](https://hardhat.org/) ethereum tools for solidity compiling and running a virtual ethereum environment for testing.

`yarn build` - will compile the solidity code and generate your contract artifacts (in the /artifacts directory), and generate all of the necessary types.

### Testing

If you are looking to work on unit tests for this project be sure to read the README file in the test directory.

`yarn hardhat test` - run the unit tests

## Publishing

the Baal contracts, types, and abis are published through the CI process, after making changes to the repo, and when you are ready to publish the packages, do the following:

1) bump the version in `package.json`
2) push and merge into `feat/baalZodiac` branch

running the CI process will trigger on `merges to feat/baalZodiac branch` build the dist folder and publish it to `@daohaus/baal-contracts` package to npm if the package.json version is different than the current latest on npm.

----
## Folder Structure
- ./abi - generated abis
- ./contracts - main solidity contracts, interfaces, tools and utils
- ./deploy - deploy scripts and helpers)
- ./scripts - deploy scripts and helpers (**soon to be deprecated**)
- ./tasks - hard hat cli tasks
- ./tests - test files

----

## Coverage

currently, coverage is turned off for test efficiency purposes. In order to switch coverage on, add `yul` to the hardhat config:

```
{
  ...
  compilers: [
    {
      version: "0.8.7",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
          details: {
            yul: true
          }
        },
      },
    }
  ]
}
```

then run the coverage command:

```
npx hardhat coverage
```
----
## Verify Contracts

Run the following command:

```
yarn hardhat etherscan-verify
```

----
## Importing the package on your own project

You can `yarn add @daohaus/baal-contracts` on your own project and get access to Baal smart contracts, ABIs & deployment scripts for local testing your contract integrations:

* *Smart contracts*: you can import Baal smart contract on your Hardhat /Foundry / Truffle project at `@daohaus/baal-contracts/contracts/*`
* *ABIs*: if your custom frontend needs to interact with Baal contracts, you can find contract ABIs at `@daohaus/baal-contracts/abi/*`
* *Local testing*: if you're using [hardhat-deploy](https://www.npmjs.com/package/hardhat-deploy), you can reuse our scripts to deploy all Baal + infrastructure contracts locally to perform integration testing with your implementation. You just need to follow these steps:

  1. Add these lines on your `hardhat.config.ts` config file to allow `hardhat-deploy` to find Baal artifacts & deployment scripts:
  ```
  ...
  external: {
    contracts: [
      {
        artifacts: 'node_modules/@daohaus/baal-contracts/export/artifacts',
        deploy: 'node_modules/@daohaus/baal-contracts/export/deploy'
      }
    ]
  },
  ...
  ```

  2. On your test scripts, you can call `await deployments.fixture([tag1, tag2, ...])` (e.g. under `beforeEach()`) and specify the deployment tags you need. For example, `await deployments.fixture(['Infra', 'BaalSummoner'])` will deploy both Safe & Baal contracts.


  3. You can also use the [`baalSetup`](test/utils/fixtures.ts) fixture to setup your tests with factory contracts, baal settings, members, loot/shares/token distributions, etc. Moreover, you can also customize it to cover new use cases such as custom summoner contracts, shamans and other setup needs by implementing the`setupBaalOverride` and/or `setupUsersOverride` fixture function parameters. You can take a look at a few example implementations of ([baalSetup](test/utils/baal.ts) and [setupUsersDefault](test/utils/fixtures.ts)) for inspiration. You can find and import all the available scripts/fixtures available for hardhat testing as follows:

  ```js
  import { baalSetup, ... } from "@daohaus/baal-contracts/hardhat";
  ```
  
  Below, there's the list of parameters can be customized when calling the hardhat fixture:

  ```js
    type BaalSetupOpts = {
      fixtureTags?: Array<string>; // additional deployment tags
      daoSettings?: Partial<DAOSettings>;
      summonSetupOpts?: Partial<SummonSetup>;
      safeAddress?: `0x${string}`;
      forwarderAddress?: `0x${string}`;
      lootAddress?: `0x${string}`;
      sharesAddress?: `0x${string}`;
      setupBaalOverride?: (params: NewBaalParams) => Promise<NewBaalAddresses>;
      setupUsersOverride?: (params: SetupUsersParams) => Promise<UsersSetup>;
  }
  ```

To learn more about using `fixtures` on hardhat visit [link1](https://github.com/wighawag/hardhat-deploy#creating-fixtures) and [link2](https://www.npmjs.com/package/hardhat-deploy#testing-deployed-contracts). It is also recommended to check out the [Baal shamans](https://github.com/HausDAO/baal-shamans) repository for examples.

----
## Contracts

### **Baal (contracts/Baal.sol)**

It is a minimal yet composable DAO template continuing work from
the Moloch, Minion and Compound frameworks to make it easier for
people to combine and command crypto assets with intuitive membership
games.

#### Interfaces

* EIP721
* OZ Minimal Clone Factoy [EIP 1167 Clones](https://docs.openzeppelin.com/contracts/4.x/api/proxy#Clones)
Gnosis Safe Module [Zodiac](https://github.com/gnosis/zodiac)

### **Shares (contracts/SharesERC20.sol)**

Have direct execution, voting, and exit rights around actions
taken by the main DAO contract. Shareholders are the collective DAO
admins.

#### Interfaces

* ERC20,  Initializable [OpenZeplin v4](https://docs.openzeppelin.com/contracts/4.x/)


### **BaalVotes (contracts/utils/BaalVotes.sol)**

Abstract with a similar Implimentation of ERC20VOTES with the main
difference being auto self-delegation and the use of timestmap instead of block.number.

#### Interfaces

* ERC20Permit

### **Loot (contracts/LootERC20.sol)**

Has only exit rights against the DAO treasury, so loot does
not have the ability to admin the DAO config. However, because it has
exit rights, it is still a powerful unit, and because it is an ERC-20
can be used in many composable ways.

#### Interfaces

* ERC20, ERC20Snapshot, ERC20Permit, Initializable [OpenZeplin v4](https://docs.openzeppelin.com/contracts/4.x/)

### **TributeMinion (contracts/tools/TributeMinion.sol)**

It is a helper contract for making tribute proposals.
Provides contract to approve ERC-20 transfers. Provides a simple
function/interface to make a single proposal type.

### **BaalSummoner (contracts/BaalSummoner.sol)**

Factory to summon new dao contracts. 
It can take an existing safe or exsiting tokens

### **Higher Order BaalAndVaultSummoner (contracts/higherOrderFactories/BaalAndVaultSummoner.sol)**

Factory to summon new dao contracts with an extra 'sidecar' non-ragequitable vault. 
A registry is used to save safe addresses for use in UI.
It can also add a external safe to an existing DAO as owner

### **Higher Order BaalAdvTokenSummoner (contracts/higherOrderFactories/BaalAdvTokenSummoner.sol)**

Factory to summon new dao contracts with custom loot token name and symbol 
Minting and pausing of token happen upfront before Baal is setup

----

## Privileged roles

- Shamans - are specific addresses that have more granular control
outside the standard governance proposal flow. These addresses should
always be contracts that have been explicitly given these rights
through the standard proposal flow or during initial DAO setup.
- Governor - can cancel a proposal, set Governance Config (change the
length of proposals, if there is a required quorum, etc.).
- Manager - can mint/burn shares/loot.
- Admin - can set Admin configuration and pause/unpause shares/loot.
- DAO - is always a super admin over its config and can vote to make
changes to its configuration at any time.

## Risks

- In case of Shaman keys leak, an attacker can get access to Baal
(admin) functionalities, burn, mint, give shaman roles etc.
Because of this Shamans are ment to be external contracts and not EOAs
but it is up to the DAO to enforce this.

## More Documentation

More docs for [Functions](https://baal-docs.vercel.app/functions) and [Events](https://baal-docs.vercel.app/events), [V3 updates](https://baal-docs.vercel.app/features/updates), patterns, stories and other superficial musings can be found at the [Docs Page here](https://baal-docs.vercel.app/)

<p align="center"><img src="https://media.giphy.com/media/rgwNTGFUbNTgsgiYha/giphy.gif"></p>

## initial audit
See audit notes in ./audits

## Addresses Beta Factories and Templates
 Would you like to deploy to another chain? Use scripts/deployFactories and scripts/deployTribute. Please reach out for more info on deploys

see current deploys at: src/addresses/deployed.js

## License

[MIT]()
