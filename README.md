# Baal 👺

WIP: [Docs Page here](https://baal-docs.vercel.app/)

## Goerli test deploy

- lootSingleton 0x0De84DCAc3B2d52581120059ee9723FDDecCB044
- sharesSingleton 0x3109AeD0fD9777cEFb24dBa5eb5030987bd9E3F3
- baalSingleton 0x69b442eb55714A0B144134AED015517394Ed1871
- Transaction Hash: 0x62906ba23728bda0a1a0ffcca412371772448bac200497030462da615fc04598
- **Factory Contract Address**: 0x0C5fd8AAdF995e11E5Ac1CD72139Ee4fd72cDeFC
- tribute minion: 0x9C6f6e6E461FB1dB9761c960900A0Ae05B9786A7

Baal is a minimal yet composable DAO template continuing work from the [`Moloch`](https://github.com/MolochVentures/moloch), [`Minion`](https://github.com/raid-guild/moloch-minion) and [`Compound`](https://github.com/compound-finance/compound-protocol/tree/master/contracts/Governance) frameworks to make it easier for people to combine and command crypto assets with intuitive membership games.

*Guilds, venture clubs and control panels can benefit from Baal:*

<p align="center"><img src="https://media.giphy.com/media/rgwNTGFUbNTgsgiYha/giphy.gif"></p>

## Setup

If you are going to just use this project feel free to clone it.  If you would like to submit any pull requests please create an issue or work on a current issue and fork the repo.  The two main groups that are contributing to this project are [DaoHaus](https://discord.com/channels/709210493549674598) and [MetaCartel](https://discord.com/channels/702325961433284609).

### Setup Environment

`yarn install` - to install all of the components for the project

### Building

This project uses the [hardhat](https://hardhat.org/) ethereum tools for solidity compiling and running a virtual ethereum environment for testing.

`yarn build` - will compile the solidity code and generate your contract artifacts (in the /artifacts directory), and generate all of the necessary types.

## Publishing

the Baal contracts, types, and abis are published through the CI process, after making changes to the repo, and when you are ready to publish the packages, do the following:

1) bump the version in `package.json`
2) push and merge into `feat/baalZodiac` branch

running the CI process will trigger on `merges to feat/baalZodiac branch` build the dist folder and publish it to `@daohaus/baal-contracts` package to npm if the package.json version is different than the current latest on npm.

### Testing

If you are looking to work on unit tests for this project be sure to read the README file in the test directory.

`npx hardhat test` - run the unit tests

<p align="center"><img src="https://media.giphy.com/media/rgwNTGFUbNTgsgiYha/giphy.gif"></p>
