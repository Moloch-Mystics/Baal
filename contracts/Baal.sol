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

/// @notice Interface for Baal {memberAction} that adjusts member `shares` & `loot`.
interface IShaman {
    function memberAction(
        address member,
        uint96 loot,
        uint96 shares
    ) external payable returns (uint96 lootOut, uint96 sharesOut);
}

/// @title Baal ';_;'.
/// @notice Flexible guild contract inspired by Moloch DAO framework.
contract Baal is Executor, Initializable {
    bool public lootPaused; /*tracks transferability of `loot` economic weight - amendable through 'period'[2] proposal*/
    bool public sharesPaused; /*tracks transferability of erc20 `shares` - amendable through 'period'[2] proposal*/
    bool singleSummoner; /*internal flag to gauge speedy proposal processing*/

    uint8 public constant decimals = 18; /*unit scaling factor in erc20 `shares` accounting - '18' is default to match ETH & common erc20s*/
    uint16 constant MAX_GUILD_TOKEN_COUNT = 400; /*maximum number of whitelistable tokens subject to {ragequit}*/

    uint96 public totalLoot; /*counter for total `loot` economic weight held by `members`*/
    uint96 public totalSupply; /*counter for total `members` voting `shares` with erc20 accounting*/

    uint32 public flashFeeNumerator; /*tracks 'fee' numerator for {flashLoan} in {flashFee} - e.g., '1 = 0.0001%'*/
    uint32 public gracePeriod; /*time delay after proposal voting period for processing*/
    uint32 public minVotingPeriod; /*minimum period for voting in seconds - amendable through 'period'[2] proposal*/
    uint32 public maxVotingPeriod; /*maximum period for voting in seconds - amendable through 'period'[2] proposal*/
    uint256 public proposalCount; /*counter for total `proposals` submitted*/
    uint256 status; /*internal reentrancy check tracking value*/

    string public name; /*'name' for erc20 `shares` accounting*/
    string public symbol; /*'symbol' for erc20 `shares` accounting*/

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

    address multisendLibrary; /* address of multisend library */

    mapping(address => mapping(address => uint256)) public allowance; /*maps approved pulls of `shares` with erc20 accounting*/
    mapping(address => uint256) public balanceOf; /*maps `members` accounts to `shares` with erc20 accounting*/
    mapping(address => mapping(uint256 => Checkpoint)) public checkpoints; /*maps record of vote `checkpoints` for each account by index*/
    mapping(address => uint256) public numCheckpoints; /*maps number of `checkpoints` for each account*/
    mapping(address => address) public delegates; /*maps record of each account's `shares` delegate*/
    mapping(address => uint256) public nonces; /*maps record of states for signing & validating signatures*/

    mapping(address => Member) public members; /*maps `members` accounts to struct details*/
    mapping(uint256 => Proposal) public proposals; /*maps `proposalCount` to struct details*/
    mapping(uint256 => bool) public proposalsPassed; /*maps `proposalCount` to approval status - separated out as struct is deleted, and this value can be used by minion-like contracts*/
    mapping(address => bool) public shamans; /*maps contracts approved in 'whitelist'[3] proposals for {memberAction} that mint or burn `shares`*/

    event SummonComplete(
        bool lootPaused,
        bool sharesPaused,
        uint256 gracePeriod,
        uint256 minVotingPeriod,
        uint256 maxVotingPeriod,
        string name,
        string symbol,
        address[] guildTokens,
        address[] shamans,
        address[] summoners,
        uint96[] loot,
        uint96[] shares
    ); /*emits after Baal summoning*/
    event SubmitProposal(
        uint256 indexed proposal,
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
        uint96 indexed lootToBurn,
        uint96 indexed sharesToBurn
    ); /*emits when users burn Baal `shares` and/or `loot` for given `to` account*/
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 amount
    ); /*emits when Baal `shares` are approved for pulls with erc20 accounting*/
    event Transfer(address indexed from, address indexed to, uint256 amount); /*emits when Baal `shares` are minted, burned or transferred with erc20 accounting*/
    event TransferLoot(address indexed from, address indexed to, uint96 amount); /*emits when Baal `loot` is minted, burned or transferred*/
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

    struct Checkpoint {
        /*Baal checkpoint for marking number of delegated votes*/
        uint32 fromTimeStamp; /*unix time for referencing voting balance*/
        uint96 votes; /*votes at given unix time*/
    }

    struct Member {
        /*Baal membership details*/
        uint96 loot; /*economic weight held by `members` - can be set on summoning & adjusted via {memberAction}*/
        uint256 highestIndexYesVote; /*highest proposal index on which a member `approved`*/
        mapping(uint256 => bool) voted; /*maps voting decisions on proposals by `members` account*/
    }

    struct Proposal {
        /*Baal proposal details*/
        uint32 votingPeriod; /*time for voting in seconds*/
        uint32 votingStarts; /*starting time for proposal in seconds since unix epoch*/
        uint32 votingEnds; /*termination date for proposal in seconds since unix epoch - derived from `votingPeriod` set on proposal*/
        uint96 yesVotes; /*counter for `members` `approved` 'votes' to calculate approval on processing*/
        uint96 noVotes; /*counter for `members` 'dis-approved' 'votes' to calculate approval on processing*/
        bytes proposalData; /*raw data associated with state updates*/
        bool actionFailed; /*label if proposal processed but action failed TODO gas optimize*/
        uint256 expiration; /*time after which proposal should be considered invalid. 0 if no expiration*/
        string details; /*human-readable context for proposal*/
    }

    /// @notice Summon Baal with voting configuration & initial array of `members` accounts with `shares` & `loot` weights.
    /// @param _initializationParams Encoded setup information
    function setUp(bytes memory _initializationParams) public initializer {
        (
            string memory _name, // _name Name for erc20 `shares` accounting.
            string memory _symbol, // _symbol Symbol for erc20 `shares` accounting.
            address _multisendLibrary,
            bytes memory _initializationMultisendData // here you call BaalOnly functions to set up initial shares, loot, shamans, periods, etc
        ) = abi.decode(_initializationParams, (string, string, address, bytes));
        name = _name; /*initialize Baal `name` with erc20 accounting*/
        symbol = _symbol; /*initialize Baal `symbol` with erc20 accounting*/

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

        status = 1; /*initialize 'reentrancy guard' status*/
    }

    /// @notice Delegates Baal voting weight only on initialization for summoners
    function delegateSummoners(
        address[] memory _delegators,
        address[] memory _delegatees
    ) external initializer baalOnly {
        for (uint256 i; i < _delegators.length; i++) {
            _delegate(_delegators[i], _delegatees[i]); /*delegate `summoners` voting weights to themselves - this saves a step before voting*/
        }
    }

    /// @notice Execute membership action to mint or burn `shares` and/or `loot` against whitelisted `shamans` in consideration of user & given amounts.
    /// @param shaman Whitelisted contract to trigger action.
    /// @param loot Economic weight involved in external call.
    /// @param shares Voting weight involved in external call.
    /// @param mint Confirm whether action involves 'mint' or 'burn' action - if `false`, perform burn.
    /// @return lootOut sharesOut Membership updates derived from action.
    function memberAction(
        address shaman,
        uint96 loot,
        uint96 shares,
        bool mint
    ) external payable nonReentrant returns (uint96 lootOut, uint96 sharesOut) {
        require(shamans[shaman], "!shaman"); /*check `shaman` is approved*/

        (lootOut, sharesOut) = IShaman(shaman).memberAction{value: msg.value}(
            msg.sender,
            loot,
            shares
        ); /*fetch 'reaction' per inputs*/

        if (mint) {
            /*execute `mint` actions*/
            if (lootOut != 0) _mintLoot(msg.sender, lootOut); /*add `loot` to user account & Baal total*/
            if (sharesOut != 0) _mintShares(msg.sender, sharesOut); /*add `shares` to user account & Baal total with erc20 accounting*/
        } else {
            /*otherwise, execute `burn` actions*/
            if (lootOut != 0) _burnLoot(msg.sender, lootOut); /*subtract `loot` from user account & Baal total*/
            if (sharesOut != 0) _burnShares(msg.sender, sharesOut); /*subtract `shares` from user account & Baal total with erc20 accounting*/
        }
    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    /// @notice Submit proposal to Baal `members` for approval within given voting period.
    /// @param votingPeriod Voting period in seconds.
    /// @param proposalData Multisend encoded transactions or proposal data
    /// @param details Context for proposal.
    /// @return proposal Count for submitted proposal.
    function submitProposal(
        uint32 votingPeriod,
        bytes calldata proposalData,
        uint256 expiration,
        string calldata details
    ) external nonReentrant returns (uint256 proposal) {
        require(
            minVotingPeriod <= votingPeriod && votingPeriod <= maxVotingPeriod,
            "!votingPeriod"
        ); /*check voting period is within Baal bounds*/

        bool selfSponsor; /*plant sponsor flag*/
        if (balanceOf[msg.sender] != 0) selfSponsor = true; /*if a member, self-sponsor*/

        unchecked {
            proposalCount++; /*increment proposal counter*/
            proposals[proposalCount] = Proposal( /*push params into proposal struct - start voting period timer if member submission*/
                votingPeriod,
                selfSponsor ? uint32(block.timestamp) : 0,
                selfSponsor ? uint32(block.timestamp) + votingPeriod : 0,
                0,
                0,
                proposalData,
                false,
                expiration,
                details
            );
        }

        emit SubmitProposal(
            proposal,
            votingPeriod,
            proposalData,
            expiration,
            details
        ); /*emit event reflecting proposal submission*/
    }

    /// @notice Sponsor proposal to Baal `members` for approval within voting period.
    /// @param proposal Number of proposal in `proposals` mapping to sponsor.
    function sponsorProposal(uint256 proposal) external nonReentrant {
        Proposal storage prop = proposals[proposal]; /*alias proposal storage pointers*/

        require(balanceOf[msg.sender] != 0, "!member"); /*check 'membership' - required to sponsor proposal*/
        require(prop.votingPeriod != 0, "!exist"); /*check proposal existence*/
        require(prop.votingStarts == 0, "sponsored"); /*check proposal not already sponsored*/

        prop.votingStarts = uint32(block.timestamp);

        unchecked {
            prop.votingEnds = uint32(block.timestamp) + prop.votingPeriod;
        }

        emit SponsorProposal(msg.sender, proposal, block.timestamp);
    }

    /// @notice Submit vote - proposal must exist & voting period must not have ended.
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on.
    /// @param approved If 'true', member will cast `yesVotes` onto proposal - if 'false', `noVotes` will be counted.
    function submitVote(uint256 proposal, bool approved) external nonReentrant {
        Proposal storage prop = proposals[proposal]; /*alias proposal storage pointers*/

        uint96 balance = getPriorVotes(msg.sender, prop.votingStarts); /*fetch & gas-optimize voting weight at proposal creation time*/

        require(prop.votingEnds >= block.timestamp, "ended"); /*check voting period has not ended*/
        require(!members[msg.sender].voted[proposal], "voted"); /*check vote not already cast*/

        unchecked {
            if (approved) {
                /*if `approved`, cast delegated balance `yesVotes` to proposal*/
                prop.yesVotes += balance;
                members[msg.sender].highestIndexYesVote = proposal;
            } else {
                /*otherwise, cast delegated balance `noVotes` to proposal*/
                prop.noVotes += balance;
            }
        }

        members[msg.sender].voted[proposal] = true; /*record voting action to `members` struct per user account*/

        emit SubmitVote(msg.sender, balance, proposal, approved); /*emit event reflecting vote*/
    }

    /// @notice Submit vote with EIP-712 signature - proposal must exist & voting period must not have ended.
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on.
    /// @param approved If 'true', member will cast `yesVotes` onto proposal - if 'false', `noVotes` will be counted.
    /// @param v The recovery byte of the signature.
    /// @param r Half of the ECDSA signature pair.
    /// @param s Half of the ECDSA signature pair.
    function submitVoteWithSig(
        uint256 proposal,
        bool approved,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        Proposal storage prop = proposals[proposal]; /*alias proposal storage pointers*/

        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                block.chainid,
                address(this)
            )
        ); /*calculate EIP-712 domain hash*/
        bytes32 structHash = keccak256(
            abi.encode(VOTE_TYPEHASH, proposal, approved)
        ); /*calculate EIP-712 struct hash*/
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        ); /*calculate EIP-712 digest for signature*/
        address signatory = ecrecover(digest, v, r, s); /*recover signer from hash data*/

        require(signatory != address(0), "!signatory"); /*check signer is not null*/

        uint96 balance = getPriorVotes(signatory, prop.votingStarts); /*fetch & gas-optimize voting weight at proposal creation time*/

        require(prop.votingEnds >= block.timestamp, "ended"); /*check voting period has not ended*/
        require(!members[signatory].voted[proposal], "voted"); /*check vote not already cast*/

        unchecked {
            if (approved) {
                /*if `approved`, cast delegated balance `yesVotes` to proposal*/
                prop.yesVotes += balance;
                members[signatory].highestIndexYesVote = proposal;
            } else {
                /*otherwise, cast delegated balance `noVotes` to proposal*/
                prop.noVotes += balance;
            }
        }

        members[signatory].voted[proposal] = true; /*record voting action to `members` struct per user account*/

        emit SubmitVote(signatory, balance, proposal, approved); /*emit event reflecting vote*/
    }

    // ********************
    // PROCESSING FUNCTIONS
    // ********************
    /// @notice Process `proposal` & execute internal functions based on `flag`[#].
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    /// @param revertOnFailure Optionally revert if actions fail to process - useful to move past stuck actions
    function processProposal(uint256 proposal, bool revertOnFailure) external nonReentrant {
        Proposal storage prop = proposals[proposal]; /*alias `proposal` storage pointers*/

        _processingReady(proposal, prop); /*validate `proposal` processing requirements*/

        /*check if `proposal` approved by simple majority of members*/
        if (prop.yesVotes > prop.noVotes) {
            proposalsPassed[proposal] = true; /*flag that proposal passed - allows minion-like extensions*/
            bool success = processActionProposal(prop); /*execute 'action'*/
            if (revertOnFailure) require(success, "call failure");
            if (!success) prop.actionFailed = true;
        }

        if (prop.actionFailed) {
            emit ProcessingFailed(proposal); /*emits when proposal is processed & executed*/
        } else {
            delete proposals[proposal]; /*delete given proposal struct details for gas refund & the commons*/

            emit ProcessProposal(proposal); /*emit event reflecting that given proposal processed*/
        }
    }

    /// @notice Internal function to process 'action'[0] proposal.
    function processActionProposal(Proposal memory prop)
        private
        returns (bool success)
    {
        success = execute(
            multisendLibrary,
            0,
            prop.proposalData,
            Enum.Operation.DelegateCall,
            gasleft()
        );
    }

    /// @notice Baal only function to mint shares
    function mintShares(address[] calldata to, uint96[] calldata amount)
        external
        baalOnly
    {
        require(to.length == amount.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < to.length; i++) {
            _mintShares(to[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Baal only function to mint loot
    function mintLoot(address[] calldata to, uint96[] calldata amount)
        external
        baalOnly
    {
        require(to.length == amount.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < to.length; i++) {
            _mintLoot(to[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Baal only function to convert shares to loot
    function convertSharesToLoot(address to) external baalOnly {
        uint96 removedBalance = uint96(balanceOf[to]); /*gas-optimize variable*/
        _burnShares(to, removedBalance); /*burn all of `to` `shares` & convert into `loot`*/
        _mintLoot(to, removedBalance); /*mint equivalent `loot`*/
    }

    /// @notice Baal only function to change periods
    function setPeriods(bytes memory _periodData) external baalOnly {
        (
            uint32 min,
            uint32 max,
            uint32 grace,
            bool pauseLoot,
            bool pauseShares
        ) = abi.decode(_periodData, (uint32, uint32, uint32, bool, bool));
        if (min != 0) minVotingPeriod = min; /*if positive, reset min. voting periods to first `value`*/
        if (max != 0) maxVotingPeriod = max; /*if positive, reset max. voting periods to second `value`*/
        if (grace != 0) gracePeriod = grace; /*if positive, reset grace period to third `value`*/
        lootPaused = pauseLoot; /*set pause `loot` transfers on fifth `value`*/
        sharesPaused = pauseShares; /*set pause `shares` transfers on sixth `value`*/
    }

    /// @notice Baal only function to set flash fee numerator
    function setFlashFeeNumerator(uint32 _flashFeeNumerator) external baalOnly {
        flashFeeNumerator = _flashFeeNumerator;
    }

    /// @notice Baal only function to set shaman status
    function setShamans(address[] calldata _shamans, bool enabled)
        external
        baalOnly
    {
        for (uint256 i; i < _shamans.length; i++) {
            shamans[_shamans[i]] = enabled;
        }
    }

    /// @notice Baal only function to whitelist guildToken
    function setGuildTokens(address[] calldata _tokens) external baalOnly {
        for (uint256 i; i < _tokens.length; i++) {
            if (guildTokens.length != MAX_GUILD_TOKEN_COUNT)
                guildTokens.push(_tokens[i]); /*push account to `guildTokens` array if within 'MAX'*/
        }
    }

    /// @notice Baal only function to remove guildToken
    function unsetGuildTokens(uint256[] calldata _tokenIndexes)
        external
        baalOnly
    {
        for (uint256 i; i < _tokenIndexes.length; i++) {
            guildTokens[_tokenIndexes[i]] = guildTokens[guildTokens.length - 1]; /*swap-to-delete index with last value*/
            guildTokens.pop(); /*pop account from `guildTokens` array*/
        }
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
        require(block.timestamp <= deadline, "expired"); /*check signature is not expired*/

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
        uint96 amount,
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
    function transfer(address to, uint96 amount)
        external
        returns (bool success)
    {
        require(!sharesPaused, "!transferable");

        balanceOf[msg.sender] -= amount;

        unchecked {
            balanceOf[to] += amount;
        }

        _moveDelegates(delegates[msg.sender], delegates[to], amount);

        emit Transfer(msg.sender, to, amount);

        success = true;
    }

    /// @notice Transfer `amount` tokens from `from` to `to`.
    /// @param from The address of the source account.
    /// @param to The address of the destination account.
    /// @param amount The number of `shares` tokens to transfer.
    /// @return success Whether or not the transfer succeeded.
    function transferFrom(
        address from,
        address to,
        uint96 amount
    ) external returns (bool success) {
        require(!sharesPaused, "!transferable");

        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }

        balanceOf[from] -= amount;

        unchecked {
            balanceOf[to] += amount;
        }

        _moveDelegates(delegates[from], delegates[to], amount);

        emit Transfer(from, to, amount);

        success = true;
    }

    /// @notice Transfer `amount` `loot` from user to `to`.
    /// @param to The address of destination account.
    /// @param amount The sum of loot to transfer.
    function transferLoot(address to, uint96 amount) external {
        require(!lootPaused, "!transferable");

        members[msg.sender].loot -= amount;

        unchecked {
            members[to].loot += amount;
        }

        emit TransferLoot(msg.sender, to, amount);
    }

    /// @notice Flashloan ability that conforms to `IERC3156FlashLender`, as defined in 'https://eips.ethereum.org/EIPS/eip-3156'.
    /// @param receiver Address of token receiver that conforms to `IERC3156FlashBorrower` & handles flashloan.
    /// @param token The loan currency.
    /// @param amount The amount of tokens lent.
    /// @param data Arbitrary data structure, intended to contain user-defined parameters.
    function flashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external returns (bool success) {
        uint256 fee = flashFee(token, amount);
        require(fee != 0, "uninitialized");

        _safeTransfer(token, receiver, amount);

        (, bytes memory _flashData) = receiver.call(
            abi.encodeWithSelector(
                0x23e30c8b,
                msg.sender,
                token,
                amount,
                fee,
                data
            )
        ); /*'onFlashLoan(address,address,uint,uint,bytes)'*/
        bytes32 flashData = abi.decode(_flashData, (bytes32));
        require(
            flashData == keccak256("ERC3156FlashBorrower.onFlashLoan"),
            "Callback failed"
        ); /*checks flash loan success*/

        _safeTransferFrom(token, receiver, address(this), amount + fee);

        success = true;
    }

    /// @notice Process member burn of `shares` and/or `loot` to claim 'fair share' of `guildTokens`.
    /// @param to Account that receives 'fair share'.
    /// @param lootToBurn Baal pure economic weight to burn.
    /// @param sharesToBurn Baal voting weight to burn.
    function ragequit(
        address to,
        uint96 lootToBurn,
        uint96 sharesToBurn
    ) external nonReentrant {
        require(
            proposals[members[msg.sender].highestIndexYesVote].votingEnds == 0,
            "processed"
        ); /*check highest index proposal member approved has processed*/

        for (uint256 i; i < guildTokens.length; i++) {
            (, bytes memory balanceData) = guildTokens[i].staticcall(
                abi.encodeWithSelector(0x70a08231, address(this))
            ); /*get Baal token balances - 'balanceOf(address)'*/
            uint256 balance = abi.decode(balanceData, (uint256)); /*decode Baal token balances for calculation*/

            uint256 amountToRagequit = ((lootToBurn + sharesToBurn) * balance) /
                (totalSupply + totalLoot); /*calculate 'fair shair' claims*/

            if (amountToRagequit != 0) {
                /*gas optimization to allow higher maximum token limit*/
                _safeTransfer(guildTokens[i], to, amountToRagequit); /*execute 'safe' token transfer*/
            }
        }

        if (lootToBurn != 0) {
            /*gas optimization*/
            _burnLoot(msg.sender, lootToBurn); /*subtract `loot` from user account & Baal totals*/
        }

        if (sharesToBurn != 0) {
            /*gas optimization*/
            _burnShares(msg.sender, sharesToBurn); /*subtract `shares` from user account & Baal totals with erc20 accounting*/
        }

        emit Ragequit(msg.sender, to, lootToBurn, sharesToBurn); /*event reflects claims made against Baal*/
    }

    /***************
    GETTER FUNCTIONS
    ***************/
    /// @notice Returns the current delegated `vote` balance for `account`.
    /// @param account The user to check delegated `votes` for.
    /// @return votes Current `votes` delegated to `account`.
    function getCurrentVotes(address account)
        external
        view
        returns (uint96 votes)
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
        returns (uint96 votes)
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

    /// @notice Returns array list of approved `guildTokens` in Baal for {ragequit}.
    /// @return tokens ERC-20s approved for {ragequit}.
    function getGuildTokens() external view returns (address[] memory tokens) {
        tokens = guildTokens;
    }

    /// @notice Returns the `fee` to be charged for a flash loan.
    /// @param amount The sum of tokens lent.
    /// @return fee The `fee` amount of 'token' to be charged for the loan, on top of the returned principal - uniform in Baal.
    function flashFee(address, uint256 amount)
        public
        view
        returns (uint256 fee)
    {
        fee = (amount * flashFeeNumerator) / 10000; /*Calculate `fee` - precision factor '10000' derived from ERC-3156 'Flash Loan Reference'*/
    }

    /// @notice Returns the `max` amount of `token` available to be lent.
    /// @param token The loan currency.
    /// @return max The `amount` of `token` that can be borrowed.
    function maxFlashLoan(address token) external view returns (uint256 max) {
        (, bytes memory balanceData) = token.staticcall(
            abi.encodeWithSelector(0x70a08231, address(this))
        ); /*get Baal token balance - 'balanceOf(address)'*/
        max = abi.decode(balanceData, (uint256)); /*decode Baal token balance for calculation*/
    }

    /***************
    HELPER FUNCTIONS
    ***************/
    /// @notice Allows batched calls to Baal.
    /// @param data An array of payloads for each call.
    function multicall(bytes[] calldata data)
        external
        returns (bytes[] memory results)
    {
        results = new bytes[](data.length);
        unchecked {
            for (uint256 i = 0; i < data.length; i++) {
                (bool success, bytes memory result) = address(this)
                    .delegatecall(data[i]);
                if (!success) {
                    if (result.length < 68) revert();
                    assembly {
                        result := add(result, 0x04)
                    }
                    revert(abi.decode(result, (string)));
                }
                results[i] = result;
            }
        }
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

    /// @notice Deposits ETH sent to Baal.
    receive() external payable {}

    /// @notice Delegates Baal voting weight.
    function _delegate(address delegator, address delegatee) private {
        address currentDelegate = delegates[delegator];

        delegates[delegator] = delegatee;

        _moveDelegates(
            currentDelegate,
            delegatee,
            uint96(balanceOf[delegator])
        );

        emit DelegateChanged(delegator, currentDelegate, delegatee);
    }

    /// @notice Elaborates delegate update - cf., 'Compound Governance'.
    function _moveDelegates(
        address srcRep,
        address dstRep,
        uint96 amount
    ) private {
        unchecked {
            if (srcRep != dstRep && amount != 0) {
                if (srcRep != address(0)) {
                    uint256 srcRepNum = numCheckpoints[srcRep];
                    uint96 srcRepOld = srcRepNum != 0
                        ? checkpoints[srcRep][srcRepNum - 1].votes
                        : 0;
                    uint96 srcRepNew = srcRepOld - amount;
                    _writeCheckpoint(srcRep, srcRepNum, srcRepOld, srcRepNew);
                }

                if (dstRep != address(0)) {
                    uint256 dstRepNum = numCheckpoints[dstRep];
                    uint96 dstRepOld = dstRepNum != 0
                        ? checkpoints[dstRep][dstRepNum - 1].votes
                        : 0;
                    uint96 dstRepNew = dstRepOld + amount;
                    _writeCheckpoint(dstRep, dstRepNum, dstRepOld, dstRepNew);
                }
            }
        }
    }

    /// @notice Elaborates delegate update - cf., 'Compound Governance'.
    function _writeCheckpoint(
        address delegatee,
        uint256 nCheckpoints,
        uint96 oldVotes,
        uint96 newVotes
    ) private {
        uint32 timeStamp = uint32(block.timestamp);

        unchecked {
            if (
                nCheckpoints != 0 &&
                checkpoints[delegatee][nCheckpoints - 1].fromTimeStamp ==
                timeStamp
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
    function _burnLoot(address from, uint96 loot) private {
        members[from].loot -= loot; /*subtract `loot` for `from` account*/

        unchecked {
            totalLoot -= loot; /*subtract from total Baal `loot`*/
        }

        emit TransferLoot(from, address(0), loot); /*emit event reflecting burn of `loot`*/
    }

    /// @notice Burn function for Baal `shares`.
    function _burnShares(address from, uint96 shares) private {
        balanceOf[from] -= shares; /*subtract `shares` for `from` account*/

        unchecked {
            totalSupply -= shares; /*subtract from total Baal `shares`*/
        }

        _moveDelegates(delegates[from], address(0), shares); /*update delegation*/

        emit Transfer(from, address(0), shares); /*emit event reflecting burn of `shares` with erc20 accounting*/
    }

    /// @notice Minting function for Baal `loot`.
    function _mintLoot(address to, uint96 loot) private {
        unchecked {
            if (totalSupply + loot <= type(uint96).max / 2) {
                members[to].loot += loot; /*add `loot` for `to` account*/

                totalLoot += loot; /*add to total Baal `loot`*/

                emit TransferLoot(address(0), to, loot); /*emit event reflecting mint of `loot`*/
            }
        }
    }

    /// @notice Minting function for Baal `shares`.
    function _mintShares(address to, uint96 shares) private {
        unchecked {
            if (totalSupply + shares <= type(uint96).max / 2) {
                balanceOf[to] += shares; /*add `shares` for `to` account*/

                totalSupply += shares; /*add to total Baal `shares`*/

                _moveDelegates(address(0), delegates[to], shares); /*update delegation*/

                emit Transfer(address(0), to, shares); /*emit event reflecting mint of `shares` with erc20 accounting*/
            }
        }
    }

    /// @notice Check to validate proposal processing requirements.
    function _processingReady(uint256 proposal, Proposal memory prop)
        private
        view
        returns (bool ready)
    {
        unchecked {
            require(proposal <= proposalCount, "!exist"); /*check proposal exists*/
            require(proposals[proposal - 1].votingEnds == 0 || proposals[proposal - 1].actionFailed, "prev!processed"); /*check previous proposal has processed by deletion or with failed action*/
            require(proposals[proposal].votingEnds != 0, "processed"); /*check given proposal has been sponsored & not yet processed by deletion*/
            require(proposals[proposal].expiration == 0 || proposals[proposal].expiration > block.timestamp, "expired"); /*check given proposal action has not expired */
            if (singleSummoner) return true; /*if single member, process early*/
            if (prop.yesVotes > totalSupply / 2) return true; /*process early if majority member support*/
            require(prop.votingEnds + gracePeriod <= block.timestamp, "!ended"); /*check voting period has ended*/
            ready = true; /*otherwise, process if voting period done*/
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
