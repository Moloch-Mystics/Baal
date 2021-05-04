/// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.4;

/// @notice Interface for Baal membership and banking extensions.
interface IBaalBank {
    function balanceOf(address account) external view returns (uint); // erc20 token helper for balance checks
    function memberAction(address account, uint amount) external payable returns (uint); // execute membership action to mint or burn votes via whitelisted extensions
}

/// @title Baal
/// @notice Maximalized minimalist guild contract inspired by Moloch DAO framework.
contract Baal {
    address[] guildTokens; // array list of erc20 tokens approved for `ragequit()`
    address[] memberList; // array list of `members` summoned or added by proposal
    uint public proposalCount = proposals.length; // counter for proposals submitted
    uint public totalSupply; // counter for `members` votes minted with erc20 accounting
    uint public minVotingPeriod; // min. period for voting in unix epoch time
    uint public maxVotingPeriod; // max. period for voting in unix epoch time
    uint8 constant public decimals = 18; // 'decimals' for erc20 vote accounting - '18' is default to match ETH and most erc20 units
    string public name; // 'name' for erc20 vote accounting
    string public symbol; // 'symbol' for erc20 vote accounting
    bytes4 constant SIG_TRANSFER = 0xa9059cbb; // erc20 function signature for simple 'safe transfer' - transfer(address,uint)
    bytes4 constant SIG_TRANSFER_FROM = 0x23b872dd; // erc20 function signature simple 'safe transferFrom' - transferFrom(address,address,uint)
    Proposal[] public proposals; // array list of Baal proposal structs per order proposed
    
    mapping(address => uint) public balanceOf; // maps `members` accounts to votes with erc20 accounting
    mapping(address => bool) public extensions; // maps contracts approved in 'governance' (1) proposals for `memberAction()` that burns or mints votes
    mapping(address => Member) public members; // maps `members` accounts to struct details
    
    event SummonComplete(address[] extensions, address[] guildTokens, address[] summoners, uint[] votes, uint minVotingPeriod, uint maxVotingPeriod, string name, string symbol);
    event SubmitProposal(address[] to, uint[] value, uint votingLength, uint indexed proposal, uint8 indexed flag, bytes[] data, string details); // emits when `members` submit proposal 
    event SubmitVote(address indexed member, uint balance, uint indexed proposal, uint8 indexed vote); // emits when `members` submit vote on proposal
    event ProcessProposal(uint indexed proposal); // emits when proposal is processed and executed
    event Transfer(address indexed from, address indexed to, uint amount); // emits when `members`' votes are minted or burned with erc20 accounting
    event Ragequit(address indexed memberAddress, uint sharesToBurn); // 
    
    /// @dev Reentrancy guard.
    uint unlocked = 1;
    modifier lock() {
        require(unlocked == 1, 'Baal::locked');
        unlocked = 0;
        _;
        unlocked = 1;
    }
    
    enum Vote {
        Null, // default value, counted as abstention
        Yes,
        No
    }
    
    struct Member {
        bool exists; // tracks `members` account registration for `memberAction()` and `submitProposal()`
        uint highestIndexYesVote; // highest proposal index # on which the member voted YES
        mapping(uint => mapping(uint => uint8)) voted; // maps votes on proposals by `members` account - gets votes cast and whether approved
    }
    
    struct Proposal {
        address[] to; // account(s) that receives low-level call `data` and ETH `value` - if `membership` flag (2) or `removal` (3), account(s) that will receive or lose `value` votes, respectively
        uint[] value; // ETH sent from Baal to execute approved proposal low-level call(s)
        uint yesVotes; // counter for `members` 'yes' votes to calculate approval on processing
        uint noVotes; // counter for `members` 'no' votes to calculate approval on processing
        uint votingEnds; // termination date for proposal in seconds since unix epoch - derived from `votingPeriod`
        bytes[] data; // raw data sent to `target` account for low-level call
        bool[6] flags; // flags for proposal type and status - [action, governance, membership, removal, passed, processed] 
        string details; // context for proposal - could be IPFS hash, plaintext, or JSON
    }
    
    /// @notice Deploy Baal and create initial array of `members` accounts with specific voting weights.
    /// @param _guildTokens Tokens approved for internal accounting - `ragequit()` of votes.
    /// @param _extensions External contracts approved for `memberAction()`.
    /// @param summoners Accounts to add as `members`.
    /// @param votes Voting weight among `members`.
    /// @param _minVotingPeriod Min. voting period in seconds for `members` to cast votes on proposals.
    /// @param _maxVotingPeriod Max. voting period in seconds for `members` to cast votes on proposals.
    /// @param _name Name for erc20 vote accounting.
    /// @param _symbol Symbol for erc20 vote accounting.
    constructor(address[] memory _extensions, address[] memory _guildTokens, address[] memory summoners, uint[] memory votes, uint _minVotingPeriod, uint _maxVotingPeriod, string memory _name, string memory _symbol) {
        for (uint i = 0; i < summoners.length; i++) {
             guildTokens.push(_guildTokens[i]); // update array of `guildTokens` for `ragequit()`
             memberList.push(summoners[i]); // update array of `members`
             totalSupply += votes[i]; // total votes incremented by summoning with erc20 accounting
             balanceOf[summoners[i]] = votes[i]; // vote weights granted to summoning `members` with erc20 accounting
             extensions[_extensions[i]] = true; // update mapping of approved `banks`
             members[summoners[i]].exists = true; // record that summoning `members` `exists`
             emit Transfer(address(this), summoners[i], votes[i]); // event reflects mint of erc20 votes to summoning `members`
        }
        minVotingPeriod = _minVotingPeriod; 
        maxVotingPeriod = _maxVotingPeriod; 
        name = _name; // Baal 'name' with erc20 accounting
        symbol = _symbol; // Baal 'symbol' with erc20 accounting
        emit SummonComplete(_extensions, _guildTokens, summoners, votes, _minVotingPeriod, _maxVotingPeriod, _name, _symbol);
    }
    
    /// @notice Execute membership action to mint or burn votes against whitelisted `extensions` in consideration of `msg.sender` and given `amount`.
    /// @param extension Whitelisted contract to trigger action.
    /// @param amount Number to submit in action - e.g., votes to mint for tribute or to burn in asset claim.
    /// @param mint Confirm whether action involves vote request - if `false`, perform burn.
    function memberAction(IBaalBank extension, uint amount, bool mint) external lock payable returns (uint reaction) {
        require(extensions[address(extension)], 'Baal::!extension'); // check `extension` is approved
        if (mint) {
            reaction = extension.memberAction{value: msg.value}(msg.sender, amount); // mint per `msg.sender`, `amount` and `msg.value`
            if (!members[msg.sender].exists) memberList.push(msg.sender); // update membership list if new
            totalSupply += reaction; // add to total `members`' votes with erc20 accounting
            balanceOf[msg.sender] += reaction; // add votes to member account with erc20 accounting
            emit Transfer(address(this), msg.sender, reaction); // event reflects mint of votes with erc20 accounting
        } else {
            reaction = extension.memberAction{value: msg.value}(msg.sender, amount); // burn per `msg.sender`, `amount` and `msg.value`
            totalSupply -= reaction; // subtract from total `members`' votes with erc20 accounting
            balanceOf[msg.sender] -= reaction; // subtract votes from member account with erc20 accounting
            emit Transfer(address(this), address(0), reaction); // event reflects burn of votes with erc20 accounting
        }
    }
    
    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    /// @notice Submit proposal to Baal `members` for approval within voting period - proposer must be registered member.
    /// @param to Account that receives low-level call `data` and ETH `value` - if `membership` flag (2), the account that will receive `value` votes - if `removal` (3), the account that will lose `value` votes.
    /// @param value ETH sent from Baal to execute approved proposal low-level call.
    /// @param data Raw data sent to `target` account for low-level call.
    /// @param details Context for proposal - could be IPFS hash, plaintext, or JSON.
    function submitProposal(address[] calldata to, uint[] calldata value, uint votingLength, uint8 flag, bytes[] calldata data, string calldata details) external lock returns (uint proposal) {
        require(votingLength >= minVotingPeriod && votingLength <= maxVotingPeriod, 'Baal::Voting period too long or short');
        require(flag <= 5, 'Baal::!flag'); // check flag is not out of bounds
        bool[6] memory flags; // stage flags - [action, governance, membership, removal, passed, processed]
        flags[flag] = true; // flag proposal type 
        proposals.push(Proposal(to, value, 0, 0, block.timestamp + votingLength, data, flags, details)); // push params into proposal struct - start vote timer
        emit SubmitProposal(to, value, votingLength, proposal, flag, data, details);
    }
    
    /// @notice Submit vote - proposal must exist and voting period must not have ended - non-member can cast `0` vote to signal.
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on.
    /// @param uintVote If '1', member will cast `yesVotes` onto proposal - if '2', `noVotes` will be counted.
    function submitVote(uint proposal, uint8 uintVote) external lock {
        Proposal storage prop = proposals[proposal];
        Vote vote = Vote(uintVote);
        uint balance = balanceOf[msg.sender]; // gas-optimize variable
        require(prop.votingEnds >= block.timestamp, 'Baal::ended'); // check voting period has not ended
        if (vote == Vote.Yes) {prop.yesVotes += balance;} // cast 'yes' votes per member balance to proposal
        if (vote == Vote.No) {prop.noVotes += balance;} // cast 'no' votes per member balance to proposal
        members[msg.sender].voted[proposal][balance] = uintVote; // record vote to member struct per account
        emit SubmitVote(msg.sender, balance, proposal, uintVote);
    }
    
    // ********************
    // PROCESSING FUNCTIONS
    // ********************
    /// @notice Process 'action' proposal (0) and execute low-level call(s) - proposal must be counted, unprocessed, and in voting period.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processActionProposal(uint proposal) external lock returns (bool[] memory successes, bytes[] memory results) {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[0], 'Baal::!action'); // check proposal type
        if (didPass(proposal))  // check if proposal approved by simple majority of `members`
            for (uint i = 0; i < prop.to.length; i++) {
                (bool success, bytes memory result) = prop.to[i].call{value:prop.value[i]}(prop.data[i]); // execute low-level call(s)
                successes[i] = success;
                results[i] = result;}
         prop.flags[5] = true; // flag that proposal processed
         emit ProcessProposal(proposal);
    }
    
    /// @notice Process 'governance' proposal (1) - proposal must be counted, unprocessed, and in voting period.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processGovernanceProposal(uint proposal) external lock {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[1], 'Baal::!governance'); // check proposal type
        if (didPass(proposal)) // check if proposal approved by simple majority of members
            for (uint i = 0; i < prop.to.length; i++) 
                if (prop.value[i] > 0) { // check `value` to toggle between approving or removing 'extension'
                    extensions[prop.to[i]] = true; // approve 'extension'
                } else {
                    extensions[prop.to[i]] = false;} // remove 'extension'
                if (prop.value[0] > 0) maxVotingPeriod = prop.value[0]; // reset voting period to first `value`
        prop.flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
    }
    
    /// @notice Process 'membership' proposal (2) - proposal must be counted, unprocessed, and in voting period.
    /// @param proposal Number of proposal in `proposals` array to process for execution.
    function processMemberProposal(uint proposal) external lock {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[2], 'Baal::!member'); // check proposal type
        if (didPass(proposal)) // check if proposal approved by simple majority of members
            for (uint i = 0; i < prop.to.length; i++) {
                if (!members[prop.to[i]].exists) memberList.push(prop.to[i]); // update membership list if new
                    totalSupply += prop.value[i]; // add to total member votes
                    balanceOf[prop.to[i]] += prop.value[i]; // add to `target` member votes
                    emit Transfer(address(this), prop.to[i], prop.value[i]);} // event reflects mint of erc20 votes
        prop.flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
    }
    
    /// @notice Process 'removal' proposal (3) - proposal must be counted, unprocessed, and in voting period.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processRemovalProposal(uint proposal) external lock {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[3], 'Baal::!removal'); // check proposal type
        if (didPass(proposal)) // check if proposal approved by simple majority of members
            for (uint i = 0; i < prop.to.length; i++) {
                totalSupply -= prop.value[i]; // subtract `balance` from total member votes
                balanceOf[prop.to[i]] -= prop.value[i]; // subtract member votes
                emit Transfer(address(this), address(0), prop.value[i]);} // event reflects burn of erc20 votes
        prop.flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
    }
    
    /// @notice Process member 'ragequit'.
    /// @param votes Baal membership weight to burn to claim 'fair share' of `guildTokens`.
    function ragequit(uint votes) external {
        require(members[msg.sender].highestIndexYesVote < proposals.length, 'Baal::highestIndexYesVote !processed');
        for (uint i = 0; i < guildTokens.length; i++) {
            uint amountToRagequit = votes * (IBaalBank(guildTokens[i]).balanceOf(address(this)) / totalSupply);
            if (amountToRagequit > 0) { // gas optimization to allow a higher maximum token limit
                (bool success, bytes memory data) = guildTokens[i].call(abi.encodeWithSelector(SIG_TRANSFER, msg.sender, amountToRagequit));
                require(success && (data.length == 0 || abi.decode(data, (bool))), 'Baal::transfer failed');}}
        balanceOf[msg.sender] -= votes; // burn member votes
        totalSupply -= votes; // update total
        emit Ragequit(msg.sender, votes); 
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

    /// @notice Returns flags for proposal type and status in Baal.
    function getProposalFlags(uint proposal) external view returns (bool[6] memory flags) {
        flags = proposals[proposal].flags;
    }
    
    /***************
    HELPER FUNCTIONS
    ***************/
    /// @notice Deposit ETH.
    receive() external payable {}

    /// @notice Checks if proposal passed.
    function didPass(uint proposal) private returns (bool passed) {
        Proposal storage prop = proposals[proposal];
        passed = prop.yesVotes > prop.noVotes;
        if (passed) prop.flags[4] = true; // if passed, flag
    }

    /// @dev Internal checks to validate basic proposal processing requirements. 
    function processingReady(uint proposal) private view returns (bool ready) {
        Proposal storage prop = proposals[proposal];
        require(proposal <= proposals.length, 'Baal::!exist'); // check proposal exists
        if (proposal != 0) require(proposals[proposal - 1].flags[5], 'Baal::prev. !processed'); // check previous proposal has processed
        require(!prop.flags[5], 'Baal::processed'); // check given proposal has not yet processed
        if (memberList.length == 1) {
            ready = true; // if single membership, process early
        } else if (prop.yesVotes > totalSupply / 2) { 
            ready = true; // process early if majority member support
        } else if (prop.votingEnds >= block.timestamp) { 
            ready = true;} // otherwise, process if voting period done
    }
}
