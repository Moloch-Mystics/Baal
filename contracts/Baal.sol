/// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

/// @dev brief interface for erc20 tokens
interface IERC20 { 
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @dev interface for Baal banking upgrades
interface MemberAction {
    function memberBurn(address member, uint256 votes) external; // amount-weighted vote burn - e.g., member "ragequit" to claim fair share of capital 
    function memberMint(address member) external payable returns (uint256); // payable-weighted vote mint - e.g., member submits ETH "tribute" for votes
}

/// @dev contains modifier for reentrancy checks
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
// ~ TO - DO - add ragequitting on guildTokens
// --- add guildTokens to governance approval
/////// ---- custom voting period params
contract Baal is ReentrancyGuard {
    address[] public guildTokens; // internal accounting for erc20 tokens approved for `ragequit()` and `members` 'removal'
    address[] public memberList; // array of `members` accounts summoned or added by proposal count
    uint256 public proposalCount; // counter for proposals submitted
    uint256 public totalSupply; // counter for `members` votes minted with erc20 accounting
    uint256 public votingPeriod; // period for `members` to cast votes on proposals in epoch time
    uint8 constant public decimals = 18; // decimals for erc20 vote accounting - 18 is default to match ETH and most erc20
    string public name; // 'name' for erc20 vote accounting
    string public symbol; // 'symbol' for erc20 vote accounting
    
    mapping(address => uint256) public balanceOf; // maps `members` accounts to votes with erc20 accounting
    mapping(address => bool) public banks; // maps contracts approved for `memberAction()` that burn or mint votes
    mapping(address => Member) public members; // maps `members` accounts to struct details
    mapping(uint256 => Proposal) public proposals; // maps proposal number to struct details
    
    event SubmitProposal(address indexed target, uint8 indexed flag, uint256 indexed proposal, uint256 value, bytes data, string details); // emits when `members` submit proposal 
    event SubmitVote(address indexed member, uint256 balance, uint256 indexed proposal, bool approve); // emits when `members` submit vote on proposal
    event ProcessProposal(uint256 indexed proposal); // emits when proposal is processed and executed
    event Transfer(address indexed from, address indexed to, uint256 amount); // emits when `members`' votes are minted or burned with erc20 accounting
    
    struct Member {
        bool exists; // tracks `members` account registration for `memberAction()` and `submitProposal()`
        mapping(uint256 => mapping(uint256 => bool)) voted; // maps votes on proposals by `members` account - gets votes cast and whether approved
    }
    
    struct Proposal {
        address target; // account that receives low-level call `data` and ETH `value` - if `membership` flag (2) or `removal` (3), account that will receive or lose `value` votes, respectively
        uint256 value; // ETH sent from Baal to execute approved proposal low-level call
        uint256 yesVotes; // counter for `members` 'yes' votes to calculate approval on processing
        uint256 noVotes; // counter for `members` 'no' votes to calculate approval on processing
        uint256 votingEnds; // termination date for proposal in seconds since epoch - derived from `votingPeriod`
        bytes data; // raw data sent to `target` account for low-level call
        bool[6] flags; // flags for proposal type and status - [action, governance, membership, removal, passed, processed] - 
        string details; // context for proposal - could be IPFS hash, plaintext, or JSON
    }
    
    /// @dev deploy Baal and create initial array of `members` accounts with specific voting weights
    /// @param _guildTokens erc20 tokens approved for internal accounting - `ragequit()` of votes
    /// @param _banks External contracts to approve for `memberAction()`
    /// @param summoners Accounts to add as `members`
    /// @param votes Voting weight per `members`
    /// @param _votingPeriod Voting period in seconds for `members` to cast votes on proposals
    /// @param _name Name for erc20 vote accounting
    /// @param _symbol Symbol for erc20 vote accounting
    constructor(address[] memory _guildTokens, address[] memory _banks, address[] memory summoners, uint256[] memory votes, uint256 _votingPeriod, string memory _name, string memory _symbol) {
        for (uint256 i = 0; i < summoners.length; i++) {
             guildTokens.push(_guildTokens[i]); // update array of `guildTokens` for `ragequit()`
             memberList.push(summoners[i]); // update array of `members`
             totalSupply += votes[i]; // total votes incremented by summoning with erc20 accounting
             balanceOf[summoners[i]] = votes[i]; // vote weights granted to summoning `members` with erc20 accounting
             banks[_banks[i]] = true; // update mapping of approved `banks`
             members[summoners[i]].exists = true; // record summoning `members `exists`
             emit Transfer(address(this), summoners[i], votes[i]); // event reflects mint of erc20 votes to summoning `members`
        }
        
        votingPeriod = _votingPeriod; // set general voting period - can be updated with 'governance' (1) proposal
        name = _name; // Baal 'name' with erc20 accounting
        symbol = _symbol; // Baal 'symbol' with erc20 accounting
    }
    
    /// @dev Execute `members`' action to mint or burn votes against external contract
    /// @param bank Account to call to trigger `members`' action - must be approved in `banks`
    /// @param amount Number of `members`' votes to submit in action
    /// @param mint Confirm whether transaction involves mint - if `false,` perform balance-based burn
    function memberAction(address bank, uint256 amount, bool mint) external payable nonReentrant {
        require(banks[bank], "!bank"); // check bank is approved
        require(members[msg.sender].exists, "!member"); // check membership
        
        if (mint) {
            uint256 minted = MemberAction(bank).memberMint{value: msg.value}(msg.sender); // mint from `bank` `msg.value` return based on member
            totalSupply += minted; // add to total `members`' votes with erc20 accounting
            balanceOf[msg.sender] += minted; // add votes to member account with erc20 accounting
            emit Transfer(address(this), msg.sender, minted); // event reflects mint of votes with erc20 accounting
        } else {    
            totalSupply -= amount; // subtract from total `members`' votes with erc20 accounting
            balanceOf[msg.sender] -= amount; // subtract votes from member account with erc20 accounting
            MemberAction(bank).memberBurn(msg.sender, amount); // burn `amount` againt `target` based on member
            emit Transfer(address(this), address(0), amount); // event reflects burn of votes with erc20 accounting
        }
    }
    
    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    /// @dev Submit proposal to Baal `members` for approval within voting period - proposer must be registered member
    /// @param target Account that receives low-level call `data` and ETH `value` - if `membership` flag (2), the account that will receive `value` votes - if `removal` (3), the account that will lose `value` votes
    /// @param value ETH sent from Baal to execute approved proposal low-level call
    /// @param data Raw data sent to `target` account for low-level call 
    /// @param details Context for proposal - could be IPFS hash, plaintext, or JSON
    function submitProposal(address target, uint8 flag, uint256 value, bytes calldata data, string calldata details) external nonReentrant returns (uint256 count) {
        require(members[msg.sender].exists, "!member"); // check membership
        require(flag <= 5, "!flag"); // check flag is not out of bounds
        proposalCount++; // increment proposals
        uint256 proposal = proposalCount; // set proposal number from count
        bool[6] memory flags; // stage flags - [governance, membership, removal, passed, processed]
        flags[flag] = true; // flag proposal type 
        proposals[proposal] = Proposal(target, value, 0, 0, block.timestamp + votingPeriod, data, flags, details); // push params into proposal struct - start vote timer
        emit SubmitProposal(target, flag, proposal, value, data, details);
        return proposal; // log proposal count
    }
    
    /// @dev Submit vote - proposal must exist and voting period must not have ended - non-member can cast `0` vote to signal
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on 
    /// @param approve If `true`, member will cast `yesVotes` onto proposal - if `false, `noVotes` will be counted
    function submitVote(uint256 proposal, bool approve) external nonReentrant {
        uint256 balance = balanceOf[msg.sender]; // gas-optimize variable
        require(proposal <= proposalCount, "!exist"); // check proposal exists
        require(proposals[proposal].votingEnds >= block.timestamp, "ended"); // check voting period has not ended
        if (approve) {proposals[proposal].yesVotes += balance;} // cast 'yes' votes per member balance to proposal
        else {proposals[proposal].noVotes += balance;} // cast 'no' votes per member balance to proposal
        members[msg.sender].voted[proposal][balance] = approve; // record vote to member struct per account
        emit SubmitVote(msg.sender, balance, proposal, approve);
    }
    
    // ********************
    // PROCESSING FUNCTIONS
    // ********************
    /// @dev Process 'action' proposal (0) and execute low-level call - proposal must be counted, unprocessed, and in voting period
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processActionProposal(uint256 proposal) external nonReentrant returns (bool success, bytes memory retData) {
        _validateProposalForProcessing(proposal); // validate basic processing requirements
        require(proposals[proposal].flags[0] && !proposals[proposal].flags[5], "!action or processed"); // check proposal type and whether already processed
        
        if (proposals[proposal].yesVotes > proposals[proposal].noVotes) { // check if proposal approved by simple majority of `members`
            proposals[proposal].flags[4] = true; // flag that vote passed
            (bool callSuccess, bytes memory returnData) = proposals[proposal].target.call{value: proposals[proposal].value}(proposals[proposal].data); // execute low-level call
            proposals[proposal].flags[5] = true; // flag that proposal processed
            emit ProcessProposal(proposal);
            return (callSuccess, returnData); // return proposal low-level call success status and data
        } else {
            proposals[proposal].flags[5] = true; // flag that proposal processed
            emit ProcessProposal(proposal);
        }
    }
    
    //// TO - DO add way to update guildTokens - maybe like, if there's data?
    /// @dev Process 'governance' proposal (1) - proposal must be counted, unprocessed, and in voting period
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processGovernanceProposal(uint256 proposal) external nonReentrant {
        _validateProposalForProcessing(proposal); // validate basic processing requirements
        require(proposals[proposal].flags[1] && !proposals[proposal].flags[5], "!governance or processed"); // check proposal type and whether already processed
        
        if (proposals[proposal].yesVotes > proposals[proposal].noVotes) { // check if proposal approved by simple majority of members
            proposals[proposal].flags[4] = true; // flag that vote passed
            if (proposals[proposal].value > 0) { // crib `value` to toggle between approving or removing bank
                banks[proposals[proposal].target] = true; // approve bank
                votingPeriod = proposals[proposal].value; // reset voting period - note: placed here as sanity check to avoid setting period to '0'
            } else {
                banks[proposals[proposal].target] = false; // remove bank
            }
        }
        
        proposals[proposal].flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
        
    }
    
    /// @dev Process 'membership' proposal (2) - proposal must be counted, unprocessed, and in voting period
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processMemberProposal(uint256 proposal) external nonReentrant {
        _validateProposalForProcessing(proposal); // validate basic processing requirements
        require(proposals[proposal].flags[2] && !proposals[proposal].flags[5], "!member or processed"); // check proposal type and whether already processed
          
        if (proposals[proposal].yesVotes > proposals[proposal].noVotes) { // check if proposal approved by simple majority of members
            proposals[proposal].flags[4] = true; // flag that vote passed
            address target = proposals[proposal].target; // gas-optimize variable
            uint256 value = proposals[proposal].value; // gas-optimize variable
            
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
    
    ///// TO - DO add ragequit stuff
    /// @dev Process 'removal' proposal (3) - proposal must be counted, unprocessed, and in voting period
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processRemovalProposal(uint256 proposal) external nonReentrant {
        _validateProposalForProcessing(proposal); // validate basic processing requirements
        require(proposals[proposal].flags[3] && !proposals[proposal].flags[5], "processed"); // check proposal type and whether already processed
        
        if (proposals[proposal].yesVotes > proposals[proposal].noVotes) { // check if proposal approved by simple majority of members
            uint256 value = proposals[proposal].value; // gas-optimize variable
            proposals[proposal].flags[4] = true; // flag that vote passed
            totalSupply -= value; // subtract `balance` from total member votes
            balanceOf[proposals[proposal].target] -= value; // subtract member votes
            emit Transfer(address(this), address(0), value); // event reflects burn of erc20 votes
        }
        
        proposals[proposal].flags[5] = true; // flag that proposal processed
        emit ProcessProposal(proposal);
    }
    
    /***************
    GETTER FUNCTIONS
    ***************/
    /// @dev Returns array list of approved guild tokens in Baal for member exits
    function getGuildTokens() external view returns (address[] memory tokens) {
        return guildTokens;
    }

    /// @dev Returns array list of member accounts in Baal
    function getMemberList() external view returns (address[] memory membership) {
        return memberList;
    }

    /// @dev Returns flags for proposal type and status in Baal
    function getProposalFlags(uint256 proposal) external view returns (bool[6] memory flags) {
        return proposals[proposal].flags;
    }
    
    /***************
    HELPER FUNCTIONS
    ***************/
    /// @dev Accept ETH into Baal
    receive() external payable {}
    
    /// TO-DO ?? would 'if()' wrap to proposal not being first (second require())..... work for check on previous process w/ less gas? currently uses mol v2 pattern
    /// @dev Private Baal function to validate basic processing requirements 
    function _validateProposalForProcessing(uint256 proposal) private view {
        require(proposal <= proposalCount, "!exist"); // check proposal exists
        require(proposal == 1 || !proposals[proposal - 1].flags[5], "previous !processed"); // check previous proposal has processed
        require(proposals[proposal].votingEnds <= block.timestamp, "!ended"); // check voting period has ended
    }
}
