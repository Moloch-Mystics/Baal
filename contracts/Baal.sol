// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

/// @dev interface for Baal extensions
interface MemberAction {
    function memberBurn(address member, uint256 votes) external; // vote-weighted member burn - e.g., "ragequit" to claim capital
    function memberMint(address member, uint256 amount) external; // amount-weighted member vote mint - e.g., submit direct "tribute" for votes
}

/// @dev contains modifier for reentrancy check
contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "reentrancy");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

/// @dev Baal contract for guilds
contract Baal is ReentrancyGuard {
    address[] public memberList; // array of member accounts summoned or added by proposal
    uint256 public proposalCount; // counter for proposals submitted
    uint256 public totalEscrow; // counter for membership proposal tribute ETH escrow
    uint256 public totalSupply; // counter for member votes minted - erc20 compatible
    uint256 public votingPeriod; // period for members to cast votes on proposals in epoch time
    uint8 constant public decimals = 18; // decimals for erc20 vote accounting - 18 is default to match ETH and most erc20
    string public name; // name for erc20 vote accounting
    string public symbol; // symbol for erc20 vote accounting
    
    mapping(address => uint256) public balanceOf; // maps member accounts to votes
    mapping(address => bool) public extensions; // maps contracts approved for `memberAction()` 
    mapping(address => bool) public members; // maps member account to registration
    mapping(uint256 => Proposal) public proposals; // maps proposal number to struct details
    
    event SubmitProposal(address indexed proposer, address indexed target, uint256 indexed proposal, uint256 escrow, uint256 value, bytes data, bool membership, string details); // emits when member submits proposal 
    event SubmitVote(address indexed member, uint256 balance, uint256 indexed proposal, bool approve); // emits when member submits vote on proposal
    event ProcessProposal(uint256 indexed proposal); // emits when proposal is processed and finalized
    event Transfer(address indexed from, address indexed to, uint256 amount); // emits when member votes are minted or burned - erc20 compatible
    
    struct Proposal {
        address proposer;
        address target; // account that receives low-level call `data` and ETH `value` - if `membership` is `true` and data `length` is 0, account that will receive `value` votes - otherwise, account that will lose votes
        uint256 escrow;
        uint256 value; // ETH sent from Baal to execute approved proposal low-level call - if `membership` is `true` and data `length` is 0, reflects `votes` to grant member
        uint256 noVotes; // counter for member no votes to calculate approval on processing
        uint256 yesVotes; // counter for member yes votes to calculate approval on processing
        uint256 votingEnds; // termination date for proposal in seconds since epoch - derived from votingPeriod
        bytes data; // raw data sent to `target` account for low-level call
        bool membership; // flags whether proposal involves adding votes `value` to member account (`target`) - if `false` and no `data`, member votes will be burned
        bool passed; // flags whether proposal was approved by members
        bool processed; // flags whether proposal has been processed and executed
        string details; // context for proposal - could be IPFS hash, plaintext, or JSON
    }
    
    /// @dev deploy Baal and create initial array of member accounts with specific vote weights
    /// @param _extensions Accounts to approve for `memberAction()` in `extensions`
    /// @param summoners Accounts to add as members
    /// @param votes Voting weight per member
    /// @param _votingPeriod Voting period in seconds for members to cast votes on proposals
    /// @param _name Name for erc20 vote accounting
    /// @param _symbol Symbol for erc20 vote accounting
    constructor(address[] memory _extensions, address[] memory summoners, uint256[] memory votes, uint256 _votingPeriod, string memory _name, string memory _symbol) {
        for (uint256 i = 0; i < summoners.length; i++) {
             memberList.push(summoners[i]); // update array of member accounts
             totalSupply += votes[i]; // total votes incremented by summoning with erc20 accounting
             votingPeriod = _votingPeriod; 
             name = _name;
             symbol = _symbol;
             balanceOf[summoners[i]] = votes[i]; // vote weights granted to summoning member with erc20 accounting
             extensions[_extensions[i]] = true; // update mapping of approved extensions
             members[summoners[i]] = true; // confirm summoning member `exists`
             emit Transfer(address(this), summoners[i], votes[i]); // event reflects mint of erc20 votes to summoning members
        }
    }
    
    /// @dev Submit proposal to Baal members for approval within voting period - function is `payable`, so can escrow ETH for proposal
    /// @param target Account that receives low-level call `data` and ETH `value` - if `membership`, the account that will receive `value` votes - if `removal`, the account that will lose votes
    /// @param value ETH sent from Baal to execute approved proposal low-level call - if `membership`, reflects `votes` to grant member
    /// @param data Raw data sent to `target` account for low-level call 
    /// @param membership Flags whether proposal involves adding member votes - if `false`, then stage transaction to remove member votes ("ragekick" in moloch parlance)
    /// @param details Context for proposal - could be IPFS hash, plaintext, or JSON
    function submitProposal(address target, uint256 value, bytes calldata data, bool membership, string calldata details) external nonReentrant payable returns (uint256 count) {
        proposalCount++;
        uint256 proposal = proposalCount;
        
        if (msg.value > 0) {
            require(membership, "!membership");
            totalEscrow += msg.value;
        }
        
        proposals[proposal] = Proposal(msg.sender, target, msg.value, value, 0, 0, block.timestamp + votingPeriod, data, membership, false, false, details); // push params into proposal struct - start voting timer
        
        emit SubmitProposal(msg.sender, target, proposal, msg.value, value, data, membership, details);
        return proposal;
    }
    
    /// @dev Submit vote - caller must have uncast votes, proposal must exist and voting period must not have ended
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on 
    /// @param approve If `true`, member will cast `yesVotes` onto proposal - if `false, `noVotes` will be counted
    function submitVote(uint256 proposal, bool approve) external nonReentrant {
        uint256 balance = balanceOf[msg.sender];
        require(proposal <= proposalCount, "!exist");
        require(proposals[proposal].votingEnds >= block.timestamp, "ended");
        
        if (approve) {proposals[proposal].yesVotes += balance;} // cast 'yes' votes per member balance
        else {proposals[proposal].noVotes += balance;} // cast 'no' votes per member balance
        
        emit SubmitVote(msg.sender, balance, proposal, approve);
    }
    
    /// @dev Process proposal and execute low-level call or membership management - proposal must exist, be unprocessed, and voting period must not have ended
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processProposal(uint256 proposal) external nonReentrant returns (bool success, bytes memory retData) {
        require(proposal <= proposalCount, "!exist");
        require(proposals[proposal].votingEnds <= block.timestamp, "!ended");
        require(!proposals[proposal].processed, "processed");
      
        address target = proposals[proposal].target;
        bool membership = proposals[proposal].membership;
        
        if (proposals[proposal].yesVotes > proposals[proposal].noVotes) { // check if proposal approved by simple majority of members
            proposals[proposal].passed = true;
            if (membership) { // check into membership proposal
                uint256 value = proposals[proposal].value;
                // update list of member accounts if new
                if (!members[msg.sender]) { 
                    memberList.push(target);
                } 
                
                totalSupply += value; // add to total member votes
                balanceOf[target] += value; // add to `target` member votes
                
                emit Transfer(address(this), target, value); // event reflects mint of erc20 votes
            } else if (!membership && proposals[proposal].data.length == 0) { // alternatively, check into removal proposal
                uint256 balance = balanceOf[target];
                
                totalSupply -= balance; // subtract from total member votes
                balanceOf[target] = 0; // reset member votes
                members[target] = false; // reset member registration status
                
                emit Transfer(address(this), address(0), balance); // event reflects burn of erc20 votes
            } else if (address(this).balance - totalEscrow >= proposals[proposal].value)  { // otherwise, check into low-level call if sufficient ETH balance against membership escrows
                (bool callSuccess, bytes memory returnData) = target.call{value: proposals[proposal].value}(proposals[proposal].data); // execute low-level call
                return (callSuccess, returnData); // return call success and data
            }
        } else { // if proposal did not pass, return any escrowed ETH to `proposer`
            if (proposals[proposal].escrow > 0) {
                uint256 escrow = proposals[proposal].escrow;
                (bool callSuccess, ) = proposals[proposal].proposer.call{value: escrow}("");
                require(callSuccess, "!ethCall");
                totalEscrow -= escrow;
            }
        }
        
        proposals[proposal].processed = true; // record that proposal processed
        emit ProcessProposal(proposal);
    }
    
    /// @dev Execute member action to mint or burn votes against external contract - caller must have votes
    /// @param target Account to call to trigger member action - must be approved in `extensions`
    /// @param amount Number of member votes to submit in action
    /// @param mint Confirm whether transaction involves mint - if `false,` perform balance-based burn
    function memberAction(address target, uint256 amount, bool mint) external nonReentrant {
        require(members[msg.sender], "!member");
        require(extensions[target], "!extension"); 
        
        if (mint) {
            MemberAction(target).memberMint(msg.sender, amount);
            totalSupply += amount; // add to total member votes
            balanceOf[msg.sender] += amount; // add member votes
            emit Transfer(address(this), msg.sender, amount); // event reflects mint of erc20 votes
        } else {    
            MemberAction(target).memberBurn(msg.sender, amount);
            totalSupply -= amount; // subtract from total member votes
            balanceOf[msg.sender] -= amount; // subtract member votes
            emit Transfer(address(this), address(0), amount); // event reflects burn of erc20 votes
        }
    }
    
    /// @dev Returns array list of member accounts in Baal
    function getMembers() external view returns (address[] memory membership) {
        return memberList;
    }
    
    /// @dev Fallback to collect received ETH into Baal
    receive() external payable {}
}
