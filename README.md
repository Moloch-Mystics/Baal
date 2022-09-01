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

----
## Contracts
### **Baal (contracts/Baal.sol)**
is a minimal yet composable DAO template continuing work from
the Moloch, Minion and Compound frameworks to make it easier for
people to combine and command crypto assets with intuitive membership
games.

#### Interfaces
EIP721
OZ Minimal Clone Factoy [EIP 1167 Clones](https://docs.openzeppelin.com/contracts/4.x/api/proxy#Clones)
Gnosis Safe Module [Zodiac](https://github.com/gnosis/zodiac)

### **Shares (contracts/SharesERC20.sol)**
have direct execution, voting, and exit rights around actions
taken by the main DAO contract. Shareholders are the collective DAO
admins.

#### Interfaces
ERC20,  Initializable [OpenZeplin v4](https://docs.openzeppelin.com/contracts/4.x/)


### **BaalVotes (contracts/utils/BaalVotes.sol)**
abstract with a similar Implimentation of ERC20VOTES with the main
difference being auto self-delegation and the use of timestmap instead of block.number.
#### Interfaces
ERC20Permit

### **Loot (contracts/LootERC20.sol)**
has only exit rights against the DAO treasury, so loot does
not have the ability to admin the DAO config. However, because it has
exit rights, it is still a powerful unit, and because it is an ERC-20
can be used in many composable ways.

#### Interfaces
ERC20, ERC20Snapshot, ERC20Permit, Initializable [OpenZeplin v4](https://docs.openzeppelin.com/contracts/4.x/)

### **TributeMinion (contracts/tools/TributeMinion.sol)**
is a helper contract for making tribute proposals.
Provides contract to approve ERC-20 transfers. Provides a simple
function/interface to make a single proposal type.

### **BaalSummoner (contracts/BaalSummoner.sol)**
Factory to summon new dao contracts. It has 2 main functions one to deploy
the dao contracts and the Safe treasury and one to use an existing Safe treasury.

----

## Folder Structure
- ./abi - generated abis
- ./contracts - main solidity contracts, interfaces, tools and utils
- ./scripts - deploy scripts and helpers
- ./tasks - hard hat cli tasks
- ./tests - test files

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
beta release of the factories. These factories may change until we get to final stable release.

**Goerli**
- lootSingleton: 0xd867ACaaDB7B8930EcA709c470B872185698F0EA
- sharesSingleton: 0x25D6d13fD0a8071E1AA0f4b8978c706e715fDd3A
- baalSingleton: 0xB70A2cd3f672cB06e577378578a7AcbF1b68Df56
- Transaction Hash: 0xd0ae2a78716ded1febbf6d37ce98865a20e4233b733ee7aa41097ecd8e79cbaa
- Factory Contract Address: **0xEd6AA9879Ed6ba07411C3224F748Dc65D3f8e685**
- Tribute Minion: 0x9C6f6e6E461FB1dB9761c960900A0Ae05B9786A7

**Gnosis Chain**
- lootSingleton: 0x39bDc48E7b15C63FE54779E93b2ce46555A37609
- sharesSingleton: 0x678f62F2d9dE2e196B79ca853f811E6D0A47460B
- baalSingleton: 0xDb3e9Ded9843358fbbe758c4e73cCfEb9061d4Ed
- Transaction Hash: 0x703acad6f005fa793e9041acc711a3d1ac4c8b632898c08598552d024687bc06
- Factory Contract Address: **0x3Bd3fDf6db732F8548638Cd35B98d624c77FB351**
- Tribute Minion: 0x9391b6A7c55832a6802484dE054d81496D56545A