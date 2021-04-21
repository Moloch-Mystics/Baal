/// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.4;

/// @notice Interface for Baal banking and extensions.
interface IBaalBank {
    function balanceOf(address account) external view returns (uint256); // erc20 helper for balance checks
    function memberBurn(address member, uint256 votes) external; // amount-weighted vote burn - e.g., member 'ragequit' to claim fair share of capital 
    function memberMint(address member) external payable returns (uint256); // payable-weighted vote mint - e.g., member submits ETH 'tribute' for votes
}

/// @notice Baal for Guilds.
contract Baal {
    address[] guildTokens; // internal accounting for erc20 tokens approved for `ragequit()` and `members` 'removal'
    address[] memberList; // internal array of `members` accounts summoned or added by proposal
    uint public proposalCount; // counter for proposals submitted
    uint public totalSupply; // counter for `members` votes minted with erc20 accounting
    uint public votingPeriod; // period for `members` to cast votes on proposals in epoch time
    uint8 constant public decimals = 18; // decimals for erc20 vote accounting - 18 is default to match ETH and most erc20
    string public name; // 'name' for erc20 vote accounting
    string public symbol; // 'symbol' for erc20 vote accounting
    bytes4 constant SIG_TRANSFER = 0xa9059cbb; // transfer(address,uint256)
    bytes4 constant SIG_TRANSFER_FROM = 0x23b872dd; // transferFrom(address,address,uint256)
    
    mapping(address => uint) public balanceOf; // maps `members` accounts to votes with erc20 accounting
    mapping(address => bool) public banks; // maps contracts approved for `memberAction()` that burn or mint votes
    mapping(address => Member) public members; // maps `members` accounts to struct details
    mapping(uint => Proposal) public proposals; // maps proposal number to struct details
    
    event SubmitProposal(address[] target, uint8 indexed flag, uint indexed proposal, uint[] value, bytes[] data, string details); // emits when `members` submit proposal 
    event SubmitVote(address indexed member, uint balance, uint indexed proposal, bool approve); // emits when `members` submit vote on proposal
    event ProcessProposal(uint indexed proposal); // emits when proposal is processed and executed
    event Transfer(address indexed from, address indexed to, uint amount); // emits when `members`' votes are minted or burned with erc20 accounting
    
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
        mapping(uint => mapping(uint => bool)) voted; // maps votes on proposals by `members` account - gets votes cast and whether approved
    }
    
    struct Proposal {
        address[] target; // account that receives low-level call `data` and ETH `value` - if `membership` flag (2) or `removal` (3), account that will receive or lose `value` votes, respectively
        uint[] value; // ETH sent from Baal to execute approved proposal low-level call
        uint yesVotes; // counter for `members` 'yes' votes to calculate approval on processing
        uint noVotes; // counter for `members` 'no' votes to calculate approval on processing
        uint votingEnds; // termination date for proposal in seconds since epoch - derived from `votingPeriod`
        bytes[] data; // raw data sent to `target` account for low-level call
        bool[6] flags; // flags for proposal type and status - [action, governance, membership, removal, passed, processed] 
        string details; // context for proposal - could be IPFS hash, plaintext, or JSON
    }
    
    /// @notice Deploy Baal and create initial array of `members` accounts with specific voting weights.
    /// @param _guildTokens Tokens approved for internal accounting - `ragequit()` of votes.
    /// @param _banks External contracts approved for `memberAction()`.
    /// @param summoners Accounts to add as `members`.
    /// @param votes Voting weight among `members`.
    /// @param _votingPeriod Voting period in seconds for `members` to cast votes on proposals.
    /// @param _name Name for erc20 vote accounting.
    /// @param _symbol Symbol for erc20 vote accounting.
    constructor(address[] memory _guildTokens, address[] memory _banks, address[] memory summoners, uint[] memory votes, uint _votingPeriod, string memory _name, string memory _symbol) {
        for (uint i = 0; i < summoners.length; i++) {
             guildTokens.push(_guildTokens[i]); // update array of `guildTokens` for `ragequit()`
             memberList.push(summoners[i]); // update array of `members`
             totalSupply += votes[i]; // total votes incremented by summoning with erc20 accounting
             balanceOf[summoners[i]] = votes[i]; // vote weights granted to summoning `members` with erc20 accounting
             banks[_banks[i]] = true; // update mapping of approved `banks`
             members[summoners[i]].exists = true; // record that summoning `members` `exists`
             emit Transfer(address(this), summoners[i], votes[i]); // event reflects mint of erc20 votes to summoning `members`
        }
        votingPeriod = _votingPeriod; // set general voting period - can be updated with 'governance' (1) proposal
        name = _name; // Baal 'name' with erc20 accounting
        symbol = _symbol; // Baal 'symbol' with erc20 accounting
        proposals[0].flags[5] = true; // internal trick to save gas in validating proposals
    }
    
    /// @notice Execute `members`' action to mint or burn votes against external contract.
    /// @param bank Account to call to trigger `members`' action - must be approved in `banks`.
    /// @param amount Number of `members`' votes to submit in action.
    /// @param mint Confirm whether transaction involves mint - if `false,` perform balance-based burn.
    function memberAction(IBaalBank bank, uint amount, bool mint) external lock payable {
        require(banks[address(bank)], "!bank"); // check bank is approved
        require(members[msg.sender].exists, "!member"); // check membership
        if (mint) {
            uint256 minted = bank.memberMint{value: msg.value}(msg.sender); // mint from `bank` `msg.value` return based on member
            totalSupply += minted; // add to total `members`' votes with erc20 accounting
            balanceOf[msg.sender] += minted; // add votes to member account with erc20 accounting
            emit Transfer(address(this), msg.sender, minted); // event reflects mint of votes with erc20 accounting
        } else {    
            totalSupply -= amount; // subtract from total `members`' votes with erc20 accounting
            balanceOf[msg.sender] -= amount; // subtract votes from member account with erc20 accounting
            bank.memberBurn(msg.sender, amount); // burn `amount` againt `target` based on member
            emit Transfer(address(this), address(0), amount); // event reflects burn of votes with erc20 accounting
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
    function submitProposal(address[] calldata target, uint8 flag, uint[] calldata value, bytes[] calldata data, string calldata details) external lock returns (uint proposal) {
        require(members[msg.sender].exists, "!member"); // check membership
        require(flag <= 5, "!flag"); // check flag is not out of bounds
        proposalCount++; // increment proposals
        proposal = proposalCount; // set proposal number from count
        bool[6] memory flags; // stage flags - [governance, membership, removal, passed, processed]
        flags[flag] = true; // flag proposal type 
        proposals[proposal] = Proposal(target, value, 0, 0, block.timestamp + votingPeriod, data, flags, details); // push params into proposal struct - start vote timer
        emit SubmitProposal(target, flag, proposal, value, data, details);
    }
    
    /// @notice Submit vote - proposal must exist and voting period must not have ended - non-member can cast `0` vote to signal.
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on.
    /// @param approve If `true`, member will cast `yesVotes` onto proposal - if `false, `noVotes` will be counted.
    function submitVote(uint proposal, bool approve) external lock {
        Proposal storage prop = proposals[proposal];
        uint balance = balanceOf[msg.sender]; // gas-optimize variable
        require(prop.votingEnds >= block.timestamp, "ended"); // check voting period has not ended
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
        _validateProposalForProcessing(proposal); // validate basic processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[0], "!action"); // check proposal type and whether already processed
        if (prop.yesVotes > prop.noVotes) { // check if proposal approved by simple majority of `members`
            prop.flags[4] = true; // flag that vote passed
            for (uint i = 0; i < prop.target.length; i++) {
                (bool success, bytes memory result) = prop.target[i].call{value:prop.value[i]}(prop.data[i]); // execute low-level call
                successes[i] = success;
                results[i] = result;}}
         prop.flags[5] = true; // flag that proposal processed
         emit ProcessProposal(proposal);
    }
    
    /// @notice Process 'governance' proposal (1) - proposal must be counted, unprocessed, and in voting period.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processGovernanceProposal(uint proposal) external lock {
        _validateProposalForProcessing(proposal); // validate basic processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[1], "!governance"); // check proposal type and whether already processed
        if (prop.yesVotes > prop.noVotes) { // check if proposal approved by simple majority of members
            prop.flags[4] = true; // flag that vote passed
            for (uint i = 0; i < prop.target.length; i++) {
                if (prop.value[i] > 0) { // crib `value` to toggle between approving or removing bank
                    banks[prop.target[i]] = true; // approve bank
                } else {
                    banks[prop.target[i]] = false;}} // remove bank
                if (prop.value[0] > 0) {votingPeriod = prop.value[0];}} // reset voting period to first `value`
        prop.flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
        
    }
    
    /// @notice Process 'membership' proposal (2) - proposal must be counted, unprocessed, and in voting period.
    /// @param proposal Number of proposal in `proposals` mapping to process for execution.
    function processMemberProposal(uint proposal) external lock {
        _validateProposalForProcessing(proposal); // validate basic processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[2], "!member"); // check proposal type and whether already processed
        if (prop.yesVotes > prop.noVotes) { // check if proposal approved by simple majority of members
            prop.flags[4] = true; // flag that vote passed
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
        _validateProposalForProcessing(proposal); // validate basic processing requirements
        Proposal storage prop = proposals[proposal];
        require(prop.flags[3], "!removal"); // check proposal type and whether already processed
        if (prop.yesVotes > prop.noVotes) { // check if proposal approved by simple majority of members
            prop.flags[4] = true; // flag that vote passed
            for (uint i = 0; i < prop.target.length; i++) {
                totalSupply -= prop.value[i]; // subtract `balance` from total member votes
                balanceOf[prop.target[i]] -= prop.value[i]; // subtract member votes
                emit Transfer(address(this), address(0), prop.value[i]);}} // event reflects burn of erc20 votes
        prop.flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
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
    
    /// @dev Internal checks to validate basic proposal processing requirements. 
    function _validateProposalForProcessing(uint proposal) private view {
        require(proposal <= proposalCount, "!exist"); // check proposal exists
        require(proposals[proposal - 1].flags[5], "prev!processed"); // check previous proposal has processed
        require(!proposals[proposal].flags[5], "processed"); // check proposal has not processed
        require(proposals[proposal].votingEnds <= block.timestamp, "!ended"); // check voting period has ended
    }
}
