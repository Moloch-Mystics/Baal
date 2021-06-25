// SPDX-License-Identifier: UNLICENSED
/*
███   ██   ██   █     
█  █  █ █  █ █  █     
█ ▀ ▄ █▄▄█ █▄▄█ █     
█  ▄▀ █  █ █  █ ███▄  
███      █    █     ▀ 
        █    █        
       ▀    ▀*/
pragma solidity 0.8.6;

/// @title Baal
/// @notice Maximalized minimalist guild contract inspired by Moloch DAO framework.
contract Baal {
  address[] guildTokens; /*array list of erc20 tokens approved on summoning or by whitelist[3] `proposals` for {ragequit} claims*/
  address[] memberList; /*array list of `members` summoned or added by membership[1] `proposals`*/
  uint256 public proposalCount; /*counter for total `proposals` submitted*/
  uint256 public totalLoot; /*counter for total loot economic weight held by accounts*/
  uint256 public totalSupply; /*counter for total `members` voting shares with erc20 accounting*/
  uint96 totalSharesAndLoot; /*internal counter for total 'loot' & 'shares' in Baal for {ragequit}*/
  uint32 public gracePeriod; /*time delay after proposal voting period for processing*/
  uint32 public minVotingPeriod; /*minimum period for voting in seconds - amendable through period[2] proposal*/
  uint32 public maxVotingPeriod; /*maximum period for voting in seconds - amendable through period[2] proposal*/
  bool public lootPaused; /*tracks transferability of loot economic weight - amendable through period[2] proposal*/
  bool public sharesPaused; /*tracks transferability of erc20 shares - amendable through period[2] proposal*/
  string public name; /*'name' for erc20 shares accounting*/
  string public symbol; /*'symbol' for erc20 shares accounting*/

  uint8 public constant decimals = 18; /*unit scaling factor in erc20 shares accounting - '18' is default to match ETH & common erc20s*/
  bytes32 public constant DOMAIN_TYPEHASH =
    keccak256(
      "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
    ); /*EIP-712 typehash for Baal domain*/
  bytes32 public constant DELEGATION_TYPEHASH =
    keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)"); /*EIP-712 typehash for delegation struct*/
  bytes32 public constant PERMIT_TYPEHASH =
    keccak256(
      "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    ); /*EIP-712 typehash for EIP-2612 {permit}*/

  mapping(address => mapping(address => uint256)) public allowance; /*maps approved pulls of shares with erc20 accounting*/
  mapping(address => uint256) public balanceOf; /*maps `members` accounts to shares with erc20 accounting*/
  mapping(address => mapping(uint32 => Checkpoint)) public checkpoints; /*maps record of vote checkpoints for each account by index*/
  mapping(address => uint32) public numCheckpoints; /*maps number of checkpoints for each account*/
  mapping(address => address) public delegates; /*maps record of each account's delegate*/
  mapping(address => bool) public minions; /*maps contracts approved in whitelist[3] proposals for {memberAction} that mints or burns shares*/
  mapping(address => Member) public members; /*maps `members` accounts to struct details*/
  mapping(address => uint256) public nonces; /*maps record of states for signing & validating signatures*/
  mapping(uint256 => Proposal) public proposals; /*maps `proposalCount` to struct details*/

  event SummonComplete(
    address[] minions,
    address[] guildTokens,
    address[] summoners,
    uint96[] loot,
    uint96[] shares,
    uint256 minVotingPeriod,
    uint256 maxVotingPeriod,
    string name,
    string symbol,
    bool transferableLoot,
    bool transferableShares
  ); /*emits after Baal summoning*/
  event SubmitProposal(
    bytes32 indexed id,
    address[] to,
    uint96[] value,
    uint32 votingPeriod,
    uint256 indexed proposal,
    uint8 indexed flag,
    bytes[] data,
    bytes32 details
  ); /*emits after proposal submitted*/
  event SubmitVote(
    address indexed member,
    uint256 balance,
    uint256 indexed proposal,
    uint8 indexed vote
  ); /*emits after vote submitted on proposal*/
  event ProcessProposal(uint256 indexed proposal); /*emits when proposal is processed & executed*/
  event Ragequit(
    address indexed memberAddress,
    address to,
    uint96 lootToBurn,
    uint96 sharesToBurn
  ); /*emits when callers burn Baal shares and/or loot for a given `to` account*/
  event Approval(
    address indexed owner,
    address indexed spender,
    uint256 amount
  ); /*emits when Baal shares are approved for pulls with erc20 accounting*/
  event Transfer(address indexed from, address indexed to, uint256 amount); /*emits when Baal shares are minted, burned or transferred with erc20 accounting*/
  event TransferLoot(address indexed from, address indexed to, uint256 amount); /*emits when Baal loot is transferred*/
  event DelegateChanged(
    address indexed delegator,
    address indexed fromDelegate,
    address indexed toDelegate
  ); /*emits when an account changes its delegate*/
  event DelegateVotesChanged(
    address indexed delegate,
    uint256 previousBalance,
    uint256 newBalance
  ); /*emits when a delegate account's vote balance changes*/

  /// @dev Reentrancy guard via OpenZeppelin.
  modifier nonReentrant() {
    require(status == 1, "reentrant");
    status = 2;
    _;
    status = 1;
  }
  uint256 status;
  /// @dev Voting & membership containers.
  enum Vote {
    Null,
    Yes,
    No
  }
  struct Checkpoint {
    /*checkpoint for marking number of votes from a given block*/
    uint32 fromBlock;
    uint96 votes;
  }
  struct Member {
    /*Baal membership details*/
    uint96 loot; /*amount of loot held by `members`-can be set on summoning & adjusted via {memberAction}*/
    uint32 highestIndexYesVote; /*highest proposal index # on which the member voted YES*/
    mapping(uint32 => Vote) voted;
  } /* maps vote decisions on proposals by `members` account*/
  struct Proposal {
    /*Baal proposal details*/
    bytes32 id; /* hash of datas */
    uint32 startBlock; /*start block for proposal*/
    uint32 votingEnds; /*termination date for proposal in seconds since unix epoch - derived from `votingPeriod`*/
    uint96 yesVotes; /*counter for `members` 'yes' votes to calculate approval on processing*/
    uint96 noVotes; /*counter for `members` 'no' votes to calculate approval on processing*/
    bool[3] flags; /*flags for proposal type & status - [action, membership, period, whitelist]*/
    bytes32 details;
  } /*context for proposal*/

  /// @notice Summon Baal & create initial array of `members` accounts with voting & loot weights.
  /// @param _minions External contracts approved for {memberAction}.
  /// @param _guildTokens Tokens approved for internal accounting-{ragequit} of shares and/or loot.
  /// @param summoners Accounts to add as `members`.
  /// @param loot Economic weight among `members`.
  /// @param shares Voting weight among `members` (shares also have economic weight).
  /// @param _minVotingPeriod Minimum voting period in seconds for `members` to cast votes on proposals.
  /// @param _maxVotingPeriod Maximum voting period in seconds for `members` to cast votes on proposals.
  /// @param _name Name for erc20 shares accounting.
  /// @param _symbol Symbol for erc20 shares accounting.
  constructor(
    address[] memory _minions,
    address[] memory _guildTokens,
    address[] memory summoners,
    uint96[] memory loot,
    uint96[] memory shares,
    uint32 _minVotingPeriod,
    uint32 _maxVotingPeriod,
    string memory _name,
    string memory _symbol,
    bool _lootPaused,
    bool _sharesPaused
  ) {
    uint96 initialTotalSharesAndLoot;
    unchecked {
      for (uint256 i; i < summoners.length; i++) {
        guildTokens.push(_guildTokens[i]); /*update array of `guildTokens` approved for {ragequit}*/
        memberList.push(summoners[i]); /*push summoners to `members` array*/
        balanceOf[summoners[i]] = shares[i]; /*add shares to summoning `members` account with erc20 accounting*/
        totalLoot += loot[i]; /*add to total Baal loot*/
        totalSupply += shares[i]; /*add to total Baal shares with erc20 accounting*/
        minions[_minions[i]] = true; /*update mapping of approved `minions` in Baal*/
        members[summoners[i]].loot = loot[i]; /*add loot to summoning `members` account*/
        initialTotalSharesAndLoot += (loot[i] + shares[i]); /*set reasonable limit for Baal loot & shares via uint96 max.*/
        _delegate(summoners[i], summoners[i]); /*delegate votes to summoning members by default*/
        emit Transfer(address(0), summoners[i], shares[i]);
      }
    } /*event reflects mint of erc20 shares to summoning `members`*/
    minVotingPeriod = _minVotingPeriod; /*set minimum voting period-adjustable via 'governance'[1] proposal*/
    maxVotingPeriod = _maxVotingPeriod; /*set maximum voting period-adjustable via 'governance'[1] proposal*/
    name = _name; /*set Baal 'name' with erc20 accounting*/
    symbol = _symbol; /*set Baal 'symbol' with erc20 accounting*/
    lootPaused = _lootPaused;
    sharesPaused = _sharesPaused;
    status = 1; /*set reentrancy guard status*/
    emit SummonComplete(
      _minions,
      _guildTokens,
      summoners,
      loot,
      shares,
      _minVotingPeriod,
      _maxVotingPeriod,
      _name,
      _symbol,
      _lootPaused,
      _sharesPaused
    );
  } /*emit event reflecting Baal summoning completed*/

  /// @notice Execute membership action to mint or burn shares or loot against whitelisted `minions` in consideration of `msg.sender` & given `amount`.
  /// @param minion Whitelisted contract to trigger action.
  /// @param loot Loot involved in external call.
  /// @param shares Shares involved in external call.
  /// @param mint Confirm whether action involves shares or loot request-if `false`, perform burn.
  /// @return lootReaction sharesReaction Loot and/or shares derived from action.
  function memberAction(
    address minion,
    uint256 loot,
    uint256 shares,
    bool mint
  )
    external
    payable
    nonReentrant
    returns (uint96 lootReaction, uint96 sharesReaction)
  {
    require(minions[address(minion)], "!extension"); /*check `extension` is approved*/
    if (mint) {
      (, bytes memory reactionData) = minion.call{ value: msg.value }(
        abi.encodeWithSelector(0xff4c9884, msg.sender, loot, shares)
      ); /*fetch 'reaction' mint per inputs*/
      (lootReaction, sharesReaction) = abi.decode(
        reactionData,
        (uint96, uint96)
      ); /*decode reactive data*/
      if (lootReaction != 0) {
        unchecked {
          members[msg.sender].loot += lootReaction;
          totalLoot += lootReaction;
        }
        totalSharesAndLoot += lootReaction;
      } /*add loot to `msg.sender` account & Baal totals*/
      if (sharesReaction != 0) {
        unchecked {
          balanceOf[msg.sender] += sharesReaction;
          _moveDelegates(address(0), msg.sender, sharesReaction);
          totalSupply += sharesReaction;
        }
        totalSharesAndLoot += sharesReaction;
      } /*add shares to `msg.sender` account & Baal total with erc20 accounting*/
      emit Transfer(address(0), msg.sender, sharesReaction); /*emit event reflecting mint of shares or loot with erc20 accounting*/
    } else {
      (, bytes memory reactionData) = minion.call{ value: msg.value }(
        abi.encodeWithSelector(0xff4c9884, msg.sender, loot, shares)
      ); /*fetch 'reaction' burn per inputs*/
      (lootReaction, sharesReaction) = abi.decode(
        reactionData,
        (uint96, uint96)
      ); /*decode reactive data*/
      if (lootReaction != 0) {
        unchecked {
          members[msg.sender].loot -= lootReaction;
          totalLoot -= lootReaction;
        }
        totalSharesAndLoot -= lootReaction;
      } /*subtract loot from `msg.sender` account & Baal totals*/
      if (sharesReaction != 0) {
        unchecked {
          balanceOf[msg.sender] -= sharesReaction;
          _moveDelegates(msg.sender, address(0), sharesReaction);
          totalSupply -= sharesReaction;
        }
        totalSharesAndLoot -= sharesReaction;
      } /*subtract shares from `msg.sender` account & Baal total with erc20 accounting*/
      emit Transfer(msg.sender, address(0), sharesReaction);
    }
  } /*emit event reflecting burn of shares or loot with erc20 accounting*/

  /*****************
    PROPOSAL FUNCTIONS
    *****************/
  /// @notice Submit proposal to Baal `members` for approval within voting period - proposer must be registered member.
  /// @param to Account that receives low-level call `data` & ETH `value` - if `membership`[2] flag, the account that will receive `value` shares - if `removal` (3), the account that will lose `value` shares.
  /// @param value ETH sent from Baal to execute approved proposal low-level call.
  /// @param data Raw data sent to `target` account for low-level call.
  /// @param details Context for proposal.
  /// @return proposal Count for submitted proposal.
  function submitProposal(
    address[] calldata to,
    uint96[] calldata value,
    uint32 votingPeriod,
    uint8 flag,
    bytes[] calldata data,
    bytes32 details
  ) external nonReentrant returns (uint256 proposal) {
    require(
      votingPeriod >= minVotingPeriod && votingPeriod <= maxVotingPeriod,
      "!votingPeriod"
    );
    require(
      to.length == value.length && value.length == data.length,
      "!arrays"
    );
    require(to.length <= 10, "array max"); /*limit executable actions to help avoid block gas limit errors on processing*/
    require(flag <= 5, "!flag"); /*check flag is in bounds*/
    bool[3] memory flags; /*plant flags - [action, governance, membership]*/
    bytes32 id = hashOperation(to, value, data);
    flags[flag] = true; /*flag proposal type for struct storage*/
    proposalCount++; /*increment total proposal counter*/
    unchecked {
      proposals[proposalCount] = Proposal(
        id,
        uint32(block.number),
        uint32(block.timestamp) + votingPeriod,
        0,
        0,
        flags,
        details
      );
    } /*push params into proposal struct - start voting period timer*/
    emit SubmitProposal(
      id,
      to,
      value,
      votingPeriod,
      proposal,
      flag,
      data,
      details
    );
  } /*emit event reflecting proposal submission*/

  /// @notice Submit vote-proposal must exist & voting period must not have ended-non-member can cast `0` vote to signal.
  /// @param proposal Number of proposal in `proposals` mapping to cast vote on.
  /// @param uintVote If '1', member will cast `yesVotes` onto proposal-if '2', `noVotes` will be counted.
  function submitVote(uint32 proposal, uint8 uintVote) external nonReentrant {
    Proposal storage prop = proposals[proposal]; /*alias proposal storage pointers*/
    Vote vote = Vote(uintVote); /*alias uintVote*/
    uint256 balance = getPriorVotes(msg.sender, prop.startBlock); /*gas-optimize variable*/
    require(prop.votingEnds >= block.timestamp, "ended"); /*check voting period has not ended*/
    require(members[msg.sender].voted[proposal] == Vote.Null, "voted"); /*check caller has not already voted*/
    if (vote == Vote.Yes) prop.yesVotes += uint96(balance);
    members[msg.sender].highestIndexYesVote = proposal; /*cast delegated balance 'yes' votes to proposal*/
    if (vote == Vote.No) prop.noVotes += uint96(balance); /*cast delegated balance 'no' votes to proposal*/
    members[msg.sender].voted[proposal] = vote; /*record vote to member struct per account*/
    emit SubmitVote(msg.sender, balance, proposal, uintVote);
  } /*emit event reflecting proposal vote submission*/

  // ********************
  // PROCESSING FUNCTIONS
  // ********************
  /// @notice Process 'proposal' & execute internal functions based on 'flag'[#].
  /// @param proposal Number of proposal in `proposals` mapping to process for execution.
  function processProposal(
    uint32 proposal,
    address[] calldata to,
    uint96[] calldata value,
    bytes[] calldata data
  ) external nonReentrant {
    Proposal storage prop = proposals[proposal]; /*alias `proposal` storage pointers*/
    bytes32 id = hashOperation(to, value, data);
    require(id == prop.id, "data does not match");
    _processingReady(proposal, prop); /*validate `proposal` processing requirements*/
    if (prop.yesVotes > prop.noVotes) {
      /*check if `proposal` approved by simple majority of members*/
      if (prop.flags[0]) {
        processActionProposal(to, value, data);
      }
      /*check 'flag', execute 'action'*/
      else if (prop.flags[1]) {
        processMemberProposal(to, value, data);
      }
      /*check 'flag', execute 'membership'*/
      else if (prop.flags[2]) {
        processPeriodProposal(value);
      }
      /*check 'flag', execute 'period'*/
      else {
        processWhitelistProposal(to, value, data);
      }
    } /*otherwise, execute 'whitelist'*/
    delete proposals[proposal]; /*delete given proposal struct details for gas refund & the commons*/
    emit ProcessProposal(proposal);
  } /*emit event reflecting proposal processed*/

  /// @notice Process 'action'[0] proposal.
  function processActionProposal(
    address[] calldata to,
    uint96[] calldata value,
    bytes[] calldata data
  ) private returns (bytes memory reactionData) {
    unchecked {
      for (uint256 i; i < to.length; i++) {
        {
          (, reactionData) = to[i].call{ value: value[i] }(data[i]);
        }
      }
    }
  } /*execute low-level call(s)*/

  /// @notice Process 'membership'[1] proposal.
  function processMemberProposal(
    address[] calldata to,
    uint96[] calldata value,
    bytes[] calldata data
  ) private {
    for (uint256 i; i < to.length; i++) {
      if (data.length == 0) {
        if (balanceOf[msg.sender] == 0) memberList.push(to[i]); /*update membership list if new*/
        unchecked {
          balanceOf[to[i]] += value[i]; /*add to `target` member votes*/
          _moveDelegates(address(0), to[i], value[i]);
          totalSupply += value[i];
        } /*add to total member votes*/
        totalSharesAndLoot += value[i]; /*add to Baal totals - uint96 max check included*/
        emit Transfer(address(0), to[i], value[i]); /*event reflects mint of erc20 votes*/
      } else {
        memberList[value[i]] = memberList[(memberList.length - 1)];
        memberList.pop(); /*swap & pop removed & last member listings*/
        uint256 removedBalance = balanceOf[to[i]]; /*gas-optimize variable*/
        _moveDelegates(address(0), to[i], uint96(removedBalance));
        unchecked {
          totalSupply -= removedBalance; /*subtract from total Baal shares with erc20 accounting*/
          totalLoot += removedBalance;
        } /*add to total Baal loot*/
        totalSharesAndLoot -= uint96(removedBalance); /*subtract from Baal totals*/
        balanceOf[to[i]] -= value[i]; /*subtract member votes*/
        members[to[i]].loot += uint96(removedBalance); /*add loot per removed share balance*/
        emit Transfer(to[i], address(0), value[i]);
      }
    }
  } /*event reflects burn of erc20 votes*/

  /// @notice Process 'period'[2] proposal.
  function processPeriodProposal(uint96[] calldata value) private {
    if (value[0] != 0) minVotingPeriod = uint32(value[0]);
    if (value[1] != 0) maxVotingPeriod = uint32(value[1]);
    if (value[2] != 0) gracePeriod = uint32(value[2]); /*if positive, reset voting periods to relative `value`s*/
    value[3] == 0 ? lootPaused = false : lootPaused = true;
    value[4] == 0 ? sharesPaused = false : sharesPaused = true;
  } /*if positive, pause loot &or shares transfers on fourth &or fifth `values`*/

  /// @notice Process 'whitelist'[3] proposal.
  function processWhitelistProposal(
    address[] calldata to,
    uint96[] calldata value,
    bytes[] calldata data
  ) private {
    unchecked {
      for (uint8 i; i < to.length; i++)
        if (value[i] == 0 && data.length == 0) {
          minions[to[i]] = true;
        }
        /*add account to 'minions' extensions*/
        else if (value[i] == 0 && data.length != 0) {
          minions[to[i]] = false;
        }
        /*remove account from 'minions' extensions*/
        else if (value[i] != 0 && data.length == 0) {
          guildTokens.push(to[i]);
        }
        /*push account to `guildTokens` array*/
        else {
          guildTokens[value[i]] = guildTokens[guildTokens.length - 1];
          guildTokens.pop();
        }
    }
  } /*pop account from `guildTokens` array after swapping last value*/

  /// @notice Process member 'ragequit'.
  /// @param lootToBurn Baal pure economic weight to burn to claim 'fair share' of `guildTokens`.
  /// @param sharesToBurn Baal voting weight to burn to claim 'fair share' of `guildTokens`.
  /// @return successes Logs transfer results of claimed `guildTokens` - because direct transfers, we want to skip & continue over failures.
  function ragequit(
    address to,
    uint96 lootToBurn,
    uint96 sharesToBurn
  ) external nonReentrant returns (bool[] memory successes) {
    require(
      members[msg.sender].highestIndexYesVote < proposalCount,
      "highestIndexYesVote!processed"
    ); /*highest index proposal member voted YES on must process first*/
    for (uint256 i; i < guildTokens.length; i++) {
      (, bytes memory balanceData) = guildTokens[i].staticcall(
        abi.encodeWithSelector(0x70a08231, address(this))
      ); /*get Baal token balances - 'balanceOf(address)'*/
      uint256 balance = abi.decode(balanceData, (uint256)); /*decode Baal token balances for calculation*/
      uint256 amountToRagequit = ((lootToBurn + sharesToBurn) * balance) /
        totalSupply; /*calculate fair shair claims*/
      if (amountToRagequit != 0) {
        /*gas optimization to allow higher maximum token limit*/
        (bool success, ) = guildTokens[i].call(
          abi.encodeWithSelector(0xa9059cbb, to, amountToRagequit)
        );
        successes[i] = success;
      }
    } /*execute token calls - 'transfer(address,uint)'*/
    if (lootToBurn != 0)
      /*gas optimization*/
      members[msg.sender].loot -= lootToBurn; /*subtract loot from caller account*/
    totalLoot -= lootToBurn; /*subtract from total Baal loot*/
    if (sharesToBurn != 0)
      /*gas optimization*/
      balanceOf[msg.sender] -= sharesToBurn; /*subtract shares from caller account with erc20 accounting*/
    _moveDelegates(msg.sender, address(0), sharesToBurn);
    totalSupply -= sharesToBurn; /*subtract from total Baal shares with erc20 accounting*/
    emit Ragequit(msg.sender, to, lootToBurn, sharesToBurn);
  } /*event reflects claims made against Baal*/

  /*******************
    GUILD ACCT FUNCTIONS
    *******************/
  /// @notice Approve `to` to transfer up to `amount`.
  /// @return Whether or not the approval succeeded.
  function approve(address to, uint256 amount) external returns (bool) {
    allowance[msg.sender][to] = amount;
    emit Approval(msg.sender, to, amount);
    return true;
  }

  /// @notice Delegate votes from `msg.sender` to `delegatee`.
  /// @param delegatee The address to delegate votes to.
  function delegate(address delegatee) external {
    _delegate(msg.sender, delegatee);
  }

  /// @notice Delegates votes from signatory to `delegatee`.
  /// @param delegatee The address to delegate votes to.
  /// @param nonce The contract state required to match the signature.
  /// @param expiry The time at which to expire the signature.
  /// @param v The recovery byte of the signature.
  /// @param r Half of the ECDSA signature pair.
  /// @param s Half of the ECDSA signature pair.
  function delegateBySig(
    address delegatee,
    uint256 nonce,
    uint256 expiry,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external {
    bytes32 domainSeparator = keccak256(
      abi.encode(
        DOMAIN_TYPEHASH,
        keccak256(bytes(name)),
        getChainId(),
        address(this)
      )
    );
    bytes32 structHash = keccak256(
      abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, expiry)
    );
    bytes32 digest = keccak256(
      abi.encodePacked("\x19\x01", domainSeparator, structHash)
    );
    address signatory = ecrecover(digest, v, r, s);
    require(signatory != address(0), "!signature");
    require(nonce == nonces[signatory]++, "!nonce");
    require(block.timestamp <= expiry, "expired");
    _delegate(signatory, delegatee);
  }

  /// @notice Triggers an approval from owner to spends.
  /// @param owner The address to approve from.
  /// @param spender The address to be approved.
  /// @param amount The number of tokens that are approved (2^256-1 means infinite).
  /// @param deadline The time at which to expire the signature.
  /// @param v The recovery byte of the signature.
  /// @param r Half of the ECDSA signature pair.
  /// @param s Half of the ECDSA signature pair.
  function permit(
    address owner,
    address spender,
    uint256 amount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external {
    bytes32 domainSeparator = keccak256(
      abi.encode(
        DOMAIN_TYPEHASH,
        keccak256(bytes(name)),
        getChainId(),
        address(this)
      )
    );
    unchecked {
      bytes32 structHash = keccak256(
        abi.encode(
          PERMIT_TYPEHASH,
          owner,
          spender,
          amount,
          nonces[owner]++,
          deadline
        )
      );
      bytes32 digest = keccak256(
        abi.encodePacked("\x19\x01", domainSeparator, structHash)
      );
      address signatory = ecrecover(digest, v, r, s);
      require(signatory != address(0), "!signature");
      require(signatory == owner, "!authorized");
    }
    require(block.timestamp <= deadline, "expired");
    allowance[owner][spender] = amount;
    emit Approval(owner, spender, amount);
  }

  /// @notice Transfer `amount` tokens from `msg.sender` to `to`.
  /// @param to The address of destination account.
  /// @param amount The number of tokens to transfer.
  /// @return Whether or not the transfer succeeded.
  function transfer(address to, uint256 amount) external returns (bool) {
    require(!sharesPaused, "!transferable");
    balanceOf[msg.sender] -= amount;
    _moveDelegates(msg.sender, to, uint96(amount));
    unchecked {
      balanceOf[to] += amount;
    }
    emit Transfer(msg.sender, to, amount);
    return true;
  }

  /// @notice Transfer `amount` loot from `msg.sender` to `to`.
  /// @param to The address of destination account.
  /// @param amount The number of loot units to transfer.
  function transferLoot(address to, uint96 amount) external {
    require(!lootPaused, "!transferable");
    members[msg.sender].loot -= amount;
    unchecked {
      members[to].loot += amount;
    }
    emit TransferLoot(msg.sender, to, amount);
  }

  /// @notice Transfer `amount` tokens from `src` to `dst`.
  /// @param from The address of the source account.
  /// @param to The address of the destination account.
  /// @param amount The number of tokens to transfer.
  /// @return Whether or not the transfer succeeded.
  function transferFrom(
    address from,
    address to,
    uint256 amount
  ) external returns (bool) {
    require(sharesPaused, "!transferable");
    if (allowance[from][msg.sender] != type(uint256).max)
      allowance[from][msg.sender] -= amount;
    balanceOf[from] -= amount;
    balanceOf[to] += amount;
    _moveDelegates(from, to, uint96(amount));
    emit Transfer(from, to, amount);
    return true;
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

  /// @notice Internal function to return chain identifier per ERC-155.
  function getChainId() private view returns (uint256 chainId) {
    assembly {
      chainId := chainid()
    }
  }

  /// @notice Gets the current votes balance for `account`.
  function getCurrentVotes(address account) external view returns (uint96) {
    uint32 nCheckpoints = numCheckpoints[account];
    return nCheckpoints > 0 ? checkpoints[account][nCheckpoints - 1].votes : 0;
  }

  /// @notice Determine the prior number of votes for `account` as of `blockNumber`.
  function getPriorVotes(address account, uint256 blockNumber)
    public
    view
    returns (uint96)
  {
    require(
      blockNumber < block.number,
      "Comp::getPriorVotes: not yet determined"
    );
    uint32 nCheckpoints = numCheckpoints[account];
    if (nCheckpoints == 0) {
      return 0;
    }
    if (checkpoints[account][nCheckpoints - 1].fromBlock <= blockNumber) {
      return checkpoints[account][nCheckpoints - 1].votes;
    }
    if (checkpoints[account][0].fromBlock > blockNumber) {
      return 0;
    }
    uint32 lower = 0;
    uint32 upper = nCheckpoints - 1;
    while (upper > lower) {
      uint32 center = upper - (upper - lower) / 2;
      Checkpoint memory cp = checkpoints[account][center];
      if (cp.fromBlock == blockNumber) {
        return cp.votes;
      } else if (cp.fromBlock < blockNumber) {
        lower = center;
      } else {
        upper = center - 1;
      }
    }
    return checkpoints[account][lower].votes;
  }

  /// @notice Returns 'flags' for given Baal `proposal` describing type ('action'[0], 'membership'[1], 'period'[2], 'whitelist'[3]).
  function getProposalFlags(uint256 proposal)
    external
    view
    returns (bool[3] memory flags)
  {
    flags = proposals[proposal].flags;
  }

  /// @notice Returns <uint8> 'vote' by a given `account` on Baal `proposal`.
  function getProposalVotes(address account, uint32 proposal)
    external
    view
    returns (Vote vote)
  {
    vote = members[account].voted[proposal];
  }

  /***************
    HELPER FUNCTIONS
    ***************/
  /// @notice Deposits ETH sent to Baal.
  receive() external payable {}

  function _delegate(address delegator, address delegatee) private {
    address currentDelegate = delegates[delegator];
    delegates[delegator] = delegatee;
    emit DelegateChanged(delegator, currentDelegate, delegatee);
    _moveDelegates(currentDelegate, delegatee, uint96(balanceOf[delegator]));
  }

  function _moveDelegates(
    address srcRep,
    address dstRep,
    uint96 amount
  ) private {
    if (srcRep != dstRep && amount > 0) {
      if (srcRep != address(0)) {
        uint32 srcRepNum = numCheckpoints[srcRep];
        uint96 srcRepOld = srcRepNum > 0
          ? checkpoints[srcRep][srcRepNum - 1].votes
          : 0;
        uint96 srcRepNew = srcRepOld - amount;
        _writeCheckpoint(srcRep, srcRepNum, srcRepOld, srcRepNew);
      }
      if (dstRep != address(0)) {
        uint32 dstRepNum = numCheckpoints[dstRep];
        uint96 dstRepOld = dstRepNum > 0
          ? checkpoints[dstRep][dstRepNum - 1].votes
          : 0;
        uint96 dstRepNew = dstRepOld + amount;
        _writeCheckpoint(dstRep, dstRepNum, dstRepOld, dstRepNew);
      }
    }
  }

  function _writeCheckpoint(
    address delegatee,
    uint32 nCheckpoints,
    uint96 oldVotes,
    uint96 newVotes
  ) private {
    uint32 blockNumber = uint32(block.number);
    if (
      nCheckpoints > 0 &&
      checkpoints[delegatee][nCheckpoints - 1].fromBlock == blockNumber
    ) {
      checkpoints[delegatee][nCheckpoints - 1].votes = newVotes;
    } else {
      checkpoints[delegatee][nCheckpoints] = Checkpoint(blockNumber, newVotes);
      numCheckpoints[delegatee] = nCheckpoints + 1;
    }
    emit DelegateVotesChanged(delegatee, oldVotes, newVotes);
  }

  /// @notice Internal checks to validate basic proposal processing requirements.
  function _processingReady(uint32 proposal, Proposal memory prop)
    private
    view
    returns (bool ready)
  {
    require(proposal <= proposalCount, "!exist"); /*check proposal exists*/
    unchecked {
      require(prop.votingEnds + gracePeriod <= block.timestamp, "!ended"); /*check voting period has ended*/
      require(proposals[proposal - 1].votingEnds == 0, "prev!processed");
    } /*check previous proposal has processed by deletion*/
    require(!prop.flags[2], "processed"); /*check given proposal has not yet processed*/
    if (memberList.length == 1) {
      ready = true;
    }
    /*if single membership, process early*/
    else if (prop.yesVotes > totalSupply / 2) {
      ready = true;
    }
    /* process early if majority member support*/
    else if (prop.votingEnds >= block.timestamp) {
      ready = true;
    }
  } /*otherwise, process if voting period done*/

  // helper to hash ACE data
  function hashOperation(
    address[] calldata targets,
    uint96[] calldata values,
    bytes[] calldata datas
  ) public pure virtual returns (bytes32 hash) {
    return keccak256(abi.encode(targets, values, datas));
  }
}
