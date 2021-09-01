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

/// @notice Interface for Baal {memberAction} that adjusts membership `shares` & `loot`.
interface IShaman {
    function memberAction(address member, uint96 loot, uint96 shares) external payable returns (uint96 lootOut, uint96 sharesOut);
}

/// @title Baal *;_;*.
/// @notice Guild contract inspired by Moloch DAO framework.
contract Baal {
    bool public lootPaused; /*tracks transferability of `loot` economic weight - amendable through 'period'[2] proposal*/
    bool public sharesPaused; /*tracks transferability of erc20 `shares` - amendable through 'period'[2] proposal*/
    
    uint public flashFeeNumerator; /*tracks 'fee' for {flashLoan} - e.g., '1 = 0.0001%'*/
    uint public gracePeriod; /*time delay after proposal voting period for processing*/
    uint public minVotingPeriod; /*minimum period for voting in seconds - amendable through 'period'[2] proposal*/
    uint public maxVotingPeriod; /*maximum period for voting in seconds - amendable through 'period'[2] proposal*/
    uint public proposalCount; /*counter for total `proposals` submitted*/
    uint summonerCount; /*initial summoner counter to gauge speedy processing*/
    
    uint96 public totalLoot; /*counter for total `loot` economic weight held by `members`*/  
    uint96 public totalSupply; /*counter for total `members` voting `shares` with erc20 accounting*/

    string public name; /*'name' for erc20 `shares` accounting*/
    string public symbol; /*'symbol' for erc20 `shares` accounting*/
    uint8  public constant decimals = 18; /*unit scaling factor in erc20 `shares` accounting - '18' is default to match ETH & common erc20s*/
    uint16 constant MAX_GUILD_TOKEN_COUNT = 400; /*maximum number of whitelisted tokens*/
    
    bytes32 public constant DOMAIN_TYPEHASH = keccak256('EIP712Domain(string name,uint chainId,address verifyingContract)'); /*EIP-712 typehash for Baal domain*/
    bytes32 public constant BALLOT_TYPEHASH = keccak256('Ballot(uint proposalId,bool support)'); /*EIP-712 typehash for ballot struct*/
    bytes32 public constant DELEGATION_TYPEHASH = keccak256('Delegation(address delegatee,uint nonce,uint expiry)'); /*EIP-712 typehash for delegation struct*/
    bytes32 public constant PERMIT_TYPEHASH = keccak256('Permit(address owner,address spender,uint value,uint nonce,uint deadline)'); /*EIP-712 typehash for EIP-2612 {permit}*/
    
    address[] guildTokens; /*array list of erc20 tokens approved on summoning or by 'whitelist'[3] `proposals` for {ragequit} claims*/
    
    mapping(address => mapping(address => uint))      public allowance; /*maps approved pulls of `shares` with erc20 accounting*/
    mapping(address => uint)                          public balanceOf; /*maps `members` accounts to `shares` with erc20 accounting*/
    mapping(address => mapping(uint => Checkpoint))   public checkpoints; /*maps record of vote `checkpoints` for each account by index*/
    mapping(address => uint)                          public numCheckpoints; /*maps number of `checkpoints` for each account*/
    mapping(address => address)                       public delegates; /*maps record of each account's `shares` delegate*/
    mapping(address => uint)                          public nonces; /*maps record of states for signing & validating `shares` signatures*/
    
    mapping(address => bool)     public shamans; /*maps contracts approved in 'whitelist'[3] proposals for {memberAction} that mint or burn `shares`*/
    mapping(address => Member)   public members; /*maps `members` accounts to struct details*/
    mapping(uint => Proposal)    public proposals; /*maps `proposalCount` to struct details*/
    
    event SummonComplete(address[] shamans, address[] guildTokens, address[] summoners, uint96[] loot, uint96[] shares, uint gracePeriod, uint minVotingPeriod, uint maxVotingPeriod, string name, string symbol, bool lootPaused, bool sharesPaused); /*emits after Baal summoning*/
    event SubmitProposal(address[] to, uint96[] value, uint votingPeriod, uint indexed proposal, uint8 indexed flag, bytes[] data, string details); /*emits after proposal is submitted*/
    event SubmitVote(address indexed member, uint balance, uint indexed proposal, bool indexed approved); /*emits after vote is submitted on proposal*/
    event ProcessProposal(uint indexed proposal); /*emits when proposal is processed & executed*/
    event Ragequit(address indexed memberAddress, address to, uint96 lootToBurn, uint96 sharesToBurn); /*emits when callers burn Baal `shares` and/or `loot` for a given `to` account*/
    event Approval(address indexed owner, address indexed spender, uint amount); /*emits when Baal `shares` are approved for pulls with erc20 accounting*/
    event Transfer(address indexed from, address indexed to, uint amount); /*emits when Baal `shares` are minted, burned or transferred with erc20 accounting*/
    event TransferLoot(address indexed from, address indexed to, uint96 amount); /*emits when Baal `loot` is minted, burned or transferred*/
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate); /*emits when an account changes its voting delegate*/
    event DelegateVotesChanged(address indexed delegate, uint previousBalance, uint newBalance); /*emits when a delegate account's voting balance changes*/
    
    uint status;
    modifier nonReentrant() { /*reentrancy guard*/
        require(status == 1,'reentrant'); 
        status = 2; 
        _;
        status = 1;
    }
    
    struct Checkpoint { /*Baal checkpoint for marking number of delegated votes from a given block*/
        uint32 fromBlock; /*block number for referencing voting balance*/
        uint96 votes; /*votes at given block number*/
    }
 
    struct Member { /*Baal membership details*/
        uint highestIndexYesVote; /*highest proposal index on which a member `approved`*/
        uint96 loot; /*economic weight held by `members` - combined with `shares` on {ragequit} - can be set on summoning & adjusted via {memberAction} or 'membership'[1] proposal*/
        mapping(uint => bool) voted; /*maps voting decisions on proposals by `members` account*/
    }
    
    struct Proposal { /*Baal proposal details*/
        uint32 votingStarts; /*starting time for proposal in seconds since unix epoch*/
        uint32 votingEnds; /*termination date for proposal in seconds since unix epoch - derived from `votingPeriod` set on proposal*/
        uint96 yesVotes; /*counter for `members` `approved` 'votes' to calculate approval on processing*/
        uint96 noVotes; /*counter for `members` 'dis-approved' 'votes' to calculate approval on processing*/
        bool[4] flags; /*flags for proposal type & status - [action, membership, period, whitelist]*/
        address[] to; /*account(s) that receive(s) Baal state updates*/
        uint96[] value; /*value associated with Baal state updates (also used to toggle)*/
        bytes[] data; /*raw data associated with Baal state updates (also used to toggle)*/
        string details; /*human-readable context for proposal*/
    }
    
    /// @notice Summon Baal with voting configuration & create initial array of `members` accounts with `shares` & `loot` weights.
    /// @param _shamans External contracts approved for {memberAction} that adjust `shares` & `loot`.
    /// @param _guildTokens Tokens approved for internal accounting - {ragequit} of `shares` &/or `loot`.
    /// @param _summoners Accounts to add as `members`.
    /// @param _loot Economic weight among `members`.
    /// @param _shares Voting weight among `members` (`shares` also have economic weight & are erc20 tokens).
    /// @param _gracePeriod Time delay in seconds after voting period before proposal can be processed.
    /// @param _minVotingPeriod Minimum voting period in seconds for `members` to cast votes on proposals.
    /// @param _maxVotingPeriod Maximum voting period in seconds for `members` to cast votes on proposals.
    /// @param _name Name for erc20 `shares` accounting.
    /// @param _symbol Symbol for erc20 `shares` accounting.
    constructor(
        address[] memory _shamans, 
        address[] memory _guildTokens, 
        address[] memory _summoners, 
        uint96[]  memory _loot, 
        uint96[]  memory _shares, 
        uint             _gracePeriod,
        uint             _minVotingPeriod, 
        uint             _maxVotingPeriod, 
        string    memory _name, 
        string    memory _symbol,
        bool             _sharesPaused) {
        require(_summoners.length == _loot.length && _loot.length == _shares.length,'!matched member arrays'); /*check `members`-related array lengths match*/
        unchecked {
            for (uint i; i < _shamans.length; i++) shamans[_shamans[i]] = true; /*update mapping of approved `shamans` in Baal*/
            for (uint i; i < _guildTokens.length; i++) guildTokens.push(_guildTokens[i]); /*update array of `guildTokens` approved for {ragequit}*/
            for (uint i; i < _summoners.length; i++) {
                _delegate(_summoners[i], _summoners[i]); /*delegate `summoners` voting weights to themselves - this saves a step before voting*/
                _mintLoot(_summoners[i], _loot[i]); /*mint Baal `loot` to `summoners`*/
                _mintShares(_summoners[i], _shares[i]); /*mint Baal `shares` to `summoners`*/ 
                summonerCount++; /*increment `summoners` counter*/
            }
        }
        gracePeriod = _gracePeriod; /*sets delay for processing proposal*/
        minVotingPeriod = _minVotingPeriod; /*set minimum voting period - adjustable via 'period'[2] proposal*/
        maxVotingPeriod = _maxVotingPeriod; /*set maximum voting period - adjustable via 'period'[2] proposal*/
        if (_sharesPaused) lootPaused = true; /*set initial transferability for 'loot' - if `sharesPaused`, transfers are blocked*/
        sharesPaused = _sharesPaused; /*set initial transferability for `shares` tokens - if 'true', transfers are blocked*/
        name = _name; /*initialize Baal `name` with erc20 accounting*/
        symbol = _symbol; /*initialize Baal `symbol` with erc20 accounting*/
        status = 1; /*initialize 'reentrancy guard' status*/
        emit SummonComplete(_shamans, _guildTokens, _summoners, _loot, _shares, _gracePeriod, _minVotingPeriod, _maxVotingPeriod, _name, _symbol, lootPaused, _sharesPaused); /*emit event reflecting Baal summoning completed*/
    }

    /// @notice Execute membership action to mint or burn `shares` and/or `loot` against whitelisted `shamans` in consideration of caller & given amounts.
    /// @param shaman Whitelisted contract to trigger action.
    /// @param loot Economic weight involved in external call.
    /// @param shares Voting weight involved in external call.
    /// @param mint Confirm whether action involves 'mint' or 'burn' action - if `false`, perform burn.
    /// @return lootOut sharesOut Membership updates derived from action.
    function memberAction(address shaman, uint96 loot, uint96 shares, bool mint) external nonReentrant payable returns (uint96 lootOut, uint96 sharesOut) {
        require(shamans[shaman],'!shaman'); /*check `shaman` is approved*/
        (lootOut, sharesOut) = IShaman(shaman).memberAction{value: msg.value}(msg.sender, loot, shares); /*fetch 'reaction' per inputs*/
        if (mint) { /*execute `mint` actions*/
            if (lootOut != 0) _mintLoot(msg.sender, lootOut); emit TransferLoot(address(0), msg.sender, lootOut); /*add `loot` to caller account & Baal total*/
            if (sharesOut != 0) _mintShares(msg.sender, sharesOut); /*add `shares` to caller account & Baal total with erc20 accounting*/
        } else { /*otherwise, execute `burn` actions*/
            if (lootOut != 0) _burnLoot(msg.sender, lootOut); emit TransferLoot(msg.sender, address(0), lootOut); /*subtract `loot` from caller account & Baal total*/
            if (sharesOut != 0) _burnShares(msg.sender, sharesOut); /*subtract `shares` from caller account & Baal total with erc20 accounting*/
        }
    }
    
    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    /// @notice Submit proposal to Baal `members` for approval within a given voting period.
    /// @param to Account to target for proposal.
    /// @param value Numerical value to bind to proposal.
    /// @param data Data to bind to proposal.
    /// @param details Context for proposal.
    /// @return proposal Count for submitted proposal.
    function submitProposal(address[] calldata to, uint96[] calldata value, uint32 votingPeriod, uint8 flag, bytes[] calldata data, string calldata details) external nonReentrant returns (uint proposal) {
        //require(balanceOf[msg.sender] != 0,'!member'); /*check 'membership' - required to submit proposal*/
        require(minVotingPeriod <= votingPeriod && votingPeriod <= maxVotingPeriod,'!votingPeriod'); /*check voting period is within bounds*/
        require(to.length <= 10,'array max'); /*limit executable actions to help avoid block gas limit errors on processing*/
        require(flag <= 3,'!flag'); /*check 'flag' is in bounds*/
        bool[4] memory flags; /*plant flags - [action, membership, period, whitelist]*/
        flags[flag] = true; /*flag proposal type for struct storage*/ 
        if (flag == 2) {
            require(value.length == 6,'unpacked'); /*check that `value` is packed for `period`[2] proposal*/
        } else {
            require(to.length == value.length && value.length == data.length,'!matched arrays'); /*check array lengths match*/
        }
        unchecked {
            proposalCount++; /*increment total proposal counter*/
            proposals[proposalCount] = Proposal(uint32(block.number), uint32(block.timestamp) + votingPeriod, 0, 0, flags, to, value, data, details); /*push params into proposal struct - start voting period timer*/
        }
        emit SubmitProposal(to, value, votingPeriod, proposal, flag, data, details); /*emit event reflecting proposal submission*/
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
        members[msg.sender].voted[proposal] = approved; /*record voting decision to `members` struct per caller account*/
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
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), getChainId(), address(this))); /*calculate EIP-712 domain hash*/
        bytes32 structHash = keccak256(abi.encode(BALLOT_TYPEHASH, proposal, approved)); /*calculate EIP-712 struct hash*/
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
    /// @notice Process `proposal` & execute internal functions based on `flag`[#].
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processProposal(uint proposal) external nonReentrant {
        Proposal storage prop = proposals[proposal]; /*alias `proposal` storage pointers*/
        _processingReady(proposal, prop); /*validate `proposal` processing requirements*/
        if (prop.yesVotes > prop.noVotes) /*check if `proposal` approved by simple majority of members*/
            if (prop.flags[0]) processActionProposal(prop); /*check `flag`, execute 'action'*/
            else if (prop.flags[1]) processMembershipProposal(prop); /*check `flag`, execute 'membership'*/
            else if (prop.flags[2]) processPeriodProposal(prop); /*check `flag`, execute 'period'*/
            else processWhitelistProposal(prop); /*otherwise, execute 'whitelist'*/
        delete proposals[proposal]; /*delete given proposal struct details for gas refund & the commons*/
        emit ProcessProposal(proposal); /*emit event reflecting that given proposal processed*/
    }
    
    /// @notice Process 'action'[0] proposal.
    function processActionProposal(Proposal memory prop) private returns (bytes memory returnData) {
        for (uint i; i < prop.to.length; i++) 
            (,returnData) = prop.to[i].call{value:prop.value[i]} /*pass ETH value(s), if any*/
            (prop.data[i]); /*execute low-level call(s)*/
    }
    
    /// @notice Process 'membership'[1] proposal.
    function processMembershipProposal(Proposal memory prop) private {
        for (uint i; i < prop.to.length; i++) {
            if (prop.data[i].length == 0) {
                _mintShares(prop.to[i], prop.value[i]); /*grant `to` `value` `shares`*/
            } else {
                uint96 removedBalance = uint96(balanceOf[prop.to[i]]); /*gas-optimize variable*/
                _burnShares(prop.to[i], removedBalance); /*burn all of `to` `shares` & convert into `loot`*/
                _mintLoot(prop.to[i], removedBalance); /*mint equivalent `loot`*/
            }
        }
    }
    
    /// @notice Process 'period'[2] proposal.
    function processPeriodProposal(Proposal memory prop) private {
        if (prop.value[0] != 0) minVotingPeriod = uint32(prop.value[0]); /*if positive, reset min. voting periods to first `value`*/ 
        if (prop.value[1] != 0) maxVotingPeriod = uint32(prop.value[1]); /*if positive, reset max. voting periods to second `value`*/
        if (prop.value[2] != 0) gracePeriod = uint32(prop.value[2]); /*if positive, reset grace period to third `value`*/
        if (prop.value[3] != 0) flashFeeNumerator = prop.value[3]; /*if positive, reset flash loan fee numerator to fourth `value`*/
        prop.value[4] == 0 ? lootPaused = false : lootPaused = true; /*if positive, pause `loot` transfers on fifth `value`*/
        prop.value[5] == 0 ? sharesPaused = false : sharesPaused = true; /*if positive, pause `shares` transfers on sixth `value`*/
    }  
        
    /// @notice Process 'whitelist'[3] proposal.
    function processWhitelistProposal(Proposal memory prop) private {
        for (uint i; i < prop.to.length; i++) 
            if (prop.value[i] == 0 && prop.data.length == 0) { /*if `value` & `data` are null, approve `shamans`*/
                shamans[prop.to[i]] = true; /*add account(s) to `shamans` extensions*/
                } else if (prop.value[i] == 0 && prop.data.length != 0) { /*if `value` is null & `data` is populated, remove `shamans`*/
                    shamans[prop.to[i]] = false; /*remove account(s) from `shamans` extensions*/
                } else if (prop.value[i] != 0 && prop.data.length == 0) { /*if `value` is positive & `data` is null, add `guildTokens`*/
                    if (guildTokens.length != MAX_GUILD_TOKEN_COUNT) guildTokens.push(prop.to[i]); /*push account to `guildTokens` array if within 'MAX'*/
                } else { /*otherwise, remove `guildTokens`*/
                    guildTokens[prop.value[i]] = guildTokens[guildTokens.length - 1]; /*swap-to-delete index with last value*/
                    guildTokens.pop(); /*pop account from `guildTokens` array*/
                }
    }
    
    /*******************
    GUILD MGMT FUNCTIONS
    *******************/
    /// @notice Approve `to` to transfer up to `amount`.
    /// @return Whether or not the approval succeeded.
    function approve(address to, uint amount) external returns (bool){
        allowance[msg.sender][to] = amount; /*adjust `allowance`*/
        emit Approval(msg.sender, to, amount); /*emit event reflecting approval*/
        return true; /*confirm approval with ERC-20 accounting*/
    }
    
    /// @notice Delegate votes from caller to `delegatee`.
    /// @param delegatee The address to delegate votes to.
    function delegate(address delegatee) external {
        _delegate(msg.sender, delegatee);
    }
    
    /// @notice Delegates votes from `signatory` to `delegatee`.
    /// @param delegatee The address to delegate 'votes' to.
    /// @param nonce The contract state required to match the signature.
    /// @param expiry The time at which to expire the signature.
    /// @param v The recovery byte of the signature.
    /// @param r Half of the ECDSA signature pair.
    /// @param s Half of the ECDSA signature pair.
    function delegateBySig(address delegatee, uint nonce, uint expiry, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), getChainId(), address(this))); /*calculate EIP-712 domain hash*/
        unchecked{bytes32 structHash = keccak256(abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, expiry)); /*calculate EIP-712 struct hash*/
        bytes32 digest = keccak256(abi.encodePacked('\x19\x01', domainSeparator, structHash)); /*calculate EIP-712 digest for signature*/
        address signatory = ecrecover(digest, v, r, s); /*recover signer from hash data*/
        require(signatory != address(0),'!signature'); /*check signer is not null*/
        require(nonce == nonces[signatory]++,'!nonce'); /*check given `nonce` is next in `nonces`*/
        require(block.timestamp <= expiry,'expired'); /*check signature is not expired*/
        _delegate(signatory, delegatee);} /*execute delegation*/
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
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), getChainId(), address(this))); /*calculate EIP-712 domain hash*/
        unchecked{bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, amount, nonces[owner]++, deadline)); /*calculate EIP-712 struct hash*/
        bytes32 digest = keccak256(abi.encodePacked('\x19\x01', domainSeparator, structHash)); /*calculate EIP-712 digest for signature*/
        address signatory = ecrecover(digest, v, r, s); /*recover signer from hash data*/
        require(signatory != address(0),'!signature'); /*check signer is not null*/
        require(signatory == owner,'!authorized');} /*check signer is `owner`*/
        require(block.timestamp <= deadline,'expired'); /*check signature is not expired*/
        allowance[owner][spender] = amount; /*adjust `allowance`*/
        emit Approval(owner, spender, amount); /*emit event reflecting approval*/
    }
    
    /// @notice Transfer `amount` tokens from caller to `to`.
    /// @param to The address of destination account.
    /// @param amount The number of tokens to transfer.
    /// @return Whether or not the transfer succeeded.
    function transfer(address to, uint96 amount) external returns (bool) {
        require(!sharesPaused,'!transferable');
        balanceOf[msg.sender] -= amount;
        unchecked{balanceOf[to] += amount;}
        _moveDelegates(msg.sender, to, amount);
        emit Transfer(msg.sender, to, amount);
        return true;
    }
        
    /// @notice Transfer `amount` tokens from `from` to `to`.
    /// @param from The address of the source account.
    /// @param to The address of the destination account.
    /// @param amount The number of tokens to transfer.
    /// @return Whether or not the transfer succeeded.
    function transferFrom(address from, address to, uint96 amount) external returns (bool) {
        require(!sharesPaused,'!transferable');
        if (allowance[from][msg.sender] != type(uint).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        unchecked{balanceOf[to] += amount;}
        _moveDelegates(from, to, amount);
        emit Transfer(from, to, amount);
        return true;
    }
    
    /// @notice Transfer `amount` `loot` from caller to `to`.
    /// @param to The address of destination account.
    /// @param amount The sum of loot to transfer.
    function transferLoot(address to, uint96 amount) external {
        require(!lootPaused,'!transferable');
        members[msg.sender].loot -= amount;
        unchecked{members[to].loot += amount;}
        emit TransferLoot(msg.sender, to, amount);
    }
    
    /// @notice Flashloan ability that conforms to `IERC3156FlashLender`, as defined in 'https://eips.ethereum.org/EIPS/eip-3156[ERC-3156]'.
    /// @param receiver Address of token receiver that conforms to `IERC3156FlashBorrower` & handles flashloan.
    /// @param token The loan currency.
    /// @param amount The amount of tokens lent.
    /// @param data Arbitrary data structure, intended to contain user-defined parameters.
    function flashLoan(
        address receiver,
        address token,
        uint amount,
        bytes calldata data
    ) external returns (bool success) {
        uint fee = flashFee(token, amount);
        _safeTransfer(token, receiver, amount);
        (,bytes memory returnData) = receiver.call(abi.encodeWithSelector(0x23e30c8b, msg.sender, token, amount, fee, data)); /*'onFlashLoan(address,address,uint,uint,bytes)'*/
        bytes32 flashData = abi.decode(returnData, (bytes32));
        require(flashData == keccak256('ERC3156FlashBorrower.onFlashLoan'),'Callback failed'); /*checks flash loan success*/
        _safeTransferFrom(token, receiver, address(this), amount + fee);
        return true;
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
            _burnLoot(msg.sender, lootToBurn); /*subtract `loot` from caller account & Baal totals*/
        if (sharesToBurn != 0) /*gas optimization*/ 
            _burnShares(msg.sender, sharesToBurn);  /*subtract `shares` from caller account with erc20 accounting*/
        emit Ragequit(msg.sender, to, lootToBurn, sharesToBurn); /*event reflects claims made against Baal*/
    }

    /***************
    GETTER FUNCTIONS
    ***************/
    /// @notice Internal function to return chain identifier per ERC-155.
    function getChainId() private view returns (uint chainId) {
        assembly {
            chainId := chainid()
        }
    }
    
    /// @notice Gets the current delegated 'vote' balance for `account`.
    function getCurrentVotes(address account) external view returns (uint96) {
        uint nCheckpoints = numCheckpoints[account];
        return nCheckpoints > 0 ? checkpoints[account][nCheckpoints - 1].votes : 0;
    }
    
    /// @notice Determine the prior number of votes for `account` as of `blockNumber`.
    function getPriorVotes(address account, uint blockNumber) public view returns (uint96) {
        require(blockNumber < block.number,'!determined');
        uint nCheckpoints = numCheckpoints[account];
        if (nCheckpoints == 0) {return 0;}
        if (checkpoints[account][nCheckpoints - 1].fromBlock <= blockNumber) {return checkpoints[account][nCheckpoints - 1].votes;}
        if (checkpoints[account][0].fromBlock > blockNumber) {return 0;}
        uint lower = 0; uint upper = nCheckpoints - 1;
        while (upper > lower){
            uint center = upper - (upper - lower) / 2;
            Checkpoint memory cp = checkpoints[account][center];
            if (cp.fromBlock == blockNumber) {return cp.votes;} 
            else if (cp.fromBlock < blockNumber) {lower = center;
            } else {upper = center - 1;}}
        return checkpoints[account][lower].votes;
    }
    
    /// @notice Returns array list of approved `guildTokens` in Baal for {ragequit}.
    function getGuildTokens() external view returns (address[] memory tokens) {
        tokens = guildTokens;
    }

    /// @notice Returns 'flags' for given Baal `proposal` describing type ('action'[0], 'membership'[1], 'period'[2], 'whitelist'[3]).
    function getProposalFlags(uint proposal) external view returns (bool[4] memory flags) {
        flags = proposals[proposal].flags;
    }
    
    /// @notice Returns true/false 'vote' by a given `account` on Baal `proposal` to indicate whether `approved`.
    function getProposalVotes(address account, uint proposal) external view returns (bool vote) {
        vote = members[account].voted[proposal];
    }
    
    /// @dev The fee to be charged for a given loan.
    /// @param amount The amount of tokens lent.
    /// @return fee The `fee` amount of 'token' to be charged for the loan, on top of the returned principal.
    function flashFee(address, uint amount) public view returns (uint fee) {
        fee = amount * flashFeeNumerator / 10000; /*Calculate fee - precision factor `10000` derived from ERC-3156 'Flash Loan Reference'*/
    }
    
    /// @dev The amount of currency available to be lent.
    /// @param token The loan currency.
    /// @return amount The `amount` of `token` that can be borrowed.
    function maxFlashLoan(address token) external view returns (uint amount) {
        (,bytes memory balanceData) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this))); /*get Baal token balance - 'balanceOf(address)'*/
        amount = abi.decode(balanceData, (uint)); /*decode Baal token balance for calculation*/
    }

    /***************
    HELPER FUNCTIONS
    ***************/
    /// @notice Deposits ETH sent to Baal.
    receive() external payable {}
    
    /// @notice Provides confirmation for 'safe' ERC-721 (NFT) transfers to Baal.
    function onERC721Received(address, address, uint, bytes calldata) external pure returns (bytes4 sig) {
        sig = 0x150b7a02; /*'onERC721Received(address,address,uint,bytes)'*/
    }
    
    /// @notice Provides confirmation for 'safe' ERC-1155 transfers to Baal.
    function onERC1155Received(address, address, uint, uint, bytes calldata) external pure returns (bytes4 sig) {
        sig = 0xf23a6e61; /*'onERC1155Received(address,address,uint,uint,bytes)'*/
    }
    
    /// @notice Provides confirmation for 'safe' batch ERC-1155 transfers to Baal.
    function onERC1155BatchReceived(address, address, uint[] calldata, uint[] calldata, bytes calldata) external pure returns (bytes4 sig) {
        sig = 0xbc197c81; /*'onERC1155BatchReceived(address,address,uint[],uint[],bytes)'*/
    }
    
    function _delegate(address delegator, address delegatee) private {
        address currentDelegate = delegates[delegator];
        delegates[delegator] = delegatee;
        emit DelegateChanged(delegator, currentDelegate, delegatee);
        _moveDelegates(currentDelegate, delegatee, uint96(balanceOf[delegator]));
    }
    
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
    
    /// @notice Internal burn function for Baal `loot`.
    function _burnLoot(address from, uint96 loot) private {
        members[from].loot -= loot; /*subtract `loot` for `from` account*/
        totalLoot -= loot; /*subtract from total Baal `loot`*/
        emit TransferLoot(from, address(0), loot); /*emit event reflecting burn of `loot`*/
    }
    
    /// @notice Internal burn function for Baal `shares`.
    function _burnShares(address from, uint96 shares) private {
        balanceOf[from] -= shares; /*subtract `shares` for `from` account*/
        totalSupply -= shares; /*subtract from total Baal `shares`*/
        emit Transfer(from, address(0), shares); /*emit event reflecting burn of `shares` with erc20 accounting*/
    }
    
    /// @notice Internal minting function for Baal `loot`.
    function _mintLoot(address to, uint96 loot) private {
        members[to].loot += loot; /*add `loot` for `to` account*/
        totalLoot += loot; /*add to total Baal `loot`*/
        emit TransferLoot(address(0), to, loot); /*emit event reflecting mint of `loot`*/
    }
    
    /// @notice Internal minting function for Baal `shares`.
    function _mintShares(address to, uint96 shares) private {
        balanceOf[to] += shares; /*add `shares` for `to` account*/
        totalSupply += shares; /*add to total Baal `shares`*/
        emit Transfer(address(0), to, shares); /*emit event reflecting mint of `shares` with erc20 accounting*/
    }
 
    /// @notice Internal check to validate proposal processing requirements. 
    function _processingReady(uint proposal, Proposal memory prop) private view returns (bool ready) {
        unchecked {
            require(proposal <= proposalCount,'!exist'); /*check proposal exists*/
            require(prop.votingEnds + gracePeriod <= block.timestamp,'!ended'); /*check voting period has ended*/
            require(proposals[proposal - 1].votingEnds == 0,'prev!processed'); /*check previous proposal has processed by deletion*/
            require(proposals[proposal].votingEnds != 0,'processed'); /*check given proposal has not yet processed by deletion*/
            if (summonerCount == 1) ready = true; /*if single membership, process early*/
            else if (prop.yesVotes > totalSupply / 2) ready = true; /*process early if majority member support*/
            else if (prop.votingEnds >= block.timestamp) ready = true; /*otherwise, process if voting period done*/
        }
    }
    
    /// @notice Provides 'safe' {transfer} for tokens that do not consistently return true/false.
    /// @param token Address of ERC-20 token.
    /// @param to The address of destination account.
    /// @param amount The number of tokens to transfer.
    function _safeTransfer(address token, address to, uint amount) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount)); /*'transfer(address,uint)'*/
        require(success && (data.length == 0 || abi.decode(data, (bool))),'transfer failed'); /*checks success & allows non-conforming transfers*/
    }

    /// @notice Provides 'safe' {transferFrom} for tokens that do not consistently return true/false.
    /// @param token Address of ERC-20 token.
    /// @param from The address of the source account.
    /// @param to The address of destination account.
    /// @param amount The number of tokens to transfer.
    function _safeTransferFrom(address token, address from, address to, uint amount) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount)); /*'transferFrom(address,address,uint)'*/
        require(success && (data.length == 0 || abi.decode(data, (bool))),'transferFrom failed'); /*checks success & allows non-conforming transfers*/
    }
}