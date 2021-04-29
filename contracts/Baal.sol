/*TO DO - 
i. ADD WHITELISTING FOR NEW GUILDTOKENS IN GOV PROPOSAL
ii. ADD ERC712 SIGNATURE VOTING*/

/// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.4;

/// @notice Interface for Baal membership and banking extensions.
interface IBaalBank {
    function balanceOf(address account) external view returns (uint256); // erc20 helper for balance checks
    function memberBurn(address member, uint256 votes) external; // amount-weighted vote burn - e.g., member 'ragequit' to claim fair share of capital 
    function memberMint(address member) external payable returns (uint256); // pay-weighted vote mint - e.g., member submits ETH 'tribute' for votes
}

/// @notice Baal for Guilds.
contract Baal {
    address[] guildTokens; // internal accounting for erc20 tokens approved for `ragequit()` and `members` 'removal'
    address[] memberList; // internal array of `members` accounts summoned or added by proposal
    uint public proposalCount = proposals.length; // counter for proposals submitted
    uint public totalSupply; // counter for `members` votes minted with erc20 accounting
    uint public minVotingPeriod; // min. period proposal voting in epoch time
    uint public maxVotingPeriod; // max. period for proposal voting in epoch time
    uint8 constant public decimals = 18; // 'decimals' for erc20 vote accounting - '18' is default to match ETH and most erc20
    string public name; // 'name' for erc20 vote accounting
    string public symbol; // 'symbol' for erc20 vote accounting
    bytes4 constant SIG_TRANSFER = 0xa9059cbb; // transfer(address,uint256)
    bytes4 constant SIG_TRANSFER_FROM = 0x23b872dd; // transferFrom(address,address,uint256)
    Proposal[] public proposals; // info for each Baal proposal per order proposed
    
    mapping(address => uint) public balanceOf; // maps `members` accounts to votes with erc20 accounting
    mapping(address => bool) public extensions; // maps contracts approved for `memberAction()` that burn or mint votes
    mapping(address => Member) public members; // maps `members` accounts to struct details
    
    event SummonComplete(address[] indexed summoners, address[] indexed ragequitTokens, uint256[] votes, uint256 minVotingPeriod, uint256 maxVotingPeriod, string name, string symbol);
    event SubmitProposal(address[] target, uint8 indexed flag, uint indexed proposal, uint[] value, bytes[] data, string details); // emits when `members` submit proposal 
    event SubmitVote(address indexed member, uint balance, uint indexed proposal, bool approve); // emits when `members` submit vote on proposal
    event ProcessProposal(uint indexed proposal); // emits when proposal is processed and executed
    event Transfer(address indexed from, address indexed to, uint amount); // emits when `members`' votes are minted or burned with erc20 accounting
    event Ragequit(address indexed memberAddress, uint256 sharesToBurn);
    
    /// @dev Reentrancy guard.
    uint unlocked = 1;
    modifier lock() {
        require(unlocked == 1, 'locked');
        unlocked = 0;
        _;
        unlocked = 1;
    }
    
    struct Member {
        bool exists; // tracks `members` account registration for `memberAction()` and `submitProposal()`
        uint highestIndexYesVote; // highest proposal index # on which the member voted YES
        mapping(uint => mapping(uint => bool)) voted; // maps votes on proposals by `members` account - gets votes cast and whether approved
    }
    
    struct Proposal {
        address[] target; // account(s) that receives low-level call `data` and ETH `value` - if `membership` flag (2) or `removal` (3), account(s) that will receive or lose `value` votes, respectively
        uint[] value; // ETH sent from Baal to execute approved proposal low-level call(s)
        uint yesVotes; // counter for `members` 'yes' votes to calculate approval on processing
        uint noVotes; // counter for `members` 'no' votes to calculate approval on processing
        uint votingEnds; // termination date for proposal in seconds since epoch - derived from `votingPeriod`
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
    constructor(address[] memory _guildTokens, address[] memory _extensions, address[] memory summoners, uint[] memory votes, uint _minVotingPeriod,  uint _maxVotingPeriod, string memory _name, string memory _symbol) {
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
        proposals[0].flags[5] = true; // internal trick to save gas in validating proposals
        emit SummonComplete(summoners, _guildTokens, votes, _minVotingPeriod, _maxVotingPeriod, _name, _symbol);
    }
    
    /// @notice Execute `members`' action to mint or burn `votes` against external contract.
    /// @param extension Account to call to trigger `members`' action - must be approved in `extensions`.
    /// @param votes Number of `members`' `votes` to submit in action.
    /// @param mint Confirm whether transaction involves mint - if `false,` perform burn.
    function memberAction(IBaalBank extension, uint votes, bool mint) external lock payable {
        require(extensions[address(extension)], '!extension'); // check `extension` is approved
        require(members[msg.sender].exists, '!member'); // check caller membership
        if (mint) {
            uint256 minted = extension.memberMint{value: msg.value}(msg.sender); // mint per `extension` return based on member
            totalSupply += minted; // add to total `members`' votes with erc20 accounting
            balanceOf[msg.sender] += minted; // add votes to member account with erc20 accounting
            emit Transfer(address(this), msg.sender, minted); // event reflects mint of votes with erc20 accounting
        } else {    
            totalSupply -= votes; // subtract from total `members`' votes with erc20 accounting
            balanceOf[msg.sender] -= votes; // subtract votes from member account with erc20 accounting
            extension.memberBurn(msg.sender, votes); // burn `votes` against `target` based on member
            emit Transfer(address(this), address(0), votes); // event reflects burn of votes with erc20 accounting
        }
    }
    
    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    /// @notice Submit proposal to Baal `members` for approval within voting period - proposer must be registered member.
    /// @param target Account that receives low-level call `data` and ETH `value` - if `membership` flag (2), the account that will receive `value` votes - if `removal` (3), the account that will lose `value` votes.
    /// @param value ETH sent from Baal to execute approved proposal low-level call.
    /// @param data Raw data sent to `target` account for low-level call.
    /// @param details Context for proposal - could be IPFS hash, plaintext, or JSON.
    function submitProposal(address[] calldata target, uint8 flag, uint votingLength, uint[] calldata value, bytes[] calldata data, string calldata details) external lock returns (uint proposal) {
        require(votingLength >= minVotingPeriod && votingLength <= maxVotingPeriod, 'Baal:: Voting period too long or short');
        require(flag <= 5, '!flag'); // check flag is not out of bounds
        bool[6] memory flags; // stage flags - [governance, membership, removal, passed, processed]
        flags[flag] = true; // flag proposal type 
        proposals.push(Proposal(target, value, 0, 0, block.timestamp + votingLength, data, flags, details)); // push params into proposal struct - start vote timer
        emit SubmitProposal(target, flag, proposal, value, data, details);
    }
    
    /// @notice Submit vote - proposal must exist and voting period must not have ended - non-member can cast `0` vote to signal.
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on.
    /// @param approve If `true`, member will cast `yesVotes` onto proposal - if `false, `noVotes` will be counted.
    function submitVote(uint proposal, bool approve) external lock {
        Proposal storage prop = proposals[proposal];
        uint balance = balanceOf[msg.sender]; // gas-optimize variable
        require(prop.votingEnds >= block.timestamp, 'ended'); // check voting period has not ended
        if (approve) {prop.yesVotes += balance;} // cast 'yes' votes per member balance to proposal
        else {prop.noVotes += balance;} // cast 'no' votes per member balance to proposal
        members[msg.sender].voted[proposal][balance] = approve; // record vote to member struct per account
        emit SubmitVote(msg.sender, balance, proposal, approve);
    }
    
    // ********************
    // PROCESSING FUNCTIONS
    // ********************
    /// @notice Process 'action' proposal (0) and execute low-level call(s) - proposal must be counted, unprocessed, and in voting period.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processActionProposal(uint proposal) external lock returns (bool[] memory successes, bytes[] memory results) {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[0], '!action'); // check proposal type
        if (didPass(proposal)) { // check if proposal approved by simple majority of `members`
            for (uint i = 0; i < prop.target.length; i++) {
                (bool success, bytes memory result) = prop.target[i].call{value:prop.value[i]}(prop.data[i]); // execute low-level call(s)
                successes[i] = success;
                results[i] = result;}}
         prop.flags[5] = true; // flag that proposal processed
         emit ProcessProposal(proposal);
    }
    
    /// @notice Process 'governance' proposal (1) - proposal must be counted, unprocessed, and in voting period.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processGovernanceProposal(uint proposal) external lock {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[1], '!governance'); // check proposal type
        if (didPass(proposal)) { // check if proposal approved by simple majority of members
            for (uint i = 0; i < prop.target.length; i++) {
                if (prop.value[i] > 0) { // check `value` to toggle between approving or removing 'extension'
                    extensions[prop.target[i]] = true; // approve 'extension'
                } else {
                    extensions[prop.target[i]] = false;}} // remove 'extension'
                if (prop.value[0] > 0) {maxVotingPeriod = prop.value[0];}} // reset voting period to first `value`
        prop.flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
    }
    
    /// @notice Process 'membership' proposal (2) - proposal must be counted, unprocessed, and in voting period.
    /// @param proposal Number of proposal in `proposals` array to process for execution.
    function processMemberProposal(uint proposal) external lock {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[2], '!member'); // check proposal type
        if (didPass(proposal)) { // check if proposal approved by simple majority of members
            for (uint i = 0; i < prop.target.length; i++) {
                if (!members[prop.target[i]].exists) {memberList.push(prop.target[i]);} // update list of member accounts if new
                    totalSupply += prop.value[i]; // add to total member votes
                    balanceOf[prop.target[i]] += prop.value[i]; // add to `target` member votes
                    emit Transfer(address(this), prop.target[i], prop.value[i]);}} // event reflects mint of erc20 votes
        prop.flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
    }
    
    /// @notice Process 'removal' proposal (3) - proposal must be counted, unprocessed, and in voting period.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processRemovalProposal(uint proposal) external lock {
        processingReady(proposal); // validate processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[3], '!removal'); // check proposal type
        if (didPass(proposal)) { // check if proposal approved by simple majority of members
            for (uint i = 0; i < prop.target.length; i++) {
                totalSupply -= prop.value[i]; // subtract `balance` from total member votes
                balanceOf[prop.target[i]] -= prop.value[i]; // subtract member votes
                memberList.pop();
                emit Transfer(address(this), address(0), prop.value[i]);}} // event reflects burn of erc20 votes
        prop.flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
    }
    
    /// @notice Process member 'ragequit'.
    /// @param votes Baal membership weight to burn to claim 'fair share' of `guildTokens`.
    function ragequit(uint votes) external {
        require(balanceOf[msg.sender] >= votes, 'insufficient votes');
        require(members[msg.sender].highestIndexYesVote < proposalCount, 'cannot ragequit until highest index proposal member voted YES on is processed');
        for (uint256 i = 0; i < guildTokens.length; i++) {
            uint256 amountToRagequit = fairShare(IBaalBank(guildTokens[i]).balanceOf(address(this)), votes, totalSupply);
            if (amountToRagequit > 0) { // gas optimization to allow a higher maximum token limit
                (bool success, bytes memory data) = guildTokens[i].call(abi.encodeWithSelector(SIG_TRANSFER, msg.sender, amountToRagequit));
                require(success && (data.length == 0 || abi.decode(data, (bool))), 'transfer failed');
            }
        }
        balanceOf[msg.sender] -= votes; // subtract member votes
        totalSupply -= votes; // subtract from total votes
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
        prop.flags[4] = true; // flag that vote passed
    }
    
    /// @dev Internal calculation for member fair share of `guildTokens`.
    function fairShare(uint balance, uint votes, uint total) private pure returns (uint256 amount) {
        require(total != 0);
        if (balance == 0) {amount = 0;}
        uint prod = balance * votes;
        if (prod / balance == votes) { // no overflow in multiplication above?
            amount = prod / total;
        }
        amount = (balance / total) * votes;
    }

    /// @dev Internal checks to validate basic proposal processing requirements. 
    function processingReady(uint proposal) private view returns (bool ready) {
        require(proposal <= proposalCount, '!exist'); // check proposal exists
        require(proposals[proposal - 1].flags[5], 'prev!processed'); // check previous proposal has processed
        require(!proposals[proposal].flags[5], 'processed'); // check given proposal has not yet processed
        if (memberList.length == 1) ready = true;
        require(proposals[proposal].votingEnds <= block.timestamp, '!ended'); // check voting period has ended
        uint halfShares = totalSupply / 2;
        if (proposals[proposal].yesVotes > halfShares) { // early execution b/c of 50%+
            ready = true;
        } else if (proposals[proposal].votingEnds >= block.timestamp) { // o/wise, voting period done
            ready = true;}
    }
}
