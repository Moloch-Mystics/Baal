// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.0;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);

    function approve(address spender, uint256 value) external returns (bool);

    function transferFrom(address from, address to, uint256 value) external returns (bool);

    function totalSupply() external view returns (uint256);

    function balanceOf(address who) external view returns (uint256);

    function allowance(address owner, address spender) external view returns (uint256);

    event Transfer(address indexed from, address indexed to, uint256 value);

    event Approval(address indexed owner, address indexed spender, uint256 value);
}


interface MemberAction {
    function memberBurn(address member, uint256 votes) external; // vote-weighted member burn - e.g., "ragequit" to claim capital
    function memberMint(address member, uint256 amount) external; // amount-weighted member vote mint - e.g., submit direct "tribute" for votes
}

contract ReentrancyGuard { // call wrapper for reentrancy check - see https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/ReentrancyGuard.sol
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

contract Baal is ReentrancyGuard {
    address[] public memberList; // array of member accounts summoned or added by proposal
    address[] public contactList; // array of contacts
    address[] public ragequitTokens; // array of whitelisted tokens that can be ragequit  
    uint256 public proposalCount; // counter for proposals submitted 
    uint256 public totalSupply; // counter for member votes minted - erc20 compatible
    uint256 public minVotingPeriod; // min period proposal voting in epoch time
    uint256 public maxVotingPeriod; // max period for proposal voting in epoch time
    uint8 constant public decimals = 18; // decimals for erc20 vote accounting - 18 is default for ETH
    string public name; // name for erc20 vote accounting
    string public symbol; // symbol for erc20 vote accounting
    
    mapping(address => uint256) public balanceOf; // mapping member accounts to votes
    mapping(address => bool) public contractList; // mapping contract approved for member calls 
    mapping(address => bool) public contacts; // mapping of approved addresses for proposals
    mapping(address => mapping(uint256 => bool)) public voted; // mapping proposal number to whether member voted 
    mapping(address => uint256) public highestIndexYesVote; // mapping most recent number where member voted yes 
    mapping(uint256 => Proposal) public proposals; // mapping proposal number to struct details
    
    event SubmitProposal(address indexed proposer, address indexed target, uint256 proposal, uint256 value, bytes data, uint256 flag, string details); // emits when member submits proposal 
    event SubmitVote(address indexed member, uint256 proposal, bool approve); // emits when member submits vote on proposal
    event ProcessProposal(uint256 proposal); // emits when proposal is processed and finalized
    event Receive(address indexed sender, uint256 value); // emits when ether (ETH) is received
    event Transfer(address indexed from, address indexed to, uint256 amount); // emits when member votes are minted or burned
    event ProcessMemberProposal(address indexed from, address indexed to, uint256 amount, uint256 proposal);
    event ProcessMemberKick(address indexed from, address indexed to, uint256 amount, uint256 proposal);
    event SummonComplete(address[] indexed summoners, address[] indexed ragequitTokens, uint256[] votes, uint256 minVotingPeriod, uint256 maxVotingPeriod, string name, string symbol);
    event Ragequit(address quitter, uint256 sharesToBurn);
    event CancelProposal(uint256 proposalNum, address proposer);

    
    struct Proposal {
        address proposer; // account that submits proposal;
        address target; // account that receives low-level call `data` and ETH `value` - if `membership` is `true` and data `length` is 0, the account that will receive `value` votes - otherwise, the account that will lose votes
        uint256 value; // ETH sent from Baal to execute approved proposal low-level call - if `membership` is `true` and data `length` is 0, reflects `votes` to grant member
        uint256 noVotes; // counter for member no votes to calculate approval on processing
        uint256 yesVotes; // counter for member yes votes to calculate approval on processing
        uint256 votingEnds; // termination date for proposal in seconds since epoch - derived from votingPeriod
        bytes data; // raw data sent to `target` account for low-level call
        bool[8] flags; // [0 cancelled, 1 processed, 2 didPass, 3 action call, 4 add member, 5 kick member, 6 whitelist contact, 7 whitelist token]
        string details; // context for proposal - could be IPFS hash, plaintext, or JSON
    }
    
    /// @dev deploy Baal and create initial array of member accounts with specific vote weights
    /// @param summoners Accounts to add as members
    /// @param votes Voting weight per member
    /// @param _minVotingPeriod Min Voting period in seconds for members to cast votes on proposals
    /// @param _minVotingPeriod Max Voting period in seconds for members to cast votes on proposals
    /// @param _name Name for erc20 vote accounting
    /// @param _symbol Symbol for erc20 vote accounting
    constructor(address[] memory summoners, address[] memory tokens, uint256[] memory votes, uint256 _minVotingPeriod, uint256 _maxVotingPeriod, string memory _name, string memory _symbol) {
        for (uint256 i = 0; i < summoners.length; i++) {
             totalSupply += votes[i]; // total votes incremented by summoning
             minVotingPeriod = _minVotingPeriod; 
             maxVotingPeriod = _maxVotingPeriod; 
             name = _name;
             symbol = _symbol;
             balanceOf[summoners[i]] = votes[i]; // vote weights granted to member
             memberList.push(summoners[i]); // update list of member accounts
        }
        
        for (uint256 i = 0; i < tokens.length; i++){
            ragequitTokens.push(tokens[i]);
        }
        
        emit SummonComplete(summoners, tokens, votes, _minVotingPeriod, _maxVotingPeriod, _name, _symbol);
    }
    
    /// @dev Submit proposal for member approval within voting period
    /// @param target Account that receives low-level call `data` and ETH `value` - if `membership`, the account that will receive `value` votes - if `removal`, the account that will lose votes
    /// @param value ETH sent from Baal to execute approved proposal low-level call - if `membership`, reflects `votes` to grant member
    /// @param data Raw data sent to `target` account for low-level call 
    /// @param flag notes proposal type
    /// @param details Context for proposal - could be IPFS hash, plaintext, or JSON
    function submitProposal(address target, uint256 value, uint256 votingLength, bytes calldata data, uint256 flag, string calldata details) external nonReentrant returns (uint256 count) {
        require(balanceOf[msg.sender] > 0 || contacts[msg.sender] == true, "Baal:: Must be a member or contact");
        require(votingLength >= minVotingPeriod && votingLength <= maxVotingPeriod, "Baal:: Voting period too long or short");
        require(flag != 0 && flag != 1 && flag != 2, "Baal:: invalid flag");
        
        proposalCount++;
        uint256 proposal = proposalCount;
        bool[8] memory flags; 
        flags[flag] = true;
        
        proposals[proposal] = Proposal(msg.sender, target, value, 0, 0, block.timestamp + votingLength, data, flags, details); // push params into proposal struct - start timer
        
        emit SubmitProposal(msg.sender, target, proposal, value, data, flag, details);
        return proposal;
    }
    
    /// @dev Submit vote - caller must have uncast votes - proposal must exist, be unprocessed, and voting period cannot be finished
    /// @param proposal Number of proposal in `proposals` mapping to cast vote on 
    /// @param approve If `true`, member will cast `yesVotes` onto proposal - if `false, `noVotes` will be cast
    function submitVote(uint256 proposal, bool approve) external nonReentrant returns (uint256 count) {
        Proposal storage prop = proposals[proposal];
        
        require(proposal <= proposalCount, "Baal::!exist");
        require(prop.votingEnds >= block.timestamp, "Baal:: voting finished");
        require(!prop.flags[0] && !prop.flags[1], "Baal:: processed or cancelled");
        require(balanceOf[msg.sender] > 0, "Baal:: !votes");
        require(!voted[msg.sender][proposal], "Baal:: voted");
        
        if (approve) {prop.yesVotes += balanceOf[msg.sender];} // cast yes votes
        else {prop.noVotes += balanceOf[msg.sender];} // cast no votes
        voted[msg.sender][proposal] = true; // reflect member voted
        highestIndexYesVote[msg.sender] = proposal;
        
        emit SubmitVote(msg.sender, proposal, approve);
        return proposal;
    }
    
    /// @dev Process proposal and execute low-level call or membership management - proposal must exist, be unprocessed, and voting period must be finished
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processProposal(uint256 proposal) external nonReentrant returns (bool success, bytes memory retData) {
        Proposal storage prop = proposals[proposal];

        require(processingReady(proposal), "Baal:: !ready for processing");
        require(!prop.flags[0] && !prop.flags[1], "Baal:: cancelled or processed");
      
        bool _didPass = didPass(proposal);
        if (_didPass){
            (bool callSuccess, bytes memory returnData) = proposals[proposal].target.call{value: proposals[proposal].value}(proposals[proposal].data); // execute low-level call
            require(callSuccess, "Baal:: action failed");
            return (callSuccess, returnData); // return call success and data
        }
        
        prop.flags[1] = true; // reflect proposal processed
        emit ProcessProposal(proposal);
    }
    
    
    /// @dev Process proposal for membership management - proposal must exist, be unprocessed, and voting period must be finished
    /// @param proposal Number of proposal in `proposals` mapping to process for execution
    function processMemberProposal(uint256 proposal) external nonReentrant returns (uint256 shares) {
        Proposal storage prop = proposals[proposal];
        require(processingReady(proposal), "Baal:: !ready for processing");
        require(prop.flags[4], "Baal:: !membership proposal");
        
        bool _didPass = didPass(proposal);
        if (_didPass) { // check if proposal approved by members
            address target = proposals[proposal].target;
            uint256 value = proposals[proposal].value;
                
            if(balanceOf[target] == 0) {memberList.push(target);} // update list of member accounts if new
                
            totalSupply += value; // add to total member votes
            balanceOf[target] += value; // add to member votes
            
            return(value);
        }
        
        prop.flags[1] = true; // reflect proposal processed
        emit ProcessMemberProposal(address(this), proposals[proposal].target, proposals[proposal].value, proposal); // event reflects mint of erc20 votes
    }
    
    function processMemberKick(uint256 proposal) external nonReentrant returns (bool success) {
        Proposal storage prop = proposals[proposal];
        
        require(processingReady(proposal), "Baal:: !ready for processing");
        require(prop.flags[5], "Baal:: !membership kick proposal");

        bool _didPass = didPass(proposal);

        if (_didPass) {
            address target = proposals[proposal].target;
            uint256 balance = balanceOf[target];
                
            _ragequit(target, balance);
                
            return(true);
        }
        
        prop.flags[1] = true; // reflect proposal processed
        emit ProcessMemberKick(address(this), proposals[proposal].target, proposals[proposal].value, proposal); // event reflects mint of erc20 votes
    }
    
    function processWhitelist(uint256 proposal) external nonReentrant returns (bool success) {
        Proposal storage prop = proposals[proposal];
        
        require(processingReady(proposal), "Baal:: !ready for processing");
        require(prop.flags[6] || prop.flags[7], "Baal:: !contact");

        bool _didPass = didPass(proposal);

        if (_didPass) {
            
            if (prop.flags[6]){
            address target = prop.target;
            contacts[target] = true;
            contactList.push(target);
            } 
            
            if(prop.flags[7]){
            address target = prop.target;
            ragequitTokens.push(target);
            }
            
            return(true);
        }
        
        prop.flags[1] = true; // reflect proposal processed
        emit ProcessMemberKick(address(this), proposals[proposal].target, proposals[proposal].value, proposal); // event reflects mint of erc20 votes
    }
    
    function ragequit(uint256 sharesToBurn) external nonReentrant {
        require(balanceOf[msg.sender] > 0, "Baal:: no shares to burn");
        _ragequit(msg.sender, sharesToBurn);
    }
    
    function _ragequit(address memberAddress, uint256 sharesToBurn) internal {
        require(balanceOf[memberAddress] >= sharesToBurn, "Baal::insufficient shares");
        require(proposals[highestIndexYesVote[memberAddress]].flags[1], "Baal::cannot ragequit until highest index proposal member voted YES on is processed");
        uint256 initialTS = totalSupply;
        totalSupply -= sharesToBurn; // add to total member votes
        balanceOf[memberAddress] -= sharesToBurn; // add to member votes

        for (uint256 i = 0; i < ragequitTokens.length; i++) {
            uint256 amountToRagequit = fairShare(IERC20(ragequitTokens[i]).balanceOf(address(this)), sharesToBurn, initialTS);
            if (amountToRagequit > 0) { // gas optimization to allow a higher maximum token limit
                // deliberately not using safemath here to keep overflows from preventing the function execution (which would break ragekicks)
                // if a token overflows, it is because the supply was artificially inflated to oblivion, so we probably don't care about it anyways
                IERC20(ragequitTokens[i]).transfer(memberAddress, amountToRagequit);
            }
        }

        emit Ragequit(msg.sender, sharesToBurn);
    }
    
    /// @dev Execute member action against external contract - caller must have votes
    /// @param target Account to call to trigger component transaction
    /// @param amount Number of member votes to involve in transaction
    /// @param mint Confirm whether transaction involves mint - if `false,` then perform balance-based burn
    function memberAction(address target, uint256 amount, bool mint) external nonReentrant {
        require(balanceOf[msg.sender] > 0, "Baal:: !active");
        require(contractList[target], "Baal:: !listed");  
        if (mint) {
            MemberAction(target).memberMint(msg.sender, amount);
            totalSupply += amount; // add to total member votes
            balanceOf[msg.sender] += amount; // add to member votes
            emit Transfer(address(this), msg.sender, amount); // event reflects mint of erc20 votes
        } else {    
            MemberAction(target).memberBurn(msg.sender, amount);
            totalSupply -= amount; // subtract from total member votes
            balanceOf[msg.sender] -= amount; // subtract member votes
            emit Transfer(address(this), address(0), amount); // event reflects burn of erc20 votes
        }
    }
    
     /// @dev Checks if proposal passed
    function didPass(uint256 proposal) internal returns (bool) {
        Proposal storage prop = proposals[proposal];
        require(prop.yesVotes > prop.noVotes, "Baal::proposal failed");
        prop.flags[3] = true;
        return true;
    }
    
    /// @dev Checks if proposal is ready to be processed (allows for possible early execution)
    function processingReady(uint256 proposal) internal view returns (bool) {
        require(proposal <= proposalCount, "Baal::!exist");
        require(!proposals[proposal].flags[1], "Baal:: already processed");
        require(proposalCount == 1 || proposals[proposalCount-1].flags[1], "previous proposal must be processed");
        
        uint256 halfShares = totalSupply / 2;
        
        if(proposals[proposal].votingEnds >= block.timestamp){ // voting period done
            return true;
        } else if(proposals[proposal].yesVotes > halfShares ) { // early execution b/c of 50%+
            return true;
        } else {
            return false; //not ready
        }
    }
    
    function cancelProposal(uint256 proposal) external nonReentrant {
        Proposal storage prop = proposals[proposal];
        require(!prop.flags[0], "proposal has already been cancelled");
        require(!prop.flags[1], "proposal has already been processed");
        require(msg.sender == prop.proposer, "solely the proposer can cancel");

        prop.flags[0] = true; // cancelled
        
        emit CancelProposal(proposal, msg.sender);
    }
    
    /// @dev Return array list of member accounts in Baal
    function getMembers() external view returns (address[] memory membership) {
        return memberList;
    }
    
        /// @dev Return array list of member accounts in Baal
    function getContacts() external view returns (address[] memory allContacts) {
        return contactList;
    }
    
    function getProposalFlags(uint256 proposal) public view returns (bool[8] memory) {
        return proposals[proposal].flags;
    }
    
    function fairShare(uint256 balance, uint256 shares, uint256 totalSupply) internal pure returns (uint256) {
        require(totalSupply != 0);

        if (balance == 0) { return 0; }

        uint256 prod = balance * shares;

        if (prod / balance == shares) { // no overflow in multiplication above?
            return prod / totalSupply;
        }

        return (balance / totalSupply) * shares;
    }
    
    /// @dev fallback to collect received ether into Baal
    receive() external payable {emit Receive(msg.sender, msg.value);}
}
