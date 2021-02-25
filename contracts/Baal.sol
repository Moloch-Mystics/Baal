// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

/// @dev interface for Baal extensions
interface MemberAction {
    function memberBurn(address member, uint256 votes) external; // amount-weighted member burn - e.g., "ragequit" to claim capital in external bank contract
    function memberMint(address member) external payable returns (uint256); // amount-weighted member vote mint - e.g., submit direct "tribute" for votes
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

/// @dev Baal for Guilds
contract Baal is ReentrancyGuard {
    address[] public memberList; // array of member accounts summoned or added by proposal
    uint256 public proposalCount; // counter for proposals submitted
    uint256 public totalSupply; // counter for member votes minted - erc20 compatible
    uint256 public votingPeriod; // period for members to cast votes on proposals in epoch time
    uint8 constant public decimals = 18; // decimals for erc20 vote accounting - 18 is default to match ETH and most erc20
    string public name; // name for erc20 vote accounting
    string public symbol; // symbol for erc20 vote accounting
    
    mapping(address => uint256) public balanceOf; // maps member accounts to votes
    mapping(address => bool) public extensions; // maps contracts approved for `memberAction()` 
    mapping(address => Member) public members; // maps member account to registration
    mapping(uint256 => Proposal) public proposals; // maps proposal number to struct details
    
    event SubmitProposal(address indexed target, uint8 indexed flag, uint256 indexed proposal, uint256 value, bytes data, string details); // emits when member submits proposal 
    event SubmitVote(address indexed member, uint256 balance, uint256 indexed proposal, bool approve); // emits when member submits vote on proposal
    event ProcessProposal(uint256 indexed proposal); // emits when proposal is processed and executed
    event Transfer(address indexed from, address indexed to, uint256 amount); // emits when member votes are minted or burned - erc20 compatible
    
    struct Member {
        bool exists; // tracks member account registration
        mapping(uint256 => mapping(uint256 => bool)) voted; // maps votes on proposals by member account - whether approved and votes cast
    }
    
    struct Proposal {
        address target; // account that receives low-level call `data` and ETH `value` - if `membership` is `true` and data `length` is 0, account that will receive `value` votes - otherwise, account that will lose votes
        uint256 value; // ETH sent from Baal to execute approved proposal low-level call - if `membership` is `true` and data `length` is 0, reflects `votes` to grant member
        uint256 noVotes; // counter for member no votes to calculate approval on processing
        uint256 yesVotes; // counter for member yes votes to calculate approval on processing
        uint256 votingEnds; // termination date for proposal in seconds since epoch - derived from votingPeriod
        bytes data; // raw data sent to `target` account for low-level call
        bool[6] flags; // [action, governance, membership, removal, passed, processed]
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
             balanceOf[summoners[i]] = votes[i]; // vote weights granted to summoning member with erc20 accounting
             extensions[_extensions[i]] = true; // update mapping of approved extensions
             members[summoners[i]].exists = true; // confirm summoning member `exists`
             emit Transfer(address(this), summoners[i], votes[i]); // event reflects mint of erc20 votes to summoning members
        }
        
        votingPeriod = _votingPeriod; 
        name = _name;
        symbol = _symbol;
    }
    
    /// @dev Execute member action to mint or burn votes against external contract - caller must have votes
    /// @param target Account to call to trigger member action - must be approved in `extensions`
    /// @param amount Number of member votes to submit in action
    /// @param mint Confirm whether transaction involves mint - if `false,` perform balance-based burn
    function memberAction(address target, uint256 amount, bool mint) external payable nonReentrant {
        require(members[msg.sender].exists, "!member");
        require(extensions[target], "!extension"); 
        
        if (mint) {
            uint256 minted = MemberAction(target).memberMint{value: msg.value}(msg.sender); // mint from `target` `msg.value` return based on member
            totalSupply += minted; // add to total member votes
            balanceOf[msg.sender] += minted; // add member votes
            emit Transfer(address(this), msg.sender, minted); // event reflects mint of erc20 votes
        } else {    
            totalSupply -= amount; // subtract from total member votes
            balanceOf[msg.sender] -= amount; // subtract member votes
            MemberAction(target).memberBurn(msg.sender, amount); // burn `amount` againt `target` based on member
            emit Transfer(address(this), address(0), amount); // event reflects burn of erc20 votes
        }
    }
    
    /// @dev Submit proposal to Baal members for approval within voting period
    /// @param target Account that receives low-level call `data` and ETH `value` - if `membership` flag (2), the account that will receive `value` votes - if `removal` (3), the account that will lose votes
    /// @param value ETH sent from Baal to execute approved proposal low-level call - if `membership`, reflects `votes` to grant member
    /// @param data Raw data sent to `target` account for low-level call 
    /// @param details Context for proposal - could be IPFS hash, plaintext, or JSON
    function submitProposal(address target, uint8 flag, uint256 value, bytes calldata data, string calldata details) external nonReentrant returns (uint256 count) {
        proposalCount++;
        uint256 proposal = proposalCount;
        bool[6] memory flags; // [governance, membership, removal, passed, processed]
        flags[flag] = true; // flag proposal type - must be 
        proposals[proposal] = Proposal(target, value, 0, 0, block.timestamp + votingPeriod, data, flags, details); // push params into proposal struct - start voting timer
        emit SubmitProposal(target, flag, proposal, value, data, details);
        return proposal;
    }
    
