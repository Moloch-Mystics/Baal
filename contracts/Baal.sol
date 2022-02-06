// SPDX-License-Identifier: UNLICENSED
/*
███   ██   ██   █
█  █  █ █  █ █  █
█ ▀ ▄ █▄▄█ █▄▄█ █
█  ▄▀ █  █ █  █ ███▄
███      █    █     ▀
        █    █
       ▀    ▀*/
pragma solidity >=0.8.0;

import "@gnosis.pm/safe-contracts/contracts/base/Executor.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./LootERC20.sol";

import "hardhat/console.sol";

interface ILoot {
    function setUp(string memory _name, string memory _symbol) external;
    function mint(address recipient, uint256 amount) external;
    function burn(address account, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

contract CloneFactory { // implementation of eip-1167 - see https://eips.ethereum.org/EIPS/eip-1167
    function createClone(address target) internal returns (address result) {
        bytes20 targetBytes = bytes20(target);
        assembly {
            let clone := mload(0x40)
            mstore(clone, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(clone, 0x14), targetBytes)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            result := create(0, clone, 0x37)
        }
    }
}

/// @title Baal ';_;'.
/// @notice Flexible guild contract inspired by Moloch DAO framework.
contract Baal is Executor, Initializable, CloneFactory {
    bool public lootPaused; /*tracks transferability of `loot` economic weight - amendable through 'period'[2] proposal*/
    bool public sharesPaused; /*tracks transferability of erc20 `shares` - amendable through 'period'[2] proposal*/

    uint8 public constant decimals = 18; /*unit scaling factor in erc20 `shares` accounting - '18' is default to match ETH & common erc20s*/

    ILoot public lootToken; /*Sub ERC20 for loot mgmt*/

    uint256 public totalSupply; /*counter for total `members` voting `shares` with erc20 accounting*/

    uint32 public votingPeriod; /* voting period in seconds - amendable through 'period'[2] proposal*/
    uint32 public gracePeriod; /*time delay after proposal voting period for processing*/
    uint32 public proposalCount; /*counter for total `proposals` submitted*/
    uint256 public proposalOffering; /* non-member proposal offering*/
    uint256 public quorumPercent; /* minimum % of shares that must vote yes for it to pass*/
    uint256 public sponsorThreshold; /* minimum number of shares to sponsor a proposal (not %)*/
    uint256 public minRetentionPercent; /* auto-fails a proposal if more than (1- minRetentionPercent) * total shares exit before processing*/
    uint256 public minStakingPercent; /* auto-fails a proposals if more than (1 - minStakingPercent) * yes voters exit before processing*/
    uint256 status; /*internal reentrancy check tracking value*/

    bool public adminLock; /* once set to true, no new admin roles can be assigned to shaman */
    bool public managerLock; /* once set to true, no new manager roles can be assigned to shaman */
    bool public governorLock; /* once set to true, no new governor roles can be assigned to shaman */

    string public name; /*'name' for erc20 `shares` accounting*/
    string public symbol; /*'symbol' for erc20 `shares` accounting*/

    uint32 public latestSponsoredProposalId; /* the id of the last proposal to be sponsored */

    bytes32 constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,uint chainId,address verifyingContract)"
        ); /*EIP-712 typehash for Baal domain*/
    bytes32 constant DELEGATION_TYPEHASH =
        keccak256("Delegation(address delegatee,uint nonce,uint expiry)"); /*EIP-712 typehash for Baal delegation*/
    bytes32 constant PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint value,uint nonce,uint deadline)"
        ); /*EIP-712 typehash for EIP-2612 {permit}*/
    bytes32 constant VOTE_TYPEHASH =
        keccak256("Vote(uint proposalId,bool support)"); /*EIP-712 typehash for Baal proposal vote*/

    address[] guildTokens; /*array list of erc20 tokens approved on summoning or by 'whitelist'[3] `proposals` for {ragequit} claims*/

    address multisendLibrary; /*address of multisend library*/

    mapping(address => mapping(address => uint256)) public allowance; /*maps approved pulls of `shares` with erc20 accounting*/
    mapping(address => uint256) public balanceOf; /*maps `members` accounts to `shares` with erc20 accounting*/
    mapping(address => mapping(uint256 => Checkpoint)) public checkpoints; /*maps record of vote `checkpoints` for each account by index*/
    mapping(address => uint256) public numCheckpoints; /*maps number of `checkpoints` for each account*/
    mapping(address => address) public delegates; /*maps record of each account's `shares` delegate*/
    mapping(address => uint256) public nonces; /*maps record of states for signing & validating signatures*/

    mapping(address => Member) public members; /*maps `members` accounts to struct details*/
    mapping(uint256 => Proposal) public proposals; /*maps `proposal id` to struct details*/
    mapping(address => bool) public guildTokensEnabled; /*maps guild token addresses -> enabled status (prevents duplicates in guildTokens[]) */

    mapping(address => uint256) public shamans; /*maps shaman addresses to their permission level*/
    /* permissions registry for shamans
    0 = no permission
    1 = admin only
    2 = manager only
    4 = governance only
    3 = admin + manager
    5 = admin + governance
    6 = manager + governance
    7 = admin + manager + governance */

    event SummonComplete(
        bool lootPaused,
        bool sharesPaused,
        uint256 gracePeriod,
        uint256 votingPeriod,
        uint256 proposalOffering,
        string name,
        string symbol,
        address[] guildTokens,
        address[] shamans,
        address[] summoners,
        uint256[] loot,
        uint256[] shares
    ); /*emits after Baal summoning*/
    event SubmitProposal(
        uint256 indexed proposal,
        bytes32 indexed proposalDataHash,
        uint256 votingPeriod,
        bytes proposalData,
        uint256 expiration,
        string details
    ); /*emits after proposal is submitted*/
    event SponsorProposal(
        address indexed member,
        uint256 indexed proposal,
        uint256 indexed votingStarts
    ); /*emits after member has sponsored proposal*/
    event SubmitVote(
        address indexed member,
        uint256 balance,
        uint256 indexed proposal,
        bool indexed approved
    ); /*emits after vote is submitted on proposal*/
    event ProcessProposal(uint256 indexed proposal); /*emits when proposal is processed & executed*/
    event ProcessingFailed(uint256 indexed proposal); /*emits when proposal is processed & executed*/
    event Ragequit(
        address indexed member,
        address to,
        uint256 indexed lootToBurn,
        uint256 indexed sharesToBurn
    ); /*emits when users burn Baal `shares` and/or `loot` for given `to` account*/
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 amount
    ); /*emits when Baal `shares` are approved for pulls with erc20 accounting*/
    event Transfer(address indexed from, address indexed to, uint256 amount); /*emits when Baal `shares` are minted, burned or transferred with erc20 accounting*/
    event TransferLoot(
        address indexed from,
        address indexed to,
        uint256 amount
    ); /*emits when Baal `loot` is minted, burned or transferred*/
    event DelegateChanged(
        address indexed delegator,
        address indexed fromDelegate,
        address indexed toDelegate
    ); /*emits when an account changes its voting delegate*/
    event DelegateVotesChanged(
        address indexed delegate,
        uint256 previousBalance,
        uint256 newBalance
    ); /*emits when a delegate account's voting balance changes*/

    modifier nonReentrant() {
        /*reentrancy guard*/
        require(status == 1, "reentrant");
        status = 2;
        _;
        status = 1;
    }

    modifier baalOnly() {
        require(msg.sender == address(this), "!baal");
        _;
    }

    modifier baalOrAdminOnly() {
        require(
            msg.sender == address(this) || isAdmin(msg.sender),
            "!baal & !admin"
        ); /*check `shaman` is admin*/
        _;
    }

    modifier baalOrManagerOnly() {
        require(
            msg.sender == address(this) || isManager(msg.sender),
            "!baal & !manager"
        ); /*check `shaman` is manager*/
        _;
    }

    modifier baalOrGovernorOnly() {
        require(
            msg.sender == address(this) || isGovernor(msg.sender),
            "!baal & !governor"
        ); /*check `shaman` is governor*/
        _;
    }

    struct Checkpoint {
        /*Baal checkpoint for marking number of delegated votes*/
        uint32 fromTimeStamp; /*unix time for referencing voting balance*/
        uint256 votes; /*votes at given unix time*/
    }

    struct Delegation {
        uint256 fromTimeStamp; /* timestamp from which delegation began */
        address delegate; /* address of delegate */
    }

    struct Member {
        /*Baal membership details*/
        uint32 highestIDYesVote; /*highest proposal id on which a member `approved`*/
        mapping(uint256 => bool) voted; /*maps voting decisions on proposals by `members` account*/
        mapping(uint32 => uint32) orderedYesVotes; /* maps yes vote id to the previous yes vote proposal id */
        Delegation[] delegateChain; /* append-only array of historical delegations */
    }

    struct Proposal {
        /*Baal proposal details*/
        uint32 id; /*id of this proposal, used in existence checks (increments from 1)*/
        uint32 prevProposalId; /* id of the previous proposal - set at sponsorship from latestSponsoredProposalId */
        uint32 votingStarts; /*starting time for proposal in seconds since unix epoch*/
        uint32 votingEnds; /*termination date for proposal in seconds since unix epoch - derived from `votingPeriod` set on proposal*/
        uint32 graceEnds; /*termination date for proposal in seconds since unix epoch - derived from `gracePeriod` set on proposal*/
        uint32 expiration; /*timestamp after which proposal should be considered invalid and skipped. */
        uint256 yesVotes; /*counter for `members` `approved` 'votes' to calculate approval on processing*/
        uint256 noVotes; /*counter for `members` 'dis-approved' 'votes' to calculate approval on processing*/
        uint256 maxTotalSharesAndLootAtYesVote; /* highest share+loot count during any individual yes vote*/
        uint256 rqYesVotes; /* yes voting shares that have ragequit since voting yes */
        bool[4] status; /* [cancelled, processed, passed, actionFailed] */
        // bool cancelled; /* true if proposal is cancelled (by sponsor/govshaman, or with enough undelegations), skips processing */
        // bool processed; /* true if process proposal has been called for this proposal */
        // bool passed; /* yes only if proposal pass and also passed all execution checks at processing time */
        // bool actionFailed; /*label if proposal processed but action failed TODO gas optimize*/
        address sponsor; /* address of the sponsor - set at sponsor proposal - relevant for cancellation */
        bytes32 proposalDataHash; /*hash of raw data associated with state updates*/
        string details; /*human-readable context for proposal*/
    }

    /* Unborn -> Submitted -> Voting -> Grace -> Ready -> Processed 
                              \-> Cancelled  \-> Defeated   */
    enum ProposalState {
        Unborn,    /* 0 - can submit */
        Submitted, /* 1 - can sponsor -> voting */
        Voting,    /* 2 - can be cancelled, otherwise proceeds to grace */
        Cancelled, /* 3 - terminal state, counts as processed */
        Grace,     /* 4 - proceeds to ready/defeated */
        Ready,     /* 5 - can be processed */
        Processed, /* 6 - terminal state */
        Defeated   /* 7 - terminal state, yes votes <= no votes, counts as processed */
    }

    /// @notice Summon Baal with voting configuration & initial array of `members` accounts with `shares` & `loot` weights.
    /// @param _initializationParams Encoded setup information.
    function setUp(bytes memory _initializationParams) public initializer {
        (
            string memory _name, /*_name Name for erc20 `shares` accounting*/
            string memory _symbol, /*_symbol Symbol for erc20 `shares` accounting*/
            address _lootSingleton,
            address _multisendLibrary, /*address of multisend library*/
            bytes memory _initializationMultisendData /*here you call BaalOnly functions to set up initial shares, loot, shamans, periods, etc.*/
        ) = abi.decode(_initializationParams, (string, string, address, address, bytes));
        name = _name; /*initialize Baal `name` with erc20 accounting*/
        symbol = _symbol; /*initialize Baal `symbol` with erc20 accounting*/
        
        lootToken = ILoot(createClone(_lootSingleton));
        lootToken.setUp(string(abi.encodePacked(_name, " LOOT")), string(abi.encodePacked(_symbol, "-LOOT"))); /*TODO this naming feels too opinionated*/

        multisendLibrary = _multisendLibrary;

        // Execute all setups including
        // * mint shares
        // * convert shares to loot
        // * set shamans
        // * set periods
        require(
            execute(
                multisendLibrary,
                0,
                _initializationMultisendData,
                Enum.Operation.DelegateCall,
                gasleft()
            ),
            "call failure"
        );

        require(totalSupply > 0, "shares != 0");

        status = 1; /*initialize 'reentrancy guard' status*/
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    /// @notice Submit proposal to Baal `members` for approval within given voting period.
    /// @param proposalData Multisend encoded transactions or proposal data
    /// @param details Context for proposal.
    /// @return proposal Count for submitted proposal.
    function submitProposal(
        bytes calldata proposalData,
        uint32 expiration,
        string calldata details
    ) external payable nonReentrant returns (uint256) {
        require(expiration == 0 || expiration > block.timestamp + votingPeriod + gracePeriod, "expired");

        bool selfSponsor = false; /*plant sponsor flag*/
        if (getCurrentVotes(msg.sender) >= sponsorThreshold) {
            selfSponsor = true; /*if above sponsor threshold, self-sponsor*/
        } else {
            require(msg.value == proposalOffering, "Baal requires an offering");
        }

        bytes32 proposalDataHash = hashOperation(proposalData);

        unchecked {
            proposalCount++; /*increment proposal counter*/
            proposals[proposalCount] = Proposal( /*push params into proposal struct - start voting period timer if member submission*/
                proposalCount,
                selfSponsor ? latestSponsoredProposalId : 0, /* prevProposalId */
                selfSponsor ? uint32(block.timestamp) : 0, /* votingStarts */
                selfSponsor ? uint32(block.timestamp) + votingPeriod : 0, /* votingEnds */
                selfSponsor ? uint32(block.timestamp) + votingPeriod + gracePeriod : 0, /* graceEnds */
                expiration, 
                0, /* yes votes */
                0, /* no votes */
                0, /* highestMaxSharesAndLootAtYesVote */
                0, /* rqYesVotes */
                [false, false, false, false], /* [cancelled, processed, passed, actionFailed] */
                selfSponsor ? msg.sender : address(0),
                proposalDataHash,
                details
            );
        }

        if (selfSponsor) {
            latestSponsoredProposalId = proposalCount;
        }

        emit SubmitProposal(
            proposalCount,
            proposalDataHash,
            votingPeriod,
            proposalData,
            expiration,
            details
        ); /*emit event reflecting proposal submission*/

        return proposalCount;
    }

    /// @notice Sponsor proposal to Baal `members` for approval within voting period.
    /// @param id Number of proposal in `proposals` mapping to sponsor.
    function sponsorProposal(uint32 id) external nonReentrant {
        Proposal storage prop = proposals[id]; /*alias proposal storage pointers*/

        require(getCurrentVotes(msg.sender) >= sponsorThreshold, "!sponsor"); /*check 'votes > threshold - required to sponsor proposal*/
        require(state(id) == ProposalState.Submitted, "!submitted");
        require(prop.expiration == 0 || prop.expiration > block.timestamp + votingPeriod + gracePeriod, "expired");

        prop.votingStarts = uint32(block.timestamp);

        unchecked {
            prop.votingEnds = uint32(block.timestamp) + votingPeriod;
            prop.graceEnds = uint32(block.timestamp) + votingPeriod + gracePeriod;
        }

        prop.prevProposalId = latestSponsoredProposalId;
        prop.sponsor = msg.sender;
        latestSponsoredProposalId = id;

        emit SponsorProposal(msg.sender, id, block.timestamp);
    }

    /// @notice Submit vote - proposal must exist & voting period must not have ended.
    /// @param id Number of proposal in `proposals` mapping to cast vote on.
    /// @param approved If 'true', member will cast `yesVotes` onto proposal - if 'false', `noVotes` will be counted.
    function submitVote(uint32 id, bool approved) external nonReentrant {
        Proposal storage prop = proposals[id]; /*alias proposal storage pointers*/
        require(state(id) == ProposalState.Voting, "!voting");

        uint256 balance = getPriorVotes(msg.sender, prop.votingStarts); /*fetch & gas-optimize voting weight at proposal creation time*/
        require(balance > 0, "!member"); /*check 'membership' - required to vote on proposals*/
        require(!members[msg.sender].voted[id], "voted"); /*check vote not already cast*/

        unchecked {
            if (approved) {
                /*if `approved`, cast delegated balance `yesVotes` to proposal*/
                prop.yesVotes += balance;
                addYesVoteToHistory(msg.sender, prop.id); // also sets member.highestIDYesVote
                if (totalSupply + totalLoot() > prop.maxTotalSharesAndLootAtYesVote) {
                    prop.maxTotalSharesAndLootAtYesVote = totalSupply + totalLoot();
                }
            } else {
                /*otherwise, cast delegated balance `noVotes` to proposal*/
                prop.noVotes += balance;
            }
        }

        members[msg.sender].voted[id] = true; /*record voting action to `members` struct per user account*/

        emit SubmitVote(msg.sender, balance, id, approved); /*emit event reflecting vote*/
    }

    /// @notice Submit vote with EIP-712 signature - proposal must exist & voting period must not have ended.
    /// @param id Number of proposal in `proposals` mapping to cast vote on.
    /// @param approved If 'true', member will cast `yesVotes` onto proposal - if 'false', `noVotes` will be counted.
    /// @param v The recovery byte of the signature.
    /// @param r Half of the ECDSA signature pair.
    /// @param s Half of the ECDSA signature pair.
    function submitVoteWithSig(
        uint32 id,
        bool approved,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        Proposal storage prop = proposals[id]; /*alias proposal storage pointers*/
        require(state(id) == ProposalState.Voting, "!voting");

        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                block.chainid,
                address(this)
            )
        ); /*calculate EIP-712 domain hash*/
        bytes32 structHash = keccak256(
            abi.encode(VOTE_TYPEHASH, id, approved)
        ); /*calculate EIP-712 struct hash*/
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        ); /*calculate EIP-712 digest for signature*/
        address signatory = ecrecover(digest, v, r, s); /*recover signer from hash data*/

        require(signatory != address(0), "!signatory"); /*check signer is not null*/

        uint256 balance = getPriorVotes(signatory, prop.votingStarts); /*fetch & gas-optimize voting weight at proposal creation time*/

        require(balance > 0, "!member"); /* check that user has shares*/
        require(!members[signatory].voted[id], "voted"); /*check vote not already cast*/

        unchecked {
            if (approved) {
                /*if `approved`, cast delegated balance `yesVotes` to proposal*/
                prop.yesVotes += balance;
                addYesVoteToHistory(msg.sender, prop.id); // also sets member.highestIDYesVote
                if (totalSupply + totalLoot() > prop.maxTotalSharesAndLootAtYesVote) {
                    prop.maxTotalSharesAndLootAtYesVote = totalSupply + totalLoot();
                }
            } else {
                /*otherwise, cast delegated balance `noVotes` to proposal*/
                prop.noVotes += balance;
            }
        }

        members[signatory].voted[id] = true; /*record voting action to `members` struct per user account*/

        emit SubmitVote(signatory, balance, id, approved); /*emit event reflecting vote*/
    }

    function addYesVoteToHistory(address memberAddr, uint32 id) internal {
        Member storage member = members[memberAddr];
        uint32 highestIDYesVote = member.highestIDYesVote; // use copy of storage param for immutability

        if (highestIDYesVote == 0) { // first yes vote ever
            member.orderedYesVotes[id] = 0;
            member.highestIDYesVote = id; // update member (storage)

        } else if (id > highestIDYesVote) { // yes vote is already latest
            member.orderedYesVotes[id] = highestIDYesVote;
            member.highestIDYesVote = id; // update member (storage)

        } else { // find and insert yes vote in order
            uint32 nextYesVoteId = highestIDYesVote;
            uint32 prevYesVoteId = 0;
            while (nextYesVoteId > 0) { 
                // nextYesVoteId should become the ID of the next proposal yes vote (w/ ID higher than current)
                // prevYesVoteId should become the ID of the prev proposal yes vote (w/ ID lower than current)
                prevYesVoteId = member.orderedYesVotes[nextYesVoteId];
                if (prevYesVoteId < id) {
                    break;
                }
                nextYesVoteId = prevYesVoteId;
            }
            member.orderedYesVotes[id] = prevYesVoteId;
            member.orderedYesVotes[nextYesVoteId] = id;
        }
    }

    // ********************
    // PROCESSING FUNCTIONS
    // ********************
    /// @notice Process `proposal` & execute internal functions.
    /// @param id Number of proposal in `proposals` mapping to process for execution.
    function processProposal(
        uint32 id,
        bytes calldata proposalData
    ) external nonReentrant {
        Proposal storage prop = proposals[id]; /*alias `proposal` storage pointers*/

        require(state(id) == ProposalState.Ready, "!ready");

        ProposalState prevProposalState = state(prop.prevProposalId);
        require(
            prevProposalState == ProposalState.Processed ||
            prevProposalState == ProposalState.Cancelled ||
            prevProposalState == ProposalState.Defeated ||
            prevProposalState == ProposalState.Unborn,
            "prev!processed"
        );

        // check that the proposalData matches the stored hash
        require(
            hashOperation(proposalData) == prop.proposalDataHash,
            "incorrect calldata"
        );

        prop.status[1] = true;
        bool okToExecute = true;

        // Make proposal fail if after expiration
        if (prop.expiration != 0 && prop.expiration < block.timestamp) okToExecute = false;

        // Make proposal fail if it didn't pass quorum
        if (okToExecute && prop.yesVotes * 100 < quorumPercent * totalSupply) okToExecute = false;

        // Make proposal fail if the minRetentionPercent is exceeded
        if (okToExecute && (totalSupply + totalLoot()) < prop.maxTotalSharesAndLootAtYesVote * minRetentionPercent / 100) {
            okToExecute = false;
        }

        // Make proposal if too many yes voters ragequit before processing
        if (okToExecute && prop.yesVotes - prop.rqYesVotes < prop.yesVotes * minStakingPercent / 100) {
            okToExecute = false;
        }

        /*check if `proposal` approved by simple majority of members*/
        if (prop.yesVotes > prop.noVotes && okToExecute) {
            prop.status[2] = true; /*flag that proposal passed - allows minion-like extensions*/
            bool success = processActionProposal(proposalData); /*execute 'action'*/
            if (!success) prop.status[3] = true;
        }

        emit ProcessProposal(id); /*emit event reflecting that given proposal processed*/
        // TODO, maybe emit extra metadata in event?        
    }

    /// @notice Internal function to process 'action'[0] proposal.
    function processActionProposal(bytes memory proposalData)
        private
        returns (bool success)
    {
        success = execute(
            multisendLibrary,
            0,
            proposalData,
            Enum.Operation.DelegateCall,
            gasleft()
        );
    }

    /// @notice Baal-or-admin-only function to set admin config (pause/unpause shares/loot)
    function setAdminConfig(bool pauseShares, bool pauseLoot) external baalOrAdminOnly {
        sharesPaused = pauseShares; /*set pause `shares`*/
        lootPaused = pauseLoot; /*set pause `loot`*/
    }

    /// @notice Baal-or-manager-only function to mint shares.
    function mintShares(address[] calldata to, uint256[] calldata amount)
        external
        baalOrManagerOnly
    {
        require(to.length == amount.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < to.length; i++) {
            _mintShares(to[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Baal-or-manager-only function to burn shares.
    function burnShares(address[] calldata to, uint256[] calldata amount)
        external
        baalOrManagerOnly
    {
        require(to.length == amount.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < to.length; i++) {
            _burnShares(to[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Baal-or-manager-only function to mint loot.
    function mintLoot(address[] calldata to, uint256[] calldata amount)
        external
        baalOrManagerOnly
    {
        require(to.length == amount.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < to.length; i++) {
            _mintLoot(to[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Baal-or-manager-only function to burn loot.
    function burnLoot(address[] calldata to, uint256[] calldata amount)
        external
        baalOrManagerOnly
    {
        require(to.length == amount.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < to.length; i++) {
            _burnLoot(to[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Baal-or-manager-only function to convert shares to loot.
    function convertSharesToLoot(address to) external baalOrManagerOnly {
        uint256 removedBalance = balanceOf[to]; /*gas-optimize variable*/
        _burnShares(to, removedBalance); /*burn all of `to` `shares` & convert into `loot`*/
        _mintLoot(to, removedBalance); /*mint equivalent `loot`*/
    }

    /// @notice Baal-only function to whitelist guildToken.
    function setGuildTokens(address[] calldata _tokens) external baalOrManagerOnly {
        for (uint256 i; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (guildTokensEnabled[token]) {
                continue; // prevent duplicate tokens
            }

            guildTokens.push(token); /*push account to `guildTokens` array*/
            guildTokensEnabled[token] = true;
        }
    }

    /// @notice Baal-only function to remove guildToken
    function unsetGuildTokens(uint256[] calldata _tokenIndexes) external baalOrManagerOnly {
        for (uint256 i; i < _tokenIndexes.length; i++) {
            address token = guildTokens[_tokenIndexes[i]];
            guildTokensEnabled[token] = false; // disable the token
            guildTokens[_tokenIndexes[i]] = guildTokens[guildTokens.length - 1]; /*swap-to-delete index with last value*/
            guildTokens.pop(); /*pop account from `guildTokens` array*/  
        }
    }

    /// @notice Baal-or-governance-only function to change periods.
    function setGovernanceConfig(bytes memory _governanceConfig) external baalOrGovernorOnly {
        (
            uint32 voting,
            uint32 grace,
            uint256 newOffering,
            uint256 quorum,
            uint256 sponsor,
            uint256 minRetention,
            uint256 minStaking
        ) = abi.decode(
                _governanceConfig,
                (uint32, uint32, uint256, uint256, uint256, uint256, uint256)
            );
        if (voting != 0) votingPeriod = voting; /*if positive, reset min. voting periods to first `value`*/
        if (grace != 0) gracePeriod = grace; /*if positive, reset grace period to second `value`*/
        proposalOffering = newOffering; /*set new proposal offering amount */
        quorumPercent = quorum;
        sponsorThreshold = sponsor;
        minRetentionPercent = minRetention;
        minStakingPercent = minStaking;
    }

    function cancelProposal(uint32 id) external nonReentrant {
        Proposal storage prop = proposals[id];
        require(state(id) == ProposalState.Voting, "!voting");
        require(msg.sender == prop.sponsor || getPriorVotes(prop.sponsor, block.timestamp - 1) < sponsorThreshold || isGovernor(msg.sender), "!cancellable");
        prop.status[0] = true;
    }

    /// @notice Baal-only function to set shaman status.
    function setShamans(address[] calldata _shamans, uint256[] calldata _permissions)
        external
        baalOnly
    {
        require(_shamans.length == _permissions.length, "!array parity"); /*check array lengths match*/
        for (uint256 i; i < _shamans.length; i++) {
            uint256 permission = _permissions[i];
            if (adminLock) require(permission != 1 && permission != 3 && permission != 5 && permission != 7, "admin lock");
            if (managerLock) require(permission != 2 && permission != 3 && permission != 6 && permission != 7, "manager lock");
            if (governorLock) require(permission != 4 && permission != 5 && permission != 6 && permission != 7, "governor lock");
            shamans[_shamans[i]] = permission;
        }
    }

    function lockAdmin() external baalOnly {
        adminLock = true;
    }

    function lockManager() external baalOnly {
        managerLock = true;
    }

    function lockGovernor() external baalOnly {
        governorLock = true;
    }

    /*******************
    GUILD MGMT FUNCTIONS
    *******************/
    /// @notice Approve `to` to transfer up to `amount`.
    /// @return success Whether or not the approval succeeded.
    function approve(address to, uint256 amount)
        external
        returns (bool success)
    {
        allowance[msg.sender][to] = amount; /*adjust `allowance`*/

        emit Approval(msg.sender, to, amount); /*emit event reflecting approval*/

        success = true; /*confirm approval with ERC-20 accounting*/
    }

    /// @notice Delegate votes from user to `delegatee`.
    /// @param delegatee The address to delegate votes to.
    function delegate(address delegatee) external {
        _delegate(msg.sender, delegatee);
    }

    /// @notice Delegates votes from `signatory` to `delegatee` with EIP-712 signature.
    /// @param delegatee The address to delegate 'votes' to.
    /// @param nonce The contract state required to match the signature.
    /// @param deadline The time at which to expire the signature.
    /// @param v The recovery byte of the signature.
    /// @param r Half of the ECDSA signature pair.
    /// @param s Half of the ECDSA signature pair.
    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                block.chainid,
                address(this)
            )
        ); /*calculate EIP-712 domain hash*/
        bytes32 structHash = keccak256(
            abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, deadline)
        ); /*calculate EIP-712 struct hash*/
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        ); /*calculate EIP-712 digest for signature*/
        address signatory = ecrecover(digest, v, r, s); /*recover signer from hash data*/

        require(signatory != address(0), "!signatory"); /*check signer is not null*/
        unchecked {
            require(nonce == nonces[signatory]++, "!nonce"); /*check given `nonce` is next in `nonces`*/
        }

        _delegate(signatory, delegatee); /*execute delegation*/
    }

    /// @notice Triggers an approval from `owner` to `spender` with EIP-712 signature.
    /// @param owner The address to approve from.
    /// @param spender The address to be approved.
    /// @param amount The number of `shares` tokens that are approved (2^256-1 means infinite).
    /// @param deadline The time at which to expire the signature.
    /// @param v The recovery byte of the signature.
    /// @param r Half of the ECDSA signature pair.
    /// @param s Half of the ECDSA signature pair.
    function permit(
        address owner,
        address spender,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                block.chainid,
                address(this)
            )
        ); /*calculate EIP-712 domain hash*/

        unchecked {
            bytes32 structHash = keccak256(
                abi.encode(
                    PERMIT_TYPEHASH,
                    owner,
                    spender,
                    amount,
                    nonces[owner]++,
                    deadline
                )
            ); /*calculate EIP-712 struct hash*/
            bytes32 digest = keccak256(
                abi.encodePacked("\x19\x01", domainSeparator, structHash)
            ); /*calculate EIP-712 digest for signature*/
            address signatory = ecrecover(digest, v, r, s); /*recover signer from hash data*/
            require(signatory != address(0), "!signatory"); /*check signer is not null*/
            require(signatory == owner, "!authorized"); /*check signer is `owner`*/
        }

        require(block.timestamp <= deadline, "expired"); /*check signature is not expired*/

        allowance[owner][spender] = amount; /*adjust `allowance`*/

        emit Approval(owner, spender, amount); /*emit event reflecting approval*/
    }

    /// @notice Transfer `amount` tokens from user to `to`.
    /// @param to The address of destination account.
    /// @param amount The number of `shares` tokens to transfer.
    /// @return success Whether or not the transfer succeeded.
    function transfer(address to, uint256 amount) external returns (bool success) {
        require(!sharesPaused, "!transferable");
        success = _transfer(msg.sender, to, amount);
    }

    /// @notice Transfer `amount` tokens from `from` to `to`.
    /// @param from The address of the source account.
    /// @param to The address of the destination account.
    /// @param amount The number of `shares` tokens to transfer.
    /// @return success Whether or not the transfer succeeded.
    function transferFrom(address from, address to, uint256 amount) external returns (bool success) {
        require(!sharesPaused, "!transferable");
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }

        success = _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) private returns (bool success) {
        balanceOf[from] -= amount;

        /*If recipient is receiving their first shares, auto-self delegate*/
        if (balanceOf[to] == 0 && numCheckpoints[to] == 0 && amount > 0) {
            delegates[to] = to;
            members[to].delegateChain.push(Delegation(block.timestamp, to));
        }

        unchecked {
            balanceOf[to] += amount;
        }

        _moveDelegates(delegates[from], delegates[to], amount);

        emit Transfer(from, to, amount);

        success = true;
    }

    /// @notice Process member burn of `shares` and/or `loot` to claim 'fair share' of `guildTokens`.
    /// @param to Account that receives 'fair share'.
    /// @param lootToBurn Baal pure economic weight to burn.
    /// @param sharesToBurn Baal voting weight to burn.
    function ragequit(
        address to,
        uint256 sharesToBurn,
        uint256 lootToBurn
    ) external nonReentrant {
        _ragequit(to, sharesToBurn, lootToBurn, guildTokens);
    }

    function advancedRagequit(
        address to,
        uint256 sharesToBurn,
        uint256 lootToBurn,
        address[] calldata tokens
    ) external nonReentrant {
        for (uint256 i; i < tokens.length; i++) {
            if (i > 0) {
                require(tokens[i] > tokens[i - 1], 'duplicate token');
            }
        }

        _ragequit(to, sharesToBurn, lootToBurn, tokens);
    }

    function _ragequit(
        address to,
        uint256 sharesToBurn,
        uint256 lootToBurn,
        address[] memory tokens
    ) internal {
        uint256 totalShares = totalSupply;
        uint256 totalLoot = totalLoot();

        if (lootToBurn != 0) {
            /*gas optimization*/
            _burnLoot(msg.sender, lootToBurn); /*subtract `loot` from user account & Baal totals*/
        }

        if (sharesToBurn != 0) {
            /*gas optimization*/
            _burnShares(msg.sender, sharesToBurn); /*subtract `shares` from user account & Baal totals with erc20 accounting*/
        }

        // add member shares to rqYesVotes for all active proposals the member voted yes on
        if (minStakingPercent > 0) {
            _tallyRqYesVotes(sharesToBurn);
        }

        for (uint256 i; i < tokens.length; i++) {
            (, bytes memory balanceData) = tokens[i].staticcall(
                abi.encodeWithSelector(0x70a08231, address(this))
            ); /*get Baal token balances - 'balanceOf(address)'*/
            uint256 balance = abi.decode(balanceData, (uint256)); /*decode Baal token balances for calculation*/

            uint256 amountToRagequit = ((lootToBurn + sharesToBurn) * balance) /
                (totalShares + totalLoot); /*calculate 'fair shair' claims*/

            if (amountToRagequit != 0) {
                /*gas optimization to allow higher maximum token limit*/
                _safeTransfer(tokens[i], to, amountToRagequit); /*execute 'safe' token transfer*/
            }
        }

        emit Ragequit(msg.sender, to, lootToBurn, sharesToBurn); /*event reflects claims made against Baal*/
    }

    function _tallyRqYesVotes(uint256 sharesToBurn) internal {
        Member storage member = members[msg.sender];
        bool done = false;
        uint256 nextDelegationTimeStamp = 0;
        for (uint256 a = 0; a < member.delegateChain.length; a++) { // loop over delegations (we start with latest and work backwards)
            console.log('delegate #', member.delegateChain.length - a - 1);
            Delegation memory d = member.delegateChain[member.delegateChain.length - a - 1]; // look up latest delegation
            Member storage delegate = members[d.delegate];
            uint32 proposalId = delegate.highestIDYesVote;
            while (proposalId > 0) { // loop backwards over voting history, starting with latest
                console.log('proposal #', proposalId);
                Proposal memory prop = proposals[proposalId];
                ProposalState proposalState = state(proposalId);

                // if member delegated to someone else after, skip until we find proposals during delegation
                if (nextDelegationTimeStamp != 0 && prop.votingStarts > nextDelegationTimeStamp) {
                    proposalId = delegate.orderedYesVotes[proposalId]; // set proposalId to the previous yes vote Id
                    console.log('skip proposal');
                    continue;
                }

                // voting started before delegation, move on to next delegate
                if (prop.votingStarts < d.fromTimeStamp) {
                    console.log('next delegate');
                    break;
                }
 
                // found processed proposal from an active delegate - we're done
                if (proposalState == ProposalState.Processed ||
                    proposalState == ProposalState.Defeated ||
                    proposalState == ProposalState.Cancelled && prop.graceEnds < block.timestamp
                ) {
                    console.log('done');
                    done = true;
                    break;
                }

                // skip setting rqYesVotes if proposal is cancelled
                if (proposalState != ProposalState.Cancelled) {
                    console.log('set rqYesVotes', sharesToBurn);
                    proposals[proposalId].rqYesVotes += sharesToBurn;
                }

                proposalId = delegate.orderedYesVotes[proposalId]; // set proposalId to the previous yes vote Id
            }
            nextDelegationTimeStamp = d.fromTimeStamp;
            if (done) break;
        }
    }

    /***************
    GETTER FUNCTIONS
    ***************/

    function state(uint32 id) public view returns (ProposalState) {
        Proposal memory prop = proposals[id];
        if (prop.id == 0) {
            return ProposalState.Unborn;
        } else if (prop.status[0] /* cancelled */) {
            return ProposalState.Cancelled;
        } else if (prop.votingStarts == 0) {
            return ProposalState.Submitted;
        } else if (block.timestamp <= prop.votingEnds) {
            return ProposalState.Voting;
        } else if (block.timestamp <= prop.graceEnds) {
            return ProposalState.Grace;
        } else if (prop.noVotes >= prop.yesVotes) {
            return ProposalState.Defeated;
        } else if (prop.status[1] /* processed */) {
            return ProposalState.Processed;
        } else {
            return ProposalState.Ready;
        }
    }

    function getProposalStatus(uint32 id) public view returns (bool[4] memory) {
        return proposals[id].status;
    }

    /// @notice Returns the current delegated `vote` balance for `account`.
    /// @param account The user to check delegated `votes` for.
    /// @return votes Current `votes` delegated to `account`.
    function getCurrentVotes(address account)
        public
        view
        returns (uint256 votes)
    {
        uint256 nCheckpoints = numCheckpoints[account];
        unchecked {
            votes = nCheckpoints != 0
                ? checkpoints[account][nCheckpoints - 1].votes
                : 0;
        }
    }

    /// @notice Returns the prior number of `votes` for `account` as of `timeStamp`.
    /// @param account The user to check `votes` for.
    /// @param timeStamp The unix time to check `votes` for.
    /// @return votes Prior `votes` delegated to `account`.
    function getPriorVotes(address account, uint256 timeStamp)
        public
        view
        returns (uint256 votes)
    {
        require(timeStamp < block.timestamp, "!determined");

        uint256 nCheckpoints = numCheckpoints[account];
        if (nCheckpoints == 0) return 0;

        unchecked {
            if (
                checkpoints[account][nCheckpoints - 1].fromTimeStamp <=
                timeStamp
            ) return checkpoints[account][nCheckpoints - 1].votes;
            if (checkpoints[account][0].fromTimeStamp > timeStamp) return 0;
            uint256 lower = 0;
            uint256 upper = nCheckpoints - 1;
            while (upper > lower) {
                uint256 center = upper - (upper - lower) / 2;
                Checkpoint memory cp = checkpoints[account][center];
                if (cp.fromTimeStamp == timeStamp) return cp.votes;
                else if (cp.fromTimeStamp < timeStamp) lower = center;
                else upper = center - 1;
            }
            votes = checkpoints[account][lower].votes;
        }
    }

    function didMemberVoteOnProposal(address memberAddr, uint32 id) public view returns (bool) {
        return members[memberAddr].voted[id];
    }

    function getPreviousYesVoteIdById(address memberAddr, uint32 id) public view returns (uint32) {
        return members[memberAddr].orderedYesVotes[id];
    }

    function getDelegateChainByIndex(address memberAddr, uint256 index) public view returns (Delegation memory d) {
        d = members[memberAddr].delegateChain[index];
        return d;
    }

    function getDelegateChainLength(address memberAddr) public view returns (uint256) {
        return members[memberAddr].delegateChain.length;
    }

    /// @notice Returns array list of approved `guildTokens` in Baal for {ragequit}.
    /// @return tokens ERC-20s approved for {ragequit}.
    function getGuildTokens() public view returns (address[] memory tokens) {
        tokens = guildTokens;
    }

    function isAdmin(address shaman) public view returns (bool) {
        uint256 permission = shamans[shaman];
        return (permission == 1 || permission == 3 || permission == 5 || permission == 7);
    }

    function isManager(address shaman) public view returns (bool) {
        uint256 permission = shamans[shaman];
        return (permission == 2 || permission == 3 || permission == 6 || permission == 7);
    }

    function isGovernor(address shaman) public view returns (bool) {
        uint256 permission = shamans[shaman];
        return (permission == 4 || permission == 5 || permission == 6 || permission == 7);
    }

    /***************
    HELPER FUNCTIONS
    ***************/

    function totalLoot() public view returns (uint256) {
        return lootToken.totalSupply();
    }

    /// @notice Returns confirmation for 'safe' ERC-721 (NFT) transfers to Baal.
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4 sig) {
        sig = 0x150b7a02; /*'onERC721Received(address,address,uint,bytes)'*/
    }

    /// @notice Returns confirmation for 'safe' ERC-1155 transfers to Baal.
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4 sig) {
        sig = 0xf23a6e61; /*'onERC1155Received(address,address,uint,uint,bytes)'*/
    }

    /// @notice Returns confirmation for 'safe' batch ERC-1155 transfers to Baal.
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4 sig) {
        sig = 0xbc197c81; /*'onERC1155BatchReceived(address,address,uint[],uint[],bytes)'*/
    }

    /// @notice Returns the keccak256 hash of calldata
    function hashOperation(bytes memory _transactions)
        public
        pure
        virtual
        returns (bytes32 hash)
    {
        return keccak256(abi.encode(_transactions));
    }

    /// @notice Deposits ETH sent to Baal.
    receive() external payable {}

    /// @notice Delegates Baal voting weight.
    function _delegate(address delegator, address delegatee) private {
        require(balanceOf[delegator] > 0, '!shares');
        uint32 timestamp = uint32(block.timestamp);
        address currentDelegate = delegates[delegator];
        delegates[delegator] = delegatee;
        Member storage member = members[delegator];
        if (member.delegateChain.length > 0 && member.delegateChain[member.delegateChain.length - 1].fromTimeStamp == timestamp) {
            member.delegateChain[member.delegateChain.length].delegate = delegatee;
        } else {
            member.delegateChain.push(Delegation(block.timestamp, delegatee));
        }
        // TODO the two data structures above are redundant

        _moveDelegates(
            currentDelegate,
            delegatee,
            uint256(balanceOf[delegator])
        );

        emit DelegateChanged(delegator, currentDelegate, delegatee);
    }

    /// @notice Elaborates delegate update - cf., 'Compound Governance'.
    function _moveDelegates(
        address srcRep,
        address dstRep,
        uint256 amount
    ) private {
        unchecked {
            if (srcRep != dstRep && amount != 0) {
                if (srcRep != address(0)) {
                    uint256 srcRepNum = numCheckpoints[srcRep];
                    uint256 srcRepOld = srcRepNum != 0
                        ? checkpoints[srcRep][srcRepNum - 1].votes
                        : 0;
                    uint256 srcRepNew = srcRepOld - amount;
                    _writeCheckpoint(srcRep, srcRepNum, srcRepOld, srcRepNew);
                }

                if (dstRep != address(0)) {
                    uint256 dstRepNum = numCheckpoints[dstRep];
                    uint256 dstRepOld = dstRepNum != 0
                        ? checkpoints[dstRep][dstRepNum - 1].votes
                        : 0;
                    uint256 dstRepNew = dstRepOld + amount;
                    _writeCheckpoint(dstRep, dstRepNum, dstRepOld, dstRepNew);
                }
            }
        }
    }

    /// @notice Elaborates delegate update - cf., 'Compound Governance'.
    function _writeCheckpoint(
        address delegatee,
        uint256 nCheckpoints,
        uint256 oldVotes,
        uint256 newVotes
    ) private {
        uint32 timeStamp = uint32(block.timestamp);

        unchecked {
            if (
                nCheckpoints != 0 &&
                checkpoints[delegatee][nCheckpoints - 1].fromTimeStamp == timeStamp
            ) {
                checkpoints[delegatee][nCheckpoints - 1].votes = newVotes;
            } else {
                checkpoints[delegatee][nCheckpoints] = Checkpoint(
                    timeStamp,
                    newVotes
                );
                numCheckpoints[delegatee] = nCheckpoints + 1;
            }
        }

        emit DelegateVotesChanged(delegatee, oldVotes, newVotes);
    }

    /// @notice Burn function for Baal `loot`.
    function _burnLoot(address from, uint256 loot) private {
        lootToken.burn(from, loot);

        emit TransferLoot(from, address(0), loot); /*emit event reflecting burn of `loot`*/
    }

    /// @notice Burn function for Baal `shares`.
    function _burnShares(address from, uint256 shares) private {
        balanceOf[from] -= shares; /*subtract `shares` for `from` account*/
        unchecked {
            totalSupply -= shares; /*subtract from total Baal `shares`*/
        }

        _moveDelegates(delegates[from], address(0), shares); /*update delegation*/

        emit Transfer(from, address(0), shares); /*emit event reflecting burn of `shares` with erc20 accounting*/
    }

    /// @notice Minting function for Baal `loot`.
    function _mintLoot(address to, uint256 loot) private {
        lootToken.mint(to, loot);
        emit TransferLoot(address(0), to, loot); /*emit event reflecting mint of `loot`*/
    }

    /// @notice Minting function for Baal `shares`.
    function _mintShares(address to, uint256 shares) private {
        unchecked {
            if (totalSupply + shares <= type(uint256).max / 2) {
                /*If recipient is receiving their first shares, auto-self delegate*/
                if (balanceOf[to] == 0 && numCheckpoints[to] == 0 && shares > 0) {
                    delegates[to] = to;
                    members[to].delegateChain.push(Delegation(block.timestamp, to));
                }

                balanceOf[to] += shares; /*add `shares` for `to` account*/

                totalSupply += shares; /*add to total Baal `shares`*/

                _moveDelegates(address(0), delegates[to], shares); /*update delegation*/

                emit Transfer(address(0), to, shares); /*emit event reflecting mint of `shares` with erc20 accounting*/
            }
        }
    }

    /// @notice Provides 'safe' {transfer} for tokens that do not consistently return 'true/false'.
    function _safeTransfer(
        address token,
        address to,
        uint256 amount
    ) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount)
        ); /*'transfer(address,uint)'*/
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "transfer failed"
        ); /*checks success & allows non-conforming transfers*/
    }

    /// @notice Provides 'safe' {transferFrom} for tokens that do not consistently return 'true/false'.
    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, to, amount)
        ); /*'transferFrom(address,address,uint)'*/
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "transferFrom failed"
        ); /*checks success & allows non-conforming transfers*/
    }
}
