# Baal 👺

Baal is a minimal yet composable DAO template continuing work from the [`Moloch`](https://github.com/MolochVentures/moloch), [`Minion`](https://github.com/raid-guild/moloch-minion) and [`Compound`](https://github.com/compound-finance/compound-protocol/tree/master/contracts/Governance) frameworks to make it easier for people to combine and command crypto assets with intuitive membership games.

*Guilds, venture clubs and panels can benefit from Baal:* 

<p align="center"><img src="https://media.giphy.com/media/rgwNTGFUbNTgsgiYha/giphy.gif"></p>

## Optimizations:

### Tokenized Shares

Baal voting shares are tokenized under the [OpenZeppelin ERC20 template](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/ERC20.sol). Voting weight can be delegated and balances are checkpointed using the [Compound governance token template](https://github.com/compound-finance/compound-protocol/blob/master/contracts/Governance/Comp.sol). This therefore allows for shares to be exchanged and staked into DeFi positions, but always at the will of the underlying DAO, as they can be burned into loot ('ragekick') through a *Membership Proposal (1)* and paused through a *Period Proposal (2)*.

### Gas-less MetaTXs

Signed approvals following [EIP-712](https://eips.ethereum.org/EIPS/eip-712) can be retrieved by a relayer and allow Baal members to transfer their voting shares ([EIP-2612](https://eips.ethereum.org/EIPS/eip-2612), `permit`) as well delegate voting weight (COMP, `delegateBySig`) without needing gas in their wallets.

### Arbitrary Actions

Baal members can vote to execute any arbitrary logic, which can be in a series of arrayed `data` and `value`, through a new *Action Proposal (0)* type. This is familiar to `Minion`, which has extended the functions available to Moloch DAO members as an external helper contract (also *cf.*, Aragon, Gnosis SAFE). 

By incorporating this functionality into the Baal base, such actions can be streamlined and tap Baal assets more directly (at the tradeoff of increased vigilance), as well as combine with other proposal types through `multiCall`. Further, support for low-level calls natively extends Baal to support ETH as an asset.

![image](https://user-images.githubusercontent.com/41117279/124338932-99556100-db78-11eb-87ab-0e52cbddd068.png)

### Flexible Voting

Baal voting periods can be set within bounds on summoning with a `minVotingPeriod` and `maxVotingPeriod`, as well as amended through *Period (2) Proposals*. Further, if a Baal has a single member, or a proposal has already passed its consensus threshold, such periods are ignored to accelerate Baal operations. 

![image](https://user-images.githubusercontent.com/41117279/124337990-82f8d680-db73-11eb-8f04-f5a9013189bc.png)

### Member Precision

In addition to having membership rights accounted by ERC20 (above) for greater visibility, all Baal members are placed in an amendable `memberList` array to make it easier for helper contracts to complete airdrops and other perks. To extend Moloch DAO V2, such membership can also be set on summoning, with precise weights minted for `shares` and `loot`.

![image](https://user-images.githubusercontent.com/41117279/124337767-3f519d00-db72-11eb-8107-5b617c9e0839.png)

### Member Automation

Extensions to the core Baal logic for membership rights (ragequittable shares, loot, proposal flow, etc.) can be attached as a `shaman` and removed through a *Whitelist Proposal (3)*. 

For example, a Baal DAO may want to automate aspects of membership admission, and launch a crowdsale contract that is approved to grant 10 Baal voting shares per 1 ETH called as a `memberAction` or have a merkle airdrop of voting and loot weights unique to prospective members. 

Short of redeploying a new Baal, such `shamans` also allow members to experiment with new ways to engage and incentivize members--for example, a contract could serve to increase a member's loot weight based on their voting participation, offering efficient ways to subsidize voting attention and TX costs.

![image](https://user-images.githubusercontent.com/41117279/124338375-a45ac200-db75-11eb-9ff2-a0bd0fb7c076.png)

## Moloch DAO V2 Parity:

### Proposal Flow

Baal follows Moloch DAO game theory around membership capital claims through `ragequit` (below), and as such, requires proposals to be processed in the order they are submitted. Proposal types are also identified by familiar `flags` (*Action (0), Membership (1), Period (2), Whitelist (3)*), and execute different logic by such type on `processProposal`. By including a `flag` as an input param on `submitProposal`, submission is similarly simplified in Baal. 

To expand available logic and streamline execution, proposals also include arrays for target accounts (`to`) and associated `value` and `data`, which can express grants of membership weights, attached ETH value for action calls, as well as signal between grants and revocations (which can even be combined, for example, in granting a team membership right while also converting a member to loot status). 

![image](https://user-images.githubusercontent.com/41117279/124337621-7e332300-db71-11eb-84aa-77e35d156d2a.png)

### Loot

Like Moloch, Baal holds an internal account of purely economic rights. Baal extends here by allowing such `loot` to be granted on summoning, transferable, as well as claimed through `shaman` extension contracts.

### Ragequit

![image](https://user-images.githubusercontent.com/41117279/124337802-67d99700-db72-11eb-9e31-6304a23fdb91.png)

Like any Moloch DAO, Baal membership `shares` and `loot` can be burned to claim a fair share of whitelisted tokens (below) after the last proposal a member voted 'yes' on is processed. Baal further allows a recipient to be listed (`to`), where such claims might be treated as means of payment. 

To help ensure predictable token redemption behavior beyond whitelisting, 'safe erc20' checks are included, as well, for each token that is claimed (for example, Moloch DAO V2 cannot hold BNB tokens since they do not conform with erc20 fully). 

Baal makes a more opinionated change by removing the banking 'pull pattern' of Moloch DAO V2 to opt for transactional efficiency in making direct token transfers on ragequit. (To note, pull-pattern banking can always be added as a `shaman` extension.)

### Token Whitelisting

Ragequittable tokens are represented by a whitelist array (`guildTokens`). To improve on this, Baal also allows for tokens to be removed from such list through *Whitelist (3)* proposals. 

<p align="center"><img src="https://media.giphy.com/media/rgwNTGFUbNTgsgiYha/giphy.gif"></p>