    /// @dev Submit vote - proposal must exist and voting period must not have ended
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on 
    /// @param approve If `true`, member will cast `yesVotes` onto proposal - if `false, `noVotes` will be counted
    function submitVote(uint256 proposal, bool approve) external nonReentrant {
        uint256 balance = balanceOf[msg.sender];
        require(proposal <= proposalCount, "!exist");
        require(proposals[proposal].votingEnds >= block.timestamp, "ended");
        if (approve) {proposals[proposal].yesVotes += balance;} // cast 'yes' votes per member balance to proposal
        else {proposals[proposal].noVotes += balance;} // cast 'no' votes per member balance to proposal
        members[msg.sender].voted[proposal][balance] = approve; // record member vote to account
        emit SubmitVote(msg.sender, balance, proposal, approve);
    }
    
    /// @dev Process proposal and execute low-level call if not flaged for governance, membership or removal - proposal must exist, be unprocessed, and voting period must not have ended
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processActionProposal(uint256 proposal) external nonReentrant returns (bool success, bytes memory retData) {
        require(proposal <= proposalCount, "!exist");
        require(proposals[proposal].votingEnds <= block.timestamp, "!ended");
        require(proposals[proposal].flags[0] && !proposals[proposal].flags[5], "!action or processed");
        
        if (proposals[proposal].yesVotes > proposals[proposal].noVotes) { // check if proposal approved by simple majority of members
            proposals[proposal].flags[4] = true; // flag that vote passed
            (bool callSuccess, bytes memory returnData) = proposals[proposal].target.call{value: proposals[proposal].value}(proposals[proposal].data); // execute low-level call
            proposals[proposal].flags[5] = true; // flag that proposal processed
            emit ProcessProposal(proposal);
            return (callSuccess, returnData); // return call success status and data
        } else {
            proposals[proposal].flags[5] = true; // flag that proposal processed
            emit ProcessProposal(proposal);
        }
    }
    
    /// @dev Process proposal and execute low-level call if not flaged for governance, membership or removal - proposal must exist, be unprocessed, and voting period must not have ended
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processGovernanceProposal(uint256 proposal) external nonReentrant {
        require(proposal <= proposalCount, "!exist");
        require(proposals[proposal].votingEnds <= block.timestamp, "!ended");
        require(proposals[proposal].flags[1] && !proposals[proposal].flags[5], "!governance or processed");
        
        if (proposals[proposal].yesVotes > proposals[proposal].noVotes) { // check if proposal approved by simple majority of members
            proposals[proposal].flags[4] = true; // flag that vote passed
            if (proposals[proposal].value > 0) { // crib `value` to toggle between approving or removing extension
                extensions[proposals[proposal].target] = true; // approve extension
                votingPeriod = proposals[proposal].value; // reset voting period - note: placed here as sanity check to avoid setting period to '0'
            } else {
                extensions[proposals[proposal].target] = false; // remove extension
            }
        }
        
        proposals[proposal].flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
        
    }
    
    /// @dev Process proposal and execute low-level call if not flaged for governance, membership or removal - proposal must exist, be unprocessed, and voting period must not have ended
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processMemberProposal(uint256 proposal) external nonReentrant {
        require(proposal <= proposalCount, "!exist");
        require(proposals[proposal].votingEnds <= block.timestamp, "!ended");
        require(proposals[proposal].flags[2] && !proposals[proposal].flags[5], "!member or processed");
          
        if (proposals[proposal].yesVotes > proposals[proposal].noVotes) { // check if proposal approved by simple majority of members
            proposals[proposal].flags[4] = true; // flag that vote passed
            address target = proposals[proposal].target;
            uint256 value = proposals[proposal].value;
            
            if (!members[msg.sender].exists) { // update list of member accounts if new
                memberList.push(target);
            } 

            totalSupply += value; // add to total member votes
            balanceOf[target] += value; // add to `target` member votes
            emit Transfer(address(this), target, value); // event reflects mint of erc20 votes
        }
        
        proposals[proposal].flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
    }
    
    /// @dev Process proposal and execute low-level call if not flaged for governance, membership or removal - proposal must exist, be unprocessed, and voting period must not have ended
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processRemovalProposal(uint256 proposal) external nonReentrant {
        require(proposal <= proposalCount, "!exist");
        require(proposals[proposal].votingEnds <= block.timestamp, "!ended");
        require(proposals[proposal].flags[3] && !proposals[proposal].flags[5], "processed");
        
        if (proposals[proposal].yesVotes > proposals[proposal].noVotes) { // check if proposal approved by simple majority of members
            uint256 value = proposals[proposal].value;
            proposals[proposal].flags[4] = true; // flag that vote passed
            totalSupply -= value; // subtract `balance` from total member votes
            balanceOf[proposals[proposal].target] -= value; // subtract member votes
            emit Transfer(address(this), address(0), value); // event reflects burn of erc20 votes
        }
        
        proposals[proposal].flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
    }
    
    /***************
    HELPER FUNCTIONS
    ***************/
    /// @dev Returns array list of member accounts in Baal
    function getMemberList() external view returns (address[] memory membership) {
        return memberList;
    }

    /// @dev Returns flags for proposal in Baal
    function getProposalFlags(uint256 proposal) external view returns (bool[6] memory flags) {
        return proposals[proposal].flags;
    }
    
    /// @dev Fallback to collect received ETH into Baal
    receive() external payable {}
}
