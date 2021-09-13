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

import "@gnosis.pm/safe-contracts/contracts/libraries/MultiSend.sol";
import "@gnosis.pm/safe-contracts/contracts/base/Executor.sol";
import "./zodiac/core/Module.sol";
import "./zodiac/factory/ModuleProxyFactory.sol";

/// @notice Interface for Baal {memberAction} that adjusts member `shares` & `loot`.
interface IShaman {
    function memberAction(address member, uint96 loot, uint96 shares) external payable returns (uint96 lootOut, uint96 sharesOut);
}

// contract Baal is Module, Executor, Enum {

/// @title Baal';_;'.
/// @notice Flexible guild contract inspired by Moloch DAO framework.
contract Baal is Module, Executor, Enum {
    bool public lootPaused; /*tracks transferability of `loot` economic weight - amendable through 'period'[2] proposal*/
    bool public sharesPaused; /*tracks transferability of erc20 `shares` - amendable through 'period'[2] proposal*/
    
    uint8  constant public decimals = 18; /*unit scaling factor in erc20 `shares` accounting - '18' is default to match ETH & common erc20s*/
    uint16 constant MAX_GUILD_TOKEN_COUNT = 400; /*maximum number of whitelistable tokens subject to {ragequit}*/
    
    uint96 public totalLoot; /*counter for total `loot` economic weight held by `members`*/  
    uint96 public totalSupply; /*counter for total `members` voting `shares` with erc20 accounting*/
    
    uint public gracePeriod; /*time delay after proposal voting period for processing*/
    uint public minVotingPeriod; /*minimum period for voting in seconds - amendable through 'period'[2] proposal*/
    uint public maxVotingPeriod; /*maximum period for voting in seconds - amendable through 'period'[2] proposal*/
    uint public proposalCount; /*counter for total `proposals` submitted*/
    uint status; /*internal reentrancy check tracking value*/
    uint memberCount; /*internal membership counter to gauge speedy proposal processing*/
    
    string public name; /*'name' for erc20 `shares` accounting*/
    string public symbol; /*'symbol' for erc20 `shares` accounting*/
    
    bytes32 constant DOMAIN_TYPEHASH = keccak256('EIP712Domain(string name,uint chainId,address verifyingContract)'); /*EIP-712 typehash for Baal domain*/
    bytes32 constant DELEGATION_TYPEHASH = keccak256('Delegation(address delegatee,uint nonce,uint expiry)'); /*EIP-712 typehash for Baal delegation*/
    bytes32 constant PERMIT_TYPEHASH = keccak256('Permit(address owner,address spender,uint value,uint nonce,uint deadline)'); /*EIP-712 typehash for EIP-2612 {permit}*/
    bytes32 constant VOTE_TYPEHASH = keccak256('Vote(uint proposalId,bool support)'); /*EIP-712 typehash for Baal proposal vote*/
    
    address[] guildTokens; /*array list of erc20 tokens approved on summoning or by 'whitelist'[3] `proposals` for {ragequit} claims*/

    address public multisendLibrary; /*Library to execute multisend transactions*/
    
    mapping(address => mapping(address => uint))    public allowance; /*maps approved pulls of `shares` with erc20 accounting*/
    mapping(address => uint)                        public balanceOf; /*maps `members` accounts to `shares` with erc20 accounting*/
    mapping(address => mapping(uint => Checkpoint)) public checkpoints; /*maps record of vote `checkpoints` for each account by index*/
    mapping(address => uint)                        public numCheckpoints; /*maps number of `checkpoints` for each account*/
    mapping(address => address)                     public _delegates; /*maps record of each account's `shares` delegate*/
    mapping(address => uint)                        public nonces; /*maps tx record for signing & validating `shares` signatures*/
    
    mapping(address => Member) public members; /*maps `members` accounts to struct details*/
    mapping(uint => Proposal)  public proposals; /*maps `proposalCount` to struct details*/
    mapping(address => bool)   public shamans; /*maps contracts approved in 'whitelist'[3] proposals for {memberAction} that mint or burn `shares`*/
    
    event SummonComplete(bool lootPaused, bool sharesPaused, uint gracePeriod, uint minVotingPeriod, uint maxVotingPeriod, string name, string symbol, address[] guildTokens, address[] shamans, address[] summoners, uint96[] loot, uint96[] shares); /*emits after Baal summoning*/
    event SubmitProposal(bool self, uint indexed proposal, uint votingPeriod, bytes proposalData, string details); /*emits after proposal is submitted*/
    event SubmitVote(address indexed member, uint balance, uint indexed proposal, bool indexed approved); /*emits after vote is submitted on proposal*/
    event ProcessProposal(uint indexed proposal); /*emits when proposal is processed & executed*/
    event Ragequit(address indexed member, address to, uint96 lootToBurn, uint96 sharesToBurn); /*emits when users burn Baal `shares` and/or `loot` for given `to` account*/
    event Approval(address indexed owner, address indexed spender, uint amount); /*emits when Baal `shares` are approved for pulls with erc20 accounting*/
    event Transfer(address indexed from, address indexed to, uint amount); /*emits when Baal `shares` are minted, burned or transferred with erc20 accounting*/
    event TransferLoot(address indexed from, address indexed to, uint96 amount); /*emits when Baal `loot` is minted, burned or transferred*/
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate); /*emits when an account changes its voting delegate*/
    event DelegateVotesChanged(address indexed delegate, uint previousBalance, uint newBalance); /*emits when a delegate account's voting balance changes*/
    
    modifier nonReentrant() { /*reentrancy guard*/
        require(status == 1,'reentrant'); 
        status = 2; 
        _;
        status = 1;
    }
    
    modifier baalOnly() {
        require(msg.sender == address(this), '!baal');
        _;
    }
    
    struct Checkpoint { /*Baal checkpoint for marking number of delegated votes from given block*/
        uint32 fromBlock; /*block number for referencing voting balance*/
        uint96 votes; /*votes at given block number*/
    }
 
    struct Member { /*Baal membership details*/
        uint96 loot; /*economic weight held by `members` - combined with `shares` on {ragequit} - can be set on summoning & adjusted via {memberAction} or 'member'[1] proposal*/
        uint highestIndexYesVote; /*highest proposal index on which a member `approved`*/
        mapping(uint => bool) voted; /*maps voting decisions on proposals by `members` account*/
    }
    
    struct Proposal { /*Baal proposal details*/
        uint32 votingStarts; /*starting time for proposal in seconds since unix epoch*/
        uint32 votingEnds; /*termination date for proposal in seconds since unix epoch - derived from `votingPeriod` set on proposal*/
        uint96 yesVotes; /*counter for `members` `approved` 'votes' to calculate approval on processing*/
        uint96 noVotes; /*counter for `members` 'dis-approved' 'votes' to calculate approval on processing*/
        bool self; /*execute proposal through Baal or through Safe*/
        bytes proposalData; /*raw data associated with state updates*/
        string details; /*human-readable context for proposal*/
    }
    
    /// @notice Summon Baal with voting configuration & initial array of `members` accounts with `shares` & `loot` weights.
    /// @param _initializationParams Encoded setup information
    function setUp(
        bytes memory _initializationParams
        ) public override {
        (
            string memory _name, // _name Name for erc20 `shares` accounting.
            string memory _symbol, // _symbol Symbol for erc20 `shares` accounting.
            address _avatar, 
            address _multisendLibrary,
            bytes memory _initializationMultisendData // here you call BaalOnly functions to set up initial shares, loot, shamans, periods, etc
        ) = abi.decode(
                _initializationParams,
                (string, string, address, address, bytes)
            );
        name = _name; /*initialize Baal `name` with erc20 accounting*/
        symbol = _symbol; /*initialize Baal `symbol` with erc20 accounting*/

        multisendLibrary = _multisendLibrary;
        avatar = _avatar;

        // Execute all setups including
        // * mint shares
        // * convert shares to loot
        // * set shamans
        // * set periods
        require(execute(multisendLibrary, 0, _initializationMultisendData, Operation.DelegateCall, gasleft()), 'call failure');

        __Ownable_init();
        initialized = true;
        status = 1; /*initialize 'reentrancy guard' status*/
    }

    /// @notice Execute membership action to mint or burn `shares` and/or `loot` against whitelisted `shamans` in consideration of user & given amounts.
    /// @param shaman Whitelisted contract to trigger action.
    /// @param loot Economic weight involved in external call.
    /// @param shares Voting weight involved in external call.
    /// @param mint Confirm whether action involves 'mint' or 'burn' action - if `false`, perform burn.
    /// @return lootOut sharesOut Membership updates derived from action.
    function memberAction(address shaman, uint96 loot, uint96 shares, bool mint) external nonReentrant payable returns (uint96 lootOut, uint96 sharesOut) {
        require(shamans[shaman],'!shaman'); /*check `shaman` is approved*/
        (lootOut, sharesOut) = IShaman(shaman).memberAction{value: msg.value}(msg.sender, loot, shares); /*fetch 'reaction' per inputs*/
        if (mint) { /*execute `mint` actions*/
            if (lootOut != 0) _mintLoot(msg.sender, lootOut); emit TransferLoot(address(0), msg.sender, lootOut); /*add `loot` to user account & Baal total*/
            if (sharesOut != 0) _mintShares(msg.sender, sharesOut); /*add `shares` to user account & Baal total with erc20 accounting*/
        } else { /*otherwise, execute `burn` actions*/
            if (lootOut != 0) _burnLoot(msg.sender, lootOut); emit TransferLoot(msg.sender, address(0), lootOut); /*subtract `loot` from user account & Baal total*/
            if (sharesOut != 0) _burnShares(msg.sender, sharesOut); /*subtract `shares` from user account & Baal total with erc20 accounting*/
        }
    }
    
    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    /// @notice Submit proposal to Baal `members` for approval within given voting period.
    /// @param self Execute on Baal or Safe
    /// @param votingPeriod Voting period in seconds.
    /// @param proposalData Multisend encoded transactions or proposal data
    /// @param details Context for proposal.
    /// @return proposal Count for submitted proposal.
    function submitProposal(bool self, uint32 votingPeriod, bytes calldata proposalData, string calldata details) external nonReentrant returns (uint proposal) {
        require(balanceOf[msg.sender] != 0,'!member'); /*check 'membership' - required to submit proposal*/
        require(minVotingPeriod <= votingPeriod && votingPeriod <= maxVotingPeriod,'!votingPeriod'); /*check voting period is within Baal bounds*/
        unchecked {
            proposalCount++; /*increment proposal counter*/
            proposals[proposalCount] = Proposal(uint32(block.number), uint32(block.timestamp) + votingPeriod, 0, 0, self, proposalData, details); /*push params into proposal struct - start voting period timer*/
        }
        emit SubmitProposal(self, proposal, votingPeriod, proposalData, details); /*emit event reflecting proposal submission*/
    }

    /// @notice Submit vote - proposal must exist & voting period must not have ended.
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on.
    /// @param approved If 'true', member will cast `yesVotes` onto proposal - if 'false', `noVotes` will be counted.
    function submitVote(uint proposal, bool approved) external nonReentrant {
        Proposal storage prop = proposals[proposal]; /*alias proposal storage pointers*/
        uint96 balance = getPriorVotes(msg.sender, prop.votingStarts); /*fetch & gas-optimize voting weight at proposal creation time*/
        require(prop.votingEnds >= block.timestamp,'ended'); /*check voting period has not ended*/
        unchecked {
            if (approved) { 
                prop.yesVotes += balance; members[msg.sender].highestIndexYesVote = proposal; /*if `approved`, cast delegated balance `yesVotes` to proposal*/
            } else { 
                prop.noVotes += balance; /*otherwise, cast delegated balance `noVotes` to proposal*/
            }
        }
        members[msg.sender].voted[proposal] = approved; /*record voting decision to `members` struct per user account*/
        emit SubmitVote(msg.sender, balance, proposal, approved); /*emit event reflecting vote*/
    }
    
    /// @notice Submit vote with EIP-712 signature - proposal must exist & voting period must not have ended.
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on.
    /// @param approved If 'true', member will cast `yesVotes` onto proposal - if 'false', `noVotes` will be counted.
    /// @param v The recovery byte of the signature.
    /// @param r Half of the ECDSA signature pair.
    /// @param s Half of the ECDSA signature pair.
    function submitVoteWithSig(uint proposal, bool approved, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        Proposal storage prop = proposals[proposal]; /*alias proposal storage pointers*/
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), block.chainid, address(this))); /*calculate EIP-712 domain hash*/
        bytes32 structHash = keccak256(abi.encode(VOTE_TYPEHASH, proposal, approved)); /*calculate EIP-712 struct hash*/
        bytes32 digest = keccak256(abi.encodePacked('\x19\x01', domainSeparator, structHash)); /*calculate EIP-712 digest for signature*/
        address signatory = ecrecover(digest, v, r, s); /*recover signer from hash data*/
        require(signatory != address(0),'!signatory'); /*check signer is not null*/
        uint96 balance = uint96(getPriorVotes(signatory, prop.votingStarts)); /*fetch & gas-optimize voting weight at proposal creation time*/
        require(prop.votingEnds >= block.timestamp,'ended'); /*check voting period has not ended*/
        unchecked {
            if (approved) { /*if `approved`, cast delegated balance `yesVotes` to proposal*/
                prop.yesVotes += balance; members[signatory].highestIndexYesVote = proposal;
            } else { /*otherwise, cast delegated balance `noVotes` to proposal*/
                prop.noVotes += balance;
            }
        }
        members[signatory].voted[proposal] = approved; /*record voting decision to `members` struct per `signatory` account*/
        emit SubmitVote(signatory, balance, proposal, approved); /*emit event reflecting vote*/
    }
        
    // ********************
    // PROCESSING FUNCTIONS
    // ********************
    /// @notice Process `proposal` & execute internal functions based on `self`.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processProposal(uint proposal) external nonReentrant {
        Proposal storage prop = proposals[proposal]; /*alias `proposal` storage pointers*/
        _processingReady(proposal, prop); /*validate `proposal` processing requirements*/
        if (prop.yesVotes > prop.noVotes) /*check if `proposal` approved by simple majority of members*/
            if (prop.self) processActionProposal(prop); /*check `self`, execute 'action' on baal*/
            else processSafeProposal(prop); /*otherwise, execute 'safe action' on safe*/
        delete proposals[proposal]; /*delete given proposal struct details for gas refund & the commons*/
        emit ProcessProposal(proposal); /*emit event reflecting that given proposal processed*/
    }
    
    /// @notice Internal function to process 'action'[0] proposal.
    function processActionProposal(Proposal memory prop) private {
        require(execute(multisendLibrary, 0, prop.proposalData, Operation.DelegateCall, gasleft()), 'call failure');
    }

    /// @notice Internal function to process 'safe'[1] proposal.
    function processSafeProposal(Proposal memory prop) private {
        require(exec(multisendLibrary, 0, prop.proposalData, Operation.DelegateCall), 'call failure');
    }

    /// @notice Baal only function to mint shares
    function mintShares (address[] calldata to, uint96[] calldata amount) external baalOnly {
        require(to.length == amount.length,'!array parity'); /*check array lengths match*/
        for (uint256 i = 0; i < to.length; i++) {
            _mintShares(to[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Baal only function to convert shares to loot
    function convertSharesToLoot (address to) external baalOnly {
            uint96 removedBalance = uint96(balanceOf[to]); /*gas-optimize variable*/
            _burnShares(to, removedBalance); /*burn all of `to` `shares` & convert into `loot`*/
            _mintLoot(to, removedBalance); /*mint equivalent `loot`*/
    }

    /// @notice Baal only function to change periods
    function processPeriodProposal(bytes memory periodData) external baalOnly {
        (uint32 min, uint32 max, uint32 grace, bool pauseLoot, bool pauseShares) = abi.decode(periodData, (uint32, uint32, uint32, bool, bool));
        if (min != 0) minVotingPeriod = min; /*if positive, reset min. voting periods to first `value`*/ 
        if (max != 0) maxVotingPeriod = max; /*if positive, reset max. voting periods to second `value`*/
        if (grace != 0) gracePeriod = grace; /*if positive, reset grace period to third `value`*/
        lootPaused = pauseLoot; /*set pause `loot` transfers on fifth `value`*/
        sharesPaused = pauseShares; /*set pause `shares` transfers on sixth `value`*/
    }  

    /// @notice Baal only function to set shaman status
    function setShamans (address[] calldata _shamans, bool enabled) external baalOnly {
        for (uint256 i; i < _shamans.length; i++) {
            shamans[_shamans[i]] = enabled;
        }
    }

    /// @notice Baal only function to whitelist guildToken
    function setGuildTokens (address[] calldata _tokens) external baalOnly {
        for (uint256 i; i < _tokens.length; i++) {
            if (guildTokens.length != MAX_GUILD_TOKEN_COUNT) guildTokens.push(_tokens[i]); /*push account to `guildTokens` array if within 'MAX'*/
        }
    }

    /// @notice Baal only function to remove guildToken
    function unsetGuildTokens (uint256[] calldata _tokenIndexes) external baalOnly {
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
    function approve(address to, uint amount) external returns (bool success) {
        allowance[msg.sender][to] = amount; /*adjust `allowance`*/
        emit Approval(msg.sender, to, amount); /*emit event reflecting approval*/
        success = true; /*confirm approval with ERC-20 accounting*/
    }
    
    /// @notice Delegate votes from user to `delegatee`.
    /// @param delegatee The address to delegate votes to.
    function delegate(address delegatee) external {
        _delegate(msg.sender, delegatee);
    }
    
    /// @notice Delegates votes from `signatory` to `delegatee`.
    /// @param delegatee The address to delegate 'votes' to.
    /// @param nonce The contract state required to match the signature.
    /// @param deadline The time at which to expire the signature.
    /// @param v The recovery byte of the signature.
    /// @param r Half of the ECDSA signature pair.
    /// @param s Half of the ECDSA signature pair.
    function delegateBySig(address delegatee, uint nonce, uint deadline, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), block.chainid, address(this))); /*calculate EIP-712 domain hash*/
        unchecked {
            bytes32 structHash = keccak256(abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, deadline)); /*calculate EIP-712 struct hash*/
            bytes32 digest = keccak256(abi.encodePacked('\x19\x01', domainSeparator, structHash)); /*calculate EIP-712 digest for signature*/
            address signatory = ecrecover(digest, v, r, s); /*recover signer from hash data*/
            require(signatory != address(0),'!signature'); /*check signer is not null*/
            require(nonce == nonces[signatory]++,'!nonce'); /*check given `nonce` is next in `nonces`*/
            require(block.timestamp <= deadline,'expired'); /*check signature is not expired*/
            _delegate(signatory, delegatee); /*execute delegation*/
        }
    }

    /// @notice Triggers an approval from owner to spends.
    /// @param owner The address to approve from.
    /// @param spender The address to be approved.
    /// @param amount The number of tokens that are approved (2^256-1 means infinite).
    /// @param deadline The time at which to expire the signature.
    /// @param v The recovery byte of the signature.
    /// @param r Half of the ECDSA signature pair.
    /// @param s Half of the ECDSA signature pair.
    function permit(address owner, address spender, uint96 amount, uint deadline, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), block.chainid, address(this))); /*calculate EIP-712 domain hash*/
        unchecked {
            bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, amount, nonces[owner]++, deadline)); /*calculate EIP-712 struct hash*/
            bytes32 digest = keccak256(abi.encodePacked('\x19\x01', domainSeparator, structHash)); /*calculate EIP-712 digest for signature*/
            address signatory = ecrecover(digest, v, r, s); /*recover signer from hash data*/
            require(signatory != address(0),'!signature'); /*check signer is not null*/
            require(signatory == owner,'!authorized'); /*check signer is `owner`*/
        }
        require(block.timestamp <= deadline,'expired'); /*check signature is not expired*/
        allowance[owner][spender] = amount; /*adjust `allowance`*/
        emit Approval(owner, spender, amount); /*emit event reflecting approval*/
    }
    
    /// @notice Transfer `amount` tokens from user to `to`.
    /// @param to The address of destination account.
    /// @param amount The number of tokens to transfer.
    /// @return success Whether or not the transfer succeeded.
    function transfer(address to, uint96 amount) external returns (bool success) {
        require(!sharesPaused,'!transferable');
        balanceOf[msg.sender] -= amount;
        unchecked {
            balanceOf[to] += amount;
        }
        _moveDelegates(msg.sender, to, amount);
        emit Transfer(msg.sender, to, amount);
        success = true;
    }
        
    /// @notice Transfer `amount` tokens from `from` to `to`.
    /// @param from The address of the source account.
    /// @param to The address of the destination account.
    /// @param amount The number of tokens to transfer.
    /// @return success Whether or not the transfer succeeded.
    function transferFrom(address from, address to, uint96 amount) external returns (bool success) {
        require(!sharesPaused,'!transferable');
        if (allowance[from][msg.sender] != type(uint).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += amount;
        }
        _moveDelegates(from, to, amount);
        emit Transfer(from, to, amount);
        success = true;
    }
    
    /// @notice Transfer `amount` `loot` from user to `to`.
    /// @param to The address of destination account.
    /// @param amount The sum of loot to transfer.
    function transferLoot(address to, uint96 amount) external {
        require(!lootPaused,'!transferable');
        members[msg.sender].loot -= amount;
        unchecked {
            members[to].loot += amount;
        }
        emit TransferLoot(msg.sender, to, amount);
    }

    /// @notice Process member burn of `shares` and/or `loot` to claim 'fair share' of `guildTokens`.
    /// @param lootToBurn Baal pure economic weight to burn.
    /// @param sharesToBurn Baal voting weight to burn.
    function ragequit(address to, uint96 lootToBurn, uint96 sharesToBurn) external nonReentrant {
        require(proposals[members[msg.sender].highestIndexYesVote].votingEnds == 0,'processed'); /*check highest index proposal member approved has processed*/
        for (uint i; i < guildTokens.length; i++) {
            (,bytes memory balanceData) = guildTokens[i].staticcall(abi.encodeWithSelector(0x70a08231, address(this))); /*get Baal token balances - 'balanceOf(address)'*/
            uint balance = abi.decode(balanceData, (uint)); /*decode Baal token balances for calculation*/
            uint amountToRagequit = ((lootToBurn + sharesToBurn) * balance) / totalSupply; /*calculate 'fair shair' claims*/
            if (amountToRagequit != 0) { /*gas optimization to allow higher maximum token limit*/
                _safeTransfer(guildTokens[i], to, amountToRagequit); /*execute 'safe' token transfer*/
            }
        }
        if (lootToBurn != 0) /*gas optimization*/ 
            _burnLoot(msg.sender, lootToBurn); /*subtract `loot` from user account & Baal totals*/
        if (sharesToBurn != 0) /*gas optimization*/ 
            _burnShares(msg.sender, sharesToBurn);  /*subtract `shares` from user account with erc20 accounting*/
        emit Ragequit(msg.sender, to, lootToBurn, sharesToBurn); /*event reflects claims made against Baal*/
    }

    /***************
    GETTER FUNCTIONS
    ***************/
    /// @notice Overrides standard 'Comp.sol' delegation mapping to return delegator's own address if they haven't delegated.
    /// This avoids having to delegate to oneself. Adapted from 'NounsToken'.
    /// @return deleg Account with delegated 'votes'.
    function delegates(address delegator) external view returns (address deleg) {
        deleg == address(0) ? delegator : _delegates[delegator];
    }

    /// @notice Returns the current delegated `vote` balance for `account`.
    /// @param account The user to check delegated `votes` for.
    /// @return votes Current `votes` delegated to `account`.
    function getCurrentVotes(address account) external view returns (uint96 votes) {
        uint nCheckpoints = numCheckpoints[account];
        unchecked { votes = nCheckpoints != 0 ? checkpoints[account][nCheckpoints - 1].votes : 0; }
    }
    
    /// @notice Returns the prior number of `votes` for `account` as of `blockNumber`.
    /// @param account The user to check `votes` for.
    /// @param blockNumber The block to check `votes` for.
    /// @return votes Prior `votes` delegated to `account`.
    function getPriorVotes(address account, uint blockNumber) public view returns (uint96 votes) {
        require(blockNumber < block.number,'!determined');
        uint nCheckpoints = numCheckpoints[account];
        if (nCheckpoints == 0) { votes = 0; }
        unchecked {
            if (checkpoints[account][nCheckpoints - 1].fromBlock <= blockNumber) { votes = checkpoints[account][nCheckpoints - 1].votes; }
            if (checkpoints[account][0].fromBlock > blockNumber) { votes = 0; }
            uint lower = 0; uint upper = nCheckpoints - 1;
            while (upper > lower) {
                uint center = upper - (upper - lower) / 2;
                Checkpoint memory cp = checkpoints[account][center];
                if (cp.fromBlock == blockNumber) { votes = cp.votes; } 
                else if (cp.fromBlock < blockNumber) { lower = center; } 
                else { upper = center - 1; }
            }
            votes = checkpoints[account][lower].votes;
        }
    }
    
    /// @notice Returns array list of approved `guildTokens` in Baal for {ragequit}.
    /// @return tokens ERC-20 approved for {ragequit}.
    function getGuildTokens() external view returns (address[] memory tokens) {
        tokens = guildTokens;
    }

    /// @notice Returns self for given Baal `proposal` describing type: true - Baal, false - Safe
    /// @param proposal The index to check self for.
    /// @return self
    function getProposalType(uint proposal) external view returns (bool self) {
        self = proposals[proposal].self;
    }
    
    /// @notice Returns 'true/false' 'vote' by given `account` on Baal `proposal` to indicate whether `approved`.
    /// @param account The user to check votes for.
    /// @param proposal The index to check votes for.
    /// @return vote If 'true', user voted to approve `proposal`.
    function getProposalVotes(address account, uint proposal) external view returns (bool vote) {
        vote = members[account].voted[proposal];
    }

    /***************
    HELPER FUNCTIONS
    ***************/
    /// @notice Returns confirmation for 'safe' ERC-721 (NFT) transfers to Baal.
    function onERC721Received(address, address, uint, bytes calldata) external pure returns (bytes4 sig) {
        sig = 0x150b7a02; /*'onERC721Received(address,address,uint,bytes)'*/
    }
    
    /// @notice Returns confirmation for 'safe' ERC-1155 transfers to Baal.
    function onERC1155Received(address, address, uint, uint, bytes calldata) external pure returns (bytes4 sig) {
        sig = 0xf23a6e61; /*'onERC1155Received(address,address,uint,uint,bytes)'*/
    }
    
    /// @notice Returns confirmation for 'safe' batch ERC-1155 transfers to Baal.
    function onERC1155BatchReceived(address, address, uint[] calldata, uint[] calldata, bytes calldata) external pure returns (bytes4 sig) {
        sig = 0xbc197c81; /*'onERC1155BatchReceived(address,address,uint[],uint[],bytes)'*/
    }
    
    /// @notice Deposits ETH sent to Baal.
    receive() external payable {}

    /// @notice Delegates Baal voting weight.
    function _delegate(address delegator, address delegatee) private {
        address currentDelegate = _delegates[delegator];
        if (currentDelegate != delegatee)
            _delegates[delegator] = delegatee;
            _moveDelegates(currentDelegate, delegatee, uint96(balanceOf[delegator]));
            emit DelegateChanged(delegator, currentDelegate, delegatee);
    }
    
    /// @notice Elaborates delegate update - cf., 'Compound Governance'.
    function _moveDelegates(address srcRep, address dstRep, uint96 amount) private {
        if (srcRep != dstRep && amount != 0) {
            if (srcRep != address(0)) {
                uint srcRepNum = numCheckpoints[srcRep];
                uint96 srcRepOld = srcRepNum > 0 ? checkpoints[srcRep][srcRepNum - 1].votes : 0;
                uint96 srcRepNew = srcRepOld - amount;
                _writeCheckpoint(srcRep, srcRepNum, srcRepOld, srcRepNew);
            }
            if (dstRep != address(0)) {
                uint dstRepNum = numCheckpoints[dstRep];
                uint96 dstRepOld = dstRepNum > 0 ? checkpoints[dstRep][dstRepNum - 1].votes : 0;
                uint96 dstRepNew = dstRepOld + amount;
                _writeCheckpoint(dstRep, dstRepNum, dstRepOld, dstRepNew);
            }
        }
    }
    
    /// @notice Elaborates delegate update - cf., 'Compound Governance'.
    function _writeCheckpoint(address delegatee, uint nCheckpoints, uint96 oldVotes, uint96 newVotes) private {
        uint32 blockNumber = uint32(block.number);
        if (nCheckpoints > 0 && checkpoints[delegatee][nCheckpoints - 1].fromBlock == blockNumber) {
          checkpoints[delegatee][nCheckpoints - 1].votes = newVotes;
        } else {
          checkpoints[delegatee][nCheckpoints] = Checkpoint(blockNumber, newVotes);
          numCheckpoints[delegatee] = nCheckpoints + 1;
        }
        emit DelegateVotesChanged(delegatee, oldVotes, newVotes);
    }
    
    /// @notice Burn function for Baal `loot`.
    function _burnLoot(address from, uint96 loot) private {
        members[from].loot -= loot; /*subtract `loot` for `from` account*/
        totalLoot -= loot; /*subtract from total Baal `loot`*/
        emit TransferLoot(from, address(0), loot); /*emit event reflecting burn of `loot`*/
    }
    
    /// @notice Burn function for Baal `shares`.
    function _burnShares(address from, uint96 shares) private {
        balanceOf[from] -= shares; /*subtract `shares` for `from` account*/
        totalSupply -= shares; /*subtract from total Baal `shares`*/
        emit Transfer(from, address(0), shares); /*emit event reflecting burn of `shares` with erc20 accounting*/
    }
    
    /// @notice Minting function for Baal `loot`.
    function _mintLoot(address to, uint96 loot) private {
        members[to].loot += loot; /*add `loot` for `to` account*/
        totalLoot += loot; /*add to total Baal `loot`*/
        emit TransferLoot(address(0), to, loot); /*emit event reflecting mint of `loot`*/
    }
    
    /// @notice Minting function for Baal `shares`.
    function _mintShares(address to, uint96 shares) private {
        balanceOf[to] += shares; /*add `shares` for `to` account*/
        totalSupply += shares; /*add to total Baal `shares`*/
        emit Transfer(address(0), to, shares); /*emit event reflecting mint of `shares` with erc20 accounting*/
    }
 
    /// @notice Check to validate proposal processing requirements. 
    function _processingReady(uint proposal, Proposal memory prop) private view returns (bool ready) {
        unchecked {
            require(proposal <= proposalCount,'!exist'); /*check proposal exists*/
            require(prop.votingEnds + gracePeriod <= block.timestamp,'!ended'); /*check voting period has ended*/
            require(proposals[proposal - 1].votingEnds == 0,'prev!processed'); /*check previous proposal has processed by deletion*/
            require(proposals[proposal].votingEnds != 0,'processed'); /*check given proposal has not yet processed by deletion*/
            if (memberCount == 1) ready = true; /*if single member, process early*/
            else if (prop.yesVotes > totalSupply / 2) ready = true; /*process early if majority member support*/
            else if (prop.votingEnds >= block.timestamp) ready = true; /*otherwise, process if voting period done*/
        }
    }
    
    /// @notice Provides 'safe' {transfer} for tokens that do not consistently return 'true/false'.
    function _safeTransfer(address token, address to, uint amount) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount)); /*'transfer(address,uint)'*/
        require(success && (data.length == 0 || abi.decode(data, (bool))),'transfer failed'); /*checks success & allows non-conforming transfers*/
    }

    /// @notice Provides 'safe' {transferFrom} for tokens that do not consistently return 'true/false'.
    function _safeTransferFrom(address token, address from, address to, uint amount) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount)); /*'transferFrom(address,address,uint)'*/
        require(success && (data.length == 0 || abi.decode(data, (bool))),'transferFrom failed'); /*checks success & allows non-conforming transfers*/
    }
}
