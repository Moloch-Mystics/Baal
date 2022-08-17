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
./abi - generated abis
./contracts - main solidity contracts, interfaces, tools and utils
./scripts - deploy scripts and helpers
./tasks - hard hat cli tasks
./tests - test files

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