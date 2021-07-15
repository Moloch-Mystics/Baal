// SPDX-License-Identifier: UNLICENSED
/*
███   ██   ██   █     
█  █  █ █  █ █  █     
█ ▀ ▄ █▄▄█ █▄▄█ █     
█  ▄▀ █  █ █  █ ███▄  
███      █    █     ▀ 
        █    █        
       ▀    ▀*/
pragma solidity ^0.8.6;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

/// @title Baal
/// @notice Maximalized minimalist guild contract inspired by Moloch DAO framework.
contract Baal is ERC20Votes {
    address[]      guildTokens;/*array list of erc20 tokens approved on summoning or by whitelist[3] `proposals` for {ragequit} claims*/
    address[]      memberList;/*array list of `members` summoned or added by membership[1] `proposals`*/
    uint    public proposalCount;/*counter for total `proposals` submitted*/
    uint    public totalLoot;/*counter for total loot economic weight held by accounts*/
    uint96         totalSharesAndLoot;/*internal counter for total 'loot' & 'shares' in Baal for {ragequit}*/
    uint32  public gracePeriod;/*time delay after proposal voting period for processing*/
    uint32  public minVotingPeriod;/*minimum period for voting in seconds - amendable through period[2] proposal*/
    uint32  public maxVotingPeriod;/*maximum period for voting in seconds - amendable through period[2] proposal*/
    bool    public lootPaused;/*tracks transferability of loot economic weight - amendable through period[2] proposal*/
    bool    public sharesPaused; /*tracks transferability of erc20 shares - amendable through period[2] proposal*/

    mapping(address=>bool)      public shamans;/*maps contracts approved in whitelist[3] proposals for {memberAction} that mints or burns shares*/
    mapping(address=>Member)    public members;/*maps `members` accounts to struct details*/
    mapping(uint=>Proposal)     public proposals;/*maps `proposalCount` to struct details*/
    
    event SummonComplete(address[] minions, address[] guildTokens, address[] summoners, uint96[] loot, uint96[] shares, uint minVotingPeriod, uint maxVotingPeriod, string name, string symbol, bool transferableLoot, bool transferableShares);/*emits after Baal summoning*/
    event SubmitProposal(address[] to, uint96[] value, uint32 votingPeriod, uint indexed proposal, uint8 indexed flag, bytes[] data, bytes32 details);/*emits after proposal submitted*/
    event SubmitVote(address indexed member, uint balance, uint indexed proposal, uint8 indexed vote);/*emits after vote submitted on proposal*/
    event ProcessProposal(uint indexed proposal);/*emits when proposal is processed & executed*/
    event Ragequit(address indexed memberAddress, address to, uint96 lootToBurn, uint96 sharesToBurn);/*emits when callers burn Baal shares and/or loot for a given `to` account*/
    event TransferLoot(address indexed from, address indexed to, uint amount);/*emits when Baal loot is transferred*/
    
    /// @dev Reentrancy guard via OpenZeppelin.
    modifier nonReentrant() {
        require(status == 1,'reentrant'); 
        status = 2 
        ;_;
        status = 1
        ; } 
        uint status;
        
    /// @dev Voting & membership containers.
    enum   Vote               {Null, Yes, No}
    struct Member {/*Baal membership details*/
        uint96                loot;/*amount of loot held by `members`-can be set on summoning & adjusted via {memberAction}*/
        uint32                highestIndexYesVote;/*highest proposal index # on which the member voted YES*/
        mapping(uint32=>Vote) voted;/* maps vote decisions on proposals by `members` account*/
    }
    struct Proposal {/*Baal proposal details*/
        uint32                startBlock;/*start block for proposal*/
        uint32                votingEnds;/*termination date for proposal in seconds since unix epoch - derived from `votingPeriod`*/
        uint96                yesVotes;/*counter for `members` 'yes' votes to calculate approval on processing*/
        uint96                noVotes;/*counter for `members` 'no' votes to calculate approval on processing*/
        bool[3]               flags;/*flags for proposal type & status - [action, membership, period, whitelist]*/
        address[]             to;/*account(s) that receives low-level call `data` & ETH `value` - if `membership`[2] flag, account(s) that will receive or lose `value` shares, respectively*/
        uint96[]              value;/*ETH sent from Baal to execute approved proposal low-level call(s)*/
        bytes[]               data;/*raw data sent to `target` account for low-level call*/
        bytes32               details;/*context for proposal*/
    }
    
    /// @notice Summon Baal & create initial array of `members` accounts with voting & loot weights.
    /// @param _shamans External contracts approved for {memberAction}.
    /// @param _guildTokens Tokens approved for internal accounting-{ragequit} of shares &/or loot.
    /// @param summoners Accounts to add as `members`.
    /// @param loot Economic weight among `members`.
    /// @param shares Voting weight among `members` (shares also have economic weight & are erc20 tokens).
    /// @param _minVotingPeriod Minimum voting period in seconds for `members` to cast votes on proposals.
    /// @param _maxVotingPeriod Maximum voting period in seconds for `members` to cast votes on proposals.
    /// @param _name Name for erc20 shares accounting.
    /// @param _symbol Symbol for erc20 shares accounting.
    constructor(
        address[] memory _shamans, 
        address[] memory _guildTokens, 
        address[] memory summoners, 
        uint96[]  memory loot, 
        uint96[]  memory shares, 
        uint32           _minVotingPeriod, 
        uint32           _maxVotingPeriod, 
        string    memory _name, 
        string    memory _symbol,
        bool             _lootPaused,
        bool             _sharesPaused) ERC20(_name, _symbol) {
        uint96           initialTotalSharesAndLoot;
        for (uint i; i < summoners.length; i++) {
            guildTokens.push(_guildTokens[i]);/*update array of `guildTokens` approved for {ragequit}*/
            memberList.push(summoners[i]);/*push `summoners` to `members` array*/
            totalLoot += loot[i];/*add to total Baal 'loot'*/
            shamans[_shamans[i]] = true;/*update mapping of approved `minions` in Baal*/
            members[summoners[i]].loot = loot[i];/*add 'loot' to summoning `members` account*/
            initialTotalSharesAndLoot += (loot[i] + shares[i]);/*set reasonable limit for Baal 'loot' & 'shares' via uint96 max.*/
            _delegate(summoners[i], summoners[i]);/*delegate voting weight to summoning members by default*/
            emit Transfer(address(0), summoners[i], shares[i]);/*emit event reflecting Baal summoning completed*/
        }
        minVotingPeriod = minVotingPeriod;/*set minimum voting period - adjustable via 'period'[2] proposal*/
        maxVotingPeriod =_maxVotingPeriod;/*set maximum voting period - adjustable via 'period'[2] proposal*/
        lootPaused = _lootPaused;/*set initial transferability for 'loot' - if 'paused', transfers are blocked*/
        sharesPaused = _sharesPaused;/*set initial transferability for 'shares' tokens - if 'paused', transfers are blocked*/
        status = 1;/*initialize reentrancy guard status*/
        emit SummonComplete(_shamans, _guildTokens, summoners, loot, shares, _minVotingPeriod, _maxVotingPeriod, _name, _symbol, _lootPaused, _sharesPaused);/*emit event reflecting Baal summoning completed*/
    }

    /// @notice Execute membership action to mint or burn shares or loot against whitelisted `minions` in consideration of `msg.sender` & given `amount`.
    /// @param shaman Whitelisted contract to trigger action.
    /// @param loot Loot involved in external call.
    /// @param shares Shares involved in external call.
    /// @param mint Confirm whether action involves shares or loot request-if `false`, perform burn.
    /// @return lootReaction sharesReaction Loot and/or shares derived from action.
    function memberAction(address shaman, uint loot, uint shares, bool mint) external nonReentrant payable returns (uint96 lootReaction, uint96 sharesReaction){
        require(shamans[shaman],'!shaman');/*check `shaman` is approved*/
        if (mint) {
            (,bytes memory reactionData) = shaman.call{value: msg.value}(abi.encodeWithSelector(0xff4c9884, msg.sender, loot, shares)); /*fetch 'reaction' mint per inputs*/
            (lootReaction, sharesReaction) = abi.decode(reactionData, (uint96, uint96));/*decode reactive data*/
            if (lootReaction != 0) members[msg.sender].loot += lootReaction; totalLoot += lootReaction; totalSharesAndLoot += lootReaction;/*add loot to `msg.sender` account & Baal totals*/
            if (sharesReaction != 0) _balances[msg.sender] += sharesReaction; _moveDelegates(address(0), msg.sender, sharesReaction); _totalSupply += sharesReaction; totalSharesAndLoot += sharesReaction;/*add shares to `msg.sender` account & Baal total with erc20 accounting*/
            emit Transfer(address(0), msg.sender, sharesReaction);/*emit event reflecting mint of shares or loot with erc20 accounting*/
        } else {
            (,bytes memory reactionData) = shaman.call{value: msg.value}(abi.encodeWithSelector(0xff4c9884, msg.sender, loot, shares));/*fetch 'reaction' burn per inputs*/
            (lootReaction, sharesReaction) = abi.decode(reactionData, (uint96, uint96));/*decode reactive data*/
            if (lootReaction != 0) members[msg.sender].loot -= lootReaction; totalLoot -= lootReaction; totalSharesAndLoot -= lootReaction;/*subtract loot from `msg.sender` account & Baal totals*/
            if (sharesReaction != 0) _balances[msg.sender] -= sharesReaction; _moveDelegates(msg.sender, address(0), sharesReaction); _totalSupply -= sharesReaction; totalSharesAndLoot -= sharesReaction;/*subtract shares from `msg.sender` account & Baal total with erc20 accounting*/
            emit Transfer(msg.sender, address(0), sharesReaction);/*emit event reflecting burn of shares or loot with erc20 accounting*/
        }
    }
    
    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    /// @notice Submit proposal to Baal `members` for approval within voting period.
    /// @param to Account to target for proposal.
    /// @param value Numerical value to bind to proposal.
    /// @param data Data to bind to proposal.
    /// @param details Context for proposal.
    /// @return proposal Count for submitted proposal.
    function submitProposal(address[] calldata to, uint96[] calldata value, uint32 votingPeriod, uint8 flag, bytes[] calldata data, bytes32 details) external nonReentrant returns (uint proposal){
        require(votingPeriod >= minVotingPeriod && votingPeriod <= maxVotingPeriod,'!votingPeriod');/*require voting period is within bounds*/
        require(to.length == value.length && value.length == data.length,'!arrays');/*require array lengths match*/
        require(to.length <= 10,'array max');/*limit executable actions to help avoid block gas limit errors on processing*/
        require(flag <= 5,'!flag');/*check flag is in bounds*/
        bool[3] memory flags;/*plant flags-[action, governance, membership]*/
        flags[flag] = true;/*flag proposal type for struct storage*/ 
        proposalCount++;/*increment total proposal counter*/
        proposals[proposalCount] = Proposal(uint32(block.timestamp), uint32(block.timestamp) + votingPeriod, 0, 0, flags, to, value, data, details);/*push params into proposal struct - start voting period timer*/
        emit SubmitProposal(to, value, votingPeriod, proposal, flag, data, details);/*emit event reflecting proposal submission*/
    }
    
    /// @notice Submit vote-proposal must exist & voting period must not have ended-non-member can cast `0` vote to signal.
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on.
    /// @param uintVote If '1', member will cast `yesVotes` onto proposal-if '2', `noVotes` will be counted.
    function submitVote(uint32 proposal, uint8 uintVote) external nonReentrant {
        Proposal storage prop = proposals[proposal];/*alias proposal storage pointers*/
        Vote vote = Vote(uintVote);/*alias uintVote*/
        uint balance = getPriorVotes(msg.sender, prop.startBlock);/*gas-optimize variable*/
        require(prop.votingEnds >= block.timestamp,'ended');/*check voting period has not ended*/
        require(members[msg.sender].voted[proposal] == Vote.Null,'voted');/*check caller has not already voted*/
        if (vote == Vote.Yes) prop.yesVotes += uint96(balance); members[msg.sender].highestIndexYesVote = proposal;/*cast delegated balance 'yes' votes to proposal*/
        if (vote == Vote.No) prop.noVotes += uint96(balance);/*cast delegated balance 'no' votes to proposal*/
        members[msg.sender].voted[proposal] = vote;/*record vote to member struct per account*/
        emit SubmitVote(msg.sender, balance, proposal, uintVote);/*emit event reflecting proposal vote submission*/
    }
        
    // ********************
    // PROCESSING FUNCTIONS
    // ********************
    /// @notice Process 'proposal' & execute internal functions based on 'flag'[#].
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processProposal(uint32 proposal) external nonReentrant {
        Proposal storage prop = proposals[proposal];/*alias `proposal` storage pointers*/
        _processingReady(proposal, prop);/*validate `proposal` processing requirements*/
        if (prop.yesVotes > prop.noVotes){/*check if `proposal` approved by simple majority of members*/
            if (prop.flags[0]){processActionProposal(prop);}/*check 'flag', execute 'action'*/
            else if (prop.flags[1]){processMemberProposal(prop);}/*check 'flag', execute 'membership'*/
            else if (prop.flags[2]){processPeriodProposal(prop);}/*check 'flag', execute 'period'*/
            else {processWhitelistProposal(prop);}}/*otherwise, execute 'whitelist'*/
        delete proposals[proposal];/*delete given proposal struct details for gas refund & the commons*/
        emit ProcessProposal(proposal);/*emit event reflecting proposal processed*/
    }
    
    /// @notice Process 'action'[0] proposal.
    function processActionProposal(Proposal memory prop) private returns (bytes memory reactionData) {
        for (uint i; i < prop.to.length; i++) 
            (,reactionData) = prop.to[i].call{value:prop.value[i]}/*pass ETH value, if any*/
            (prop.data[i]);/*execute low-level call(s)*/
    }
    
    /// @notice Process 'membership'[1] proposal.
    function processMemberProposal(Proposal memory prop) private {
        for (uint i; i < prop.to.length; i++) {
            if (prop.data[i].length == 0) {
                if (_balances[msg.sender] == 0) memberList.push(prop.to[i]);/*update membership list if new*/
                    _balances[prop.to[i]] += prop.value[i];/*add to `target` member votes*/
                    _moveDelegates(address(0), prop.to[i], prop.value[i]);/*initialize delegatable voting weight*/
                    _totalSupply += prop.value[i];/*add to total member votes*/
                    totalSharesAndLoot += prop.value[i];/*add to Baal totals - uint96 max check included*/
                    emit Transfer(address(0), prop.to[i], prop.value[i]);/*event reflects mint of erc20 votes*/
                } else {
                    memberList[prop.value[i]] = memberList[(memberList.length - 1)]; memberList.pop();/*swap & pop removed & last member listings*/
                    uint removedBalance = _balances[prop.to[i]];/*gas-optimize variable*/
                    _moveDelegates(address(0), prop.to[i], uint96(removedBalance));
                    _totalSupply -= removedBalance;/*subtract from total Baal shares with erc20 accounting*/
                    totalLoot += removedBalance;/*add to total Baal loot*/ 
                    totalSharesAndLoot -= uint96(removedBalance);/*subtract from Baal totals*/
                    _balances[prop.to[i]] -= prop.value[i];/*subtract member votes*/
                    members[prop.to[i]].loot += uint96(removedBalance);/*add loot per removed share balance*/
                    emit Transfer(prop.to[i], address(0), prop.value[i]);/*event reflects burn of erc20 votes*/
                }
            }
    }
    
    /// @notice Process 'period'[2] proposal.
    function processPeriodProposal(Proposal memory prop) private {
        if (prop.value[0] != 0) minVotingPeriod = uint32(prop.value[0]);/*if positive, reset min. voting periods to first `value`*/ 
        if (prop.value[1] != 0) maxVotingPeriod = uint32(prop.value[1]);/*if positive, reset max. voting periods to second `value`*/
        if (prop.value[2] != 0) gracePeriod = uint32(prop.value[2]);/*if positive, reset grace periods to third `value`*/
        prop.value[3] == 0 ? lootPaused = false : lootPaused = true;/*if positive, pause loot transfers on fourth `value`*/
        prop.value[4] == 0 ? sharesPaused = false : sharesPaused = true;/*if positive, pause loot shares transfers on fifth `value`*/
    }  
        
    /// @notice Process 'whitelist'[3] proposal.
    function processWhitelistProposal(Proposal memory prop) private {
        for (uint8 i; i < prop.to.length; i++) 
            if (prop.value[i] == 0 && prop.data.length == 0) {
                shamans[prop.to[i]] = true;/*add account to 'minions' extensions*/
                } else if (prop.value[i] == 0 && prop.data.length != 0) {
                    shamans[prop.to[i]] = false;/*remove account from 'minions' extensions*/
                } else if (prop.value[i] != 0 && prop.data.length == 0) {
                    guildTokens.push(prop.to[i]);/*push account to `guildTokens` array*/
                } else {
                    guildTokens[prop.value[i]] = guildTokens[guildTokens.length - 1];/*swap to-delete index with last value*/
                    guildTokens.pop();/*pop account from `guildTokens` array*/
                }
            }
            
    /// @notice Process member 'ragequit'.
    /// @param lootToBurn Baal pure economic weight to burn to claim 'fair share' of `guildTokens`.
    /// @param sharesToBurn Baal voting weight to burn to claim 'fair share' of `guildTokens`.
    /// @return successes Logs transfer results of claimed `guildTokens` - because direct transfers, we want to skip & continue over failures.
    function ragequit(address to, uint96 lootToBurn, uint96 sharesToBurn) external nonReentrant returns (bool[] memory successes){
        require(members[msg.sender].highestIndexYesVote < proposalCount,'highestIndexYesVote!processed');/*highest index proposal member voted YES on must process first*/
        for (uint i; i < guildTokens.length; i++) {
            (,bytes memory balanceData) = guildTokens[i].staticcall(abi.encodeWithSelector(0x70a08231, address(this)));/*get Baal token balances - 'balanceOf(address)'*/
            uint balance = abi.decode(balanceData, (uint));/*decode Baal token balances for calculation*/
            uint amountToRagequit = ((lootToBurn + sharesToBurn) * balance) / _totalSupply;/*calculate fair shair claims*/
            if (amountToRagequit != 0) {/*gas optimization to allow higher maximum token limit*/
                (bool success,) = guildTokens[i].call(abi.encodeWithSelector(0xa9059cbb, to, amountToRagequit)); successes[i] = success;/*execute token calls - 'transfer(address,uint)'*/
            }
        }
        if (lootToBurn != 0)/*gas optimization*/ 
            members[msg.sender].loot -= lootToBurn;/*subtract loot from caller account*/
            totalLoot -= lootToBurn;/*subtract from total Baal loot*/
        if (sharesToBurn != 0)/*gas optimization*/ 
            _balances[msg.sender] -= sharesToBurn;/*subtract shares from caller account with erc20 accounting*/
            _totalSupply -= sharesToBurn;/*subtract from total Baal shares with erc20 accounting*/
        emit Ragequit(msg.sender, to, lootToBurn, sharesToBurn);/*event reflects claims made against Baal*/
    }
 
    /// @notice Transfer `amount` loot from `msg.sender` to `to`.
    /// @param to The address of destination account.
    /// @param amount The number of loot units to transfer.
    function transferLoot(address to, uint96 amount) external {
        require(!lootPaused,"!transferable");
        members[msg.sender].loot -= amount;
        members[to].loot += amount;
        emit TransferLoot(msg.sender, to, amount);
    }
    
    /***************
    GETTER FUNCTIONS
    ***************/
    /// @notice Returns array list of approved `guildTokens` in Baal for {ragequit}.
    function getGuildTokens() external view returns (address[] memory tokens) {
        tokens = guildTokens;
    }

    /// @notice Returns array list of registered `members` accounts in Baal.
    function getMemberList() external view returns (address[] memory membership) {
        membership = memberList;
    }

    /// @notice Returns 'flags' for given Baal `proposal` describing type ('action'[0], 'membership'[1], 'period'[2], 'whitelist'[3]).
    function getProposalFlags(uint proposal) external view returns (bool[3] memory flags) {
        flags = proposals[proposal].flags;
    }
    
    /// @notice Returns <uint8> 'vote' by a given `account` on Baal `proposal`.
    function getProposalVotes(address account, uint32 proposal) external view returns (Vote vote) {
        vote = members[account].voted[proposal];
    }

    /***************
    HELPER FUNCTIONS
    ***************/
    /// @notice Deposits ETH sent to Baal.
    receive() external payable {}
    
    /// @dev {_beforeTokenTransfer} used to check that tokens aren't paused.
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) private override {
        super._beforeTokenTransfer(from, to, amount);
        require(!sharesPaused,'!transferable');
    }  

    /// @notice Internal check to validate basic proposal processing requirements. 
    function _processingReady(uint32 proposal, Proposal memory prop) private view returns (bool ready) {
        require(proposal <= proposalCount,'!exist');/*check proposal exists*/
        require(prop.votingEnds + gracePeriod <= block.timestamp,'!ended');/*check voting period has ended*/
        require(proposals[proposal - 1].votingEnds == 0,'prev!processed');/*check previous proposal has processed by deletion*/
        require(!prop.flags[2],'processed');/*check given proposal has not yet processed*/
        if (memberList.length == 1) ready = true;/*if single membership, process early*/
        else if (prop.yesVotes > _totalSupply / 2) ready = true;/* process early if majority member support*/
        else if (prop.votingEnds >= block.timestamp) ready = true;/*otherwise, process if voting period done*/
    }
}
