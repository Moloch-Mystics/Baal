// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.5;
/// @title Baal
/// @notice Maximalized minimalist guild contract inspired by Moloch DAO framework.
contract Baal {
    address[] guildTokens; // array list of erc20 tokens approved for {ragequit} claims
    address[] memberList; // array list of `members` summoned or added by `proposals`
    uint public proposalCount; // counter for total `proposals` submitted
    uint public totalSupply; // counter for `members` voting shares with erc20 accounting
    uint32 public minVotingPeriod; // minimum period for voting in seconds
    uint32 public maxVotingPeriod; // maximum period for voting in seconds
    uint8 constant public decimals = 18; // unit scaling factor in erc20 shares accounting - '18' is default to match ETH & most erc20 units
    string public name; // 'name' for erc20 shares accounting
    string public symbol; // 'symbol' for erc20 shares accounting

    mapping(address => uint) public balanceOf; // maps `members` accounts to shares with erc20 accounting
    mapping(address => bool) public minions; // maps contracts approved in 'governance' (1) proposals for {memberAction} that mints or burns shares
    mapping(address => Member) public members; // maps `members` accounts to struct details
    mapping(uint => Proposal) public proposals; // maps `proposalCount` to struct details
    
    event SummonComplete(address[] minions, address[] guildTokens, address[] summoners, uint96[] shares, uint minVotingPeriod, uint maxVotingPeriod, string name, string symbol);
    event SubmitProposal(address[] to, uint96[] value, uint32 votingPeriod, uint indexed proposal, uint8 indexed flag, bytes[] data, bytes32 details); // emits after proposal submitted
    event SubmitVote(address indexed member, uint balance, uint indexed proposal, uint8 indexed vote); // emits after vote submitted on proposal
    event ProcessProposal(uint indexed proposal); // emits when proposal is processed & executed
    event Transfer(address indexed from, address indexed to, uint amount); // emits when Baal shares are minted or burned with erc20 accounting
    event Ragequit(address indexed memberAddress, address receiver, uint sharesToBurn); // emits when `members` burn shares or loot to a given `receiver`
    
    /// @dev Reentrancy guard.
    uint constant _NOT_ENTERED = 1;
    uint constant _ENTERED = 2;
    uint _status;
    modifier nonReentrant() {
        require(_status != _ENTERED, 'reentrant');
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
    
    enum Vote {
        Null, // default value, counted as abstention
        Yes,
        No
    }
    
    struct Member {
        bool exists; // tracks `members` account registration for `memberAction()` & `submitProposal()`
        uint highestIndexYesVote; // highest proposal index # on which the member voted YES
        mapping(uint => mapping(uint => uint8)) voted; // maps votes on proposals by `members` account - gets votes cast & whether approved
    }
    
    struct Proposal {
        uint32 votingEnds; // termination date for proposal in seconds since unix epoch - derived from `votingPeriod`
        uint96 yesVotes; // counter for `members` 'yes' votes to calculate approval on processing
        uint96 noVotes; // counter for `members` 'no' votes to calculate approval on processing
        bool[4] flags; // flags for proposal type & status - [action, governance, membership, passed] 
        address[] to; // account(s) that receives low-level call `data` & ETH `value` - if `membership` flag (2) or `removal` (3), account(s) that will receive or lose `value` shares, respectively
        uint96[] value; // ETH sent from Baal to execute approved proposal low-level call(s)
        bytes[] data; // raw data sent to `target` account for low-level call
        bytes32 details; // context for proposal - could be IPFS hash, plaintext, or JSON
    }
    
    /// @notice Summon Baal & create initial array of `members` accounts with specific voting weights.
    /// @param _guildTokens Tokens approved for internal accounting - {ragequit} of shares or loot.
    /// @param _minions External contracts approved for `memberAction()`.
    /// @param summoners Accounts to add as `members`.
    /// @param shares Voting weight among `members`.
    /// @param _minVotingPeriod Min. voting period in seconds for `members` to cast votes on proposals.
    /// @param _maxVotingPeriod Max. voting period in seconds for `members` to cast votes on proposals.
    /// @param _name Name for erc20 shares accounting.
    /// @param _symbol Symbol for erc20 shares accounting.
    constructor(address[] memory _minions, address[] memory _guildTokens, address[] memory summoners, uint96[] memory shares, uint32 _minVotingPeriod, uint32 _maxVotingPeriod, string memory _name, string memory _symbol) {
        for (uint i; i < summoners.length; i++) {
             guildTokens.push(_guildTokens[i]); // update array of `guildTokens` for `ragequit()`
             memberList.push(summoners[i]); // update array of `members`
             totalSupply += shares[i]; // total shares incremented by summoning member weights with erc20 accounting
             balanceOf[summoners[i]] = shares[i]; // shares granted to summoning `members` with erc20 accounting
             minions[_minions[i]] = true; // update mapping of approved `banks`
             members[summoners[i]].exists = true; // record that summoning `members` `exists`
             emit Transfer(address(this), summoners[i], shares[i]); // event reflects mint of erc20 shares to summoning `members`
        }
        minVotingPeriod = _minVotingPeriod; 
        maxVotingPeriod = _maxVotingPeriod; 
        name = _name; // Baal 'name' with erc20 accounting
        symbol = _symbol; // Baal 'symbol' with erc20 accounting
        _status = _NOT_ENTERED; // set reentrancy guard
        emit SummonComplete(_minions, _guildTokens, summoners, shares, _minVotingPeriod, _maxVotingPeriod, _name, _symbol);
    }

    /// @notice Execute membership action to mint or burn shares or loot against whitelisted `minions` in consideration of `msg.sender` & given `amount`.
    /// @param extension Whitelisted contract to trigger action.
    /// @param amount Number to submit in action - e.g., shares or loot to mint for tribute or to burn in asset claim.
    /// @param mint Confirm whether action involves shares or loot request - if `false`, perform burn.
    function memberAction(address extension, uint amount, bool mint) external nonReentrant payable returns (uint reaction) {
        require(minions[address(extension)], '!extension'); // check `extension` is approved
        if (mint) {
            (, bytes memory reactionData) = extension.call{value: msg.value}(abi.encodeWithSelector(0x920a6450, msg.sender, amount)); //  fetch 'reaction' mint per inputs
            reaction = abi.decode(reactionData, (uint));
            if (!members[msg.sender].exists) memberList.push(msg.sender); // update membership list if new
            balanceOf[msg.sender] += reaction; // add shares to `msg.sender` account with erc20 accounting
            totalSupply += reaction; // add to total Baal shares with erc20 accounting
            emit Transfer(address(this), msg.sender, reaction); // event reflects mint of shares or loot with erc20 accounting
        } else {
            (, bytes memory reactionData) = extension.call{value: msg.value}(abi.encodeWithSelector(0x920a6450, msg.sender, amount)); // fetch 'reaction' burn per inputs
            reaction = abi.decode(reactionData, (uint));
            balanceOf[msg.sender] -= reaction; // subtract shares from member account with erc20 accounting
            totalSupply -= reaction; // subtract from total Baal shares with erc20 accounting
            emit Transfer(address(this), address(0), reaction); // event reflects burn of shares or loot with erc20 accounting
        }
    }
    
    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    /// @notice Submit proposal to Baal `members` for approval within voting period - proposer must be registered member.
    /// @param to Account that receives low-level call `data` & ETH `value` - if `membership` flag (2), the account that will receive `value` shares - if `removal` (3), the account that will lose `value` shares.
    /// @param value ETH sent from Baal to execute approved proposal low-level call.
    /// @param data Raw data sent to `target` account for low-level call.
    /// @param details Context for proposal - could be IPFS hash, plaintext, or JSON.
    function submitProposal(address[] calldata to, uint96[] calldata value, uint32 votingPeriod, uint8 flag, bytes[] calldata data, bytes32 details) external nonReentrant returns (uint proposal) {
        require(votingPeriod >= minVotingPeriod && votingPeriod <= maxVotingPeriod, '!votingPeriod');
        require(to.length == value.length && value.length == data.length, '!arrays');
        require(to.length <= 10, 'array max');
        require(flag <= 5, '!flag'); // check flag is in bounds
        bool[4] memory flags; // plant flags - [action, governance, membership, passed]
        flags[flag] = true; // flag proposal type for struct storage 
        proposalCount++; // increment total proposal counter
        unchecked{proposals[proposalCount] = Proposal(uint32(block.timestamp) + votingPeriod, 0, 0, flags, to, value, data, details);} // push params into proposal struct - start voting period timer
        emit SubmitProposal(to, value, votingPeriod, proposal, flag, data, details);
    }
    
    /// @notice Submit vote - proposal must exist & voting period must not have ended - non-member can cast `0` vote to signal.
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on.
    /// @param uintVote If '1', member will cast `yesVotes` onto proposal - if '2', `noVotes` will be counted.
    function submitVote(uint proposal, uint8 uintVote) external nonReentrant {
        Proposal storage prop = proposals[proposal]; // alias proposal storage pointers
        Vote vote = Vote(uintVote); // alias uintVote
        uint balance = balanceOf[msg.sender]; // gas-optimize variable
        require(prop.votingEnds >= block.timestamp, 'ended'); // check voting period has not ended
        if (vote == Vote.Yes) {prop.yesVotes += uint96(balance);} // cast 'yes' votes per member balance to proposal
        if (vote == Vote.No) {prop.noVotes += uint96(balance);} // cast 'no' votes per member balance to proposal
        members[msg.sender].voted[proposal][balance] = uintVote; // record vote to member struct per account
        emit SubmitVote(msg.sender, balance, proposal, uintVote);
    }
    
    // ********************
    // PROCESSING FUNCTIONS
    // ********************
    /// @notice Process 'action' proposal (0) & execute low-level call(s) - proposal must be counted, unprocessed, & in voting period.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processActionProposal(uint proposal) external nonReentrant returns (bytes[] memory results) {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal]; // alias proposal storage pointers
        require(prop.flags[0], '!action'); // check proposal type
        if (prop.yesVotes > prop.noVotes)  // check if proposal approved by simple majority of `members`
            for (uint i; i < prop.to.length; i++) {
                (, bytes memory result) = prop.to[i].call{value:prop.value[i]}(prop.data[i]); // execute low-level call(s)
                results[i] = result;}
         delete proposals[proposal]; // delete given proposal struct details for gas refund & the commons
         emit ProcessProposal(proposal);
    }
    
    /// @notice Process 'governance' proposal (1) - proposal must be counted, unprocessed, & in voting period.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processGovernanceProposal(uint proposal) external nonReentrant {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal]; // alias proposal storage pointers
        require(prop.flags[1], '!governance'); // check proposal type
        unchecked {if (prop.yesVotes > prop.noVotes) // check if proposal approved by simple majority of members
            for (uint i; i < prop.to.length; i++) 
                if (prop.value[i] != 0) { // check `value` to toggle between approving or removing 'extension'
                    minions[prop.to[i]] = true; // approve 'extension'
                } else {
                    minions[prop.to[i]] = false;}} // remove 'extension'
                if (prop.value[0] > 0) maxVotingPeriod = uint32(prop.value[0]); // reset voting period to first `value`
        delete proposals[proposal]; // delete given proposal struct details for gas refund & the commons
        emit ProcessProposal(proposal);
    }
    
    /// @notice Process 'membership' proposal (2) - proposal must be counted, unprocessed, & in voting period.
    /// @param proposal Number of proposal in `proposals` array to process for execution.
    function processMemberProposal(uint proposal) external nonReentrant {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal]; // alias proposal storage pointers
        require(prop.flags[2], '!member'); // check proposal type
        if (prop.yesVotes > prop.noVotes) // check if proposal approved by simple majority of members
            for (uint i; i < prop.to.length; i++) {
                if (prop.data.length == 0) {
                    if (!members[prop.to[i]].exists) memberList.push(prop.to[i]); // update membership list if new
                    totalSupply += prop.value[i]; // add to total member votes
                    balanceOf[prop.to[i]] += prop.value[i]; // add to `target` member votes
                    emit Transfer(address(0), prop.to[i], prop.value[i]); // event reflects mint of erc20 votes
                } else {
                    totalSupply -= prop.value[i]; // subtract `balance` from total member votes
                    balanceOf[prop.to[i]] -= prop.value[i]; // subtract member votes
                    emit Transfer(prop.to[i], address(0), prop.value[i]);}} // event reflects burn of erc20 votes
        delete proposals[proposal]; // delete given proposal struct details for gas refund & the commons
        emit ProcessProposal(proposal);
    }

    /// @notice Process member 'ragequit'.
    /// @param shares Baal membership weight to burn to claim 'fair share' of `guildTokens`.
    /// @return successes Logs transfer success of claimed `guildTokens`.
    function ragequit(address to, uint shares) external returns (bool[] memory successes) {
        require(members[msg.sender].highestIndexYesVote < proposalCount, 'highestIndexYesVote !processed'); // highest index proposal member voted YES on must process first
        for (uint i; i < guildTokens.length; i++) {
            (, bytes memory balanceData) = guildTokens[i].staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
            uint balance = abi.decode(balanceData, (uint));
            uint amountToRagequit = shares * balance / totalSupply;
            if (amountToRagequit != 0) { // gas optimization to allow higher maximum token limit
                (bool success, ) = guildTokens[i].call(abi.encodeWithSelector(0xa9059cbb, to, amountToRagequit)); successes[i] = success;}}
        balanceOf[msg.sender] -= shares; // subtract shares from member account with erc20 accounting
        totalSupply -= shares; // subtract from total Baal shares with erc20 accounting
        emit Ragequit(msg.sender, to, shares); 
    }
    
    /***************
    GETTER FUNCTIONS
    ***************/
    /// @notice Returns array list of approved guild tokens in Baal for member exits.
    function getGuildTokens() external view returns (address[] memory tokens) {
        tokens = guildTokens;
    }

    /// @notice Returns array list of member accounts in Baal.
    function getMemberList() external view returns (address[] memory membership) {
        membership = memberList;
    }

    /// @notice Returns flags for proposal type & status in Baal.
    function getProposalFlags(uint proposal) external view returns (bool[4] memory flags) {
        flags = proposals[proposal].flags;
    }
    
    /***************
    HELPER FUNCTIONS
    ***************/
    /// @notice Deposits ETH sent to Baal.
    receive() external payable {}

    /// @dev Internal checks to validate basic proposal processing requirements. 
    function processingReady(uint proposal) private view returns (bool ready) {
        Proposal storage prop = proposals[proposal];
        require(proposal <= proposalCount, '!exist'); // check proposal exists
        if (proposal != 0) require(proposals[proposal - 1].votingEnds == 0, 'prev. !processed'); // check previous proposal has processed by deletion
        require(!prop.flags[3], 'processed'); // check given proposal has not yet processed
        if (memberList.length == 1) {
            ready = true; // if single membership, process early
        } else if (prop.yesVotes > totalSupply / 2) { 
            ready = true; // process early if majority member support
        } else if (prop.votingEnds >= block.timestamp) { 
            ready = true;} // otherwise, process if voting period done
    }
}
