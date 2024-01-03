// SPDX-License-Identifier: MIT
/*
███   ██   ██   █
█  █  █ █  █ █  █
█ ▀ ▄ █▄▄█ █▄▄█ █
█  ▄▀ █  █ █  █ ███▄
███      █    █     ▀
        █    █
       ▀    ▀*/
pragma solidity ^0.8.7;

import "@gnosis.pm/safe-contracts/contracts/base/Executor.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/zodiac/contracts/core/Module.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@opengsn/contracts/src/BaseRelayRecipient.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./interfaces/IBaalToken.sol";

/// @title Baal ';_;'.
/// @notice Flexible guild contract inspired by Moloch DAO framework.
contract Baal is Module, EIP712Upgradeable, ReentrancyGuardUpgradeable, BaseRelayRecipient {
    using ECDSAUpgradeable for bytes32;

    // ERC20 SHARES + LOOT

    IBaalToken public lootToken; /*Sub ERC20 for loot mgmt*/
    IBaalToken public sharesToken; /*Sub ERC20 for loot mgmt*/

    address private constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE; /*ETH reference for redemptions*/

    // GOVERNANCE PARAMS
    uint32 public votingPeriod; /* voting period in seconds - amendable through 'period'[2] proposal*/
    uint32 public gracePeriod; /*time delay after proposal voting period for processing*/
    uint32 public proposalCount; /*counter for total `proposals` submitted*/
    uint256 public proposalOffering; /* non-member proposal offering*/
    uint256 public quorumPercent; /* minimum % of shares that must vote yes for it to pass*/
    uint256 public sponsorThreshold; /* minimum number of shares to sponsor a proposal (not %)*/
    uint256 public minRetentionPercent; /* auto-fails a proposal if more than (1- minRetentionPercent) * total shares exit before processing*/

    // SHAMAN PERMISSIONS
    bool public adminLock; /* once set to true, no new admin roles can be assigned to shaman */
    bool public managerLock; /* once set to true, no new manager roles can be assigned to shaman */
    bool public governorLock; /* once set to true, no new governor roles can be assigned to shaman */
    mapping(address => uint256) public shamans; /*maps shaman addresses to their permission level*/
    /* permissions registry for shamans
    0 = no permission
    1 = admin only
    2 = manager only
    4 = governance only
    3 = admin + manager
    5 = admin + governance
    6 = manager + governance
    7 = admin + manager + governance */

    // PROPOSAL TRACKING
    mapping(address => mapping(uint32 => bool)) public memberVoted; /*maps members to their proposal votes (true = voted) */
    mapping(address => uint256) public votingNonces; /*maps members to their voting nonce*/
    mapping(uint256 => Proposal) public proposals; /*maps `proposal id` to struct details*/

    // MISCELLANEOUS PARAMS
    uint32 public latestSponsoredProposalId; /* the id of the last proposal to be sponsored */
    address public multisendLibrary; /*address of multisend library*/
    string public override versionRecipient; /* version recipient for OpenGSN */

    // SIGNATURE HELPERS
    bytes32 constant VOTE_TYPEHASH = keccak256("Vote(string name,address voter,uint256 expiry,uint256 nonce,uint32 proposalId,bool support)");

    // DATA STRUCTURES
    struct Proposal {
        /*Baal proposal details*/
        uint32 id; /*id of this proposal, used in existence checks (increments from 1)*/
        uint32 prevProposalId; /* id of the previous proposal - set at sponsorship from latestSponsoredProposalId */
        uint32 votingStarts; /*starting time for proposal in seconds since unix epoch*/
        uint32 votingEnds; /*termination date for proposal in seconds since unix epoch - derived from `votingPeriod` set on proposal*/
        uint32 graceEnds; /*termination date for proposal in seconds since unix epoch - derived from `gracePeriod` set on proposal*/
        uint32 expiration; /*timestamp after which proposal should be considered invalid and skipped. */
        uint256 baalGas; /* gas needed to process proposal */
        uint256 yesVotes; /*counter for `members` `approved` 'votes' to calculate approval on processing*/
        uint256 noVotes; /*counter for `members` 'dis-approved' 'votes' to calculate approval on processing*/
        uint256 maxTotalSharesAndLootAtVote; /* highest share+loot count during any individual yes vote*/
        uint256 maxTotalSharesAtSponsor; /* highest share+loot count during any individual yes vote*/
        bool[4] status; /* [cancelled, processed, passed, actionFailed] */
        address sponsor; /* address of the sponsor - set at sponsor proposal - relevant for cancellation */
        bytes32 proposalDataHash; /*hash of raw data associated with state updates*/
    }

    /* Unborn -> Submitted -> Voting -> Grace -> Ready -> Processed
                              \-> Cancelled  \-> Defeated   */
    enum ProposalState {
        Unborn, /* 0 - can submit */
        Submitted, /* 1 - can sponsor -> voting */
        Voting, /* 2 - can be cancelled, otherwise proceeds to grace */
        Cancelled, /* 3 - terminal state, counts as processed */
        Grace, /* 4 - proceeds to ready/defeated */
        Ready, /* 5 - can be processed */
        Processed, /* 6 - terminal state */
        Defeated /* 7 - terminal state, yes votes <= no votes, counts as processed */
    }

    // MODIFIERS

    modifier baalOnly() {
        require(_msgSender() == avatar, "!baal");
        _;
    }

    modifier baalOrAdminOnly() {
        require(_msgSender() == avatar || isAdmin(_msgSender()), "!baal & !admin"); /*check `shaman` is admin*/
        _;
    }

    modifier baalOrManagerOnly() {
        require(
            _msgSender() == avatar || isManager(_msgSender()),
            "!baal & !manager"
        ); /*check `shaman` is manager*/
        _;
    }

    modifier baalOrGovernorOnly() {
        require(
            _msgSender() == avatar || isGovernor(_msgSender()),
            "!baal & !governor"
        ); /*check `shaman` is governor*/
        _;
    }

    // EVENTS
    event SetupComplete(
        bool lootPaused,
        bool sharesPaused,
        uint32 gracePeriod,
        uint32 votingPeriod,
        uint256 proposalOffering,
        uint256 quorumPercent,
        uint256 sponsorThreshold,
        uint256 minRetentionPercent,
        string name,
        string symbol,
        uint256 totalShares,
        uint256 totalLoot
    ); /*emits after Baal summoning*/
    event SubmitProposal(
        uint256 indexed proposal,
        bytes32 indexed proposalDataHash,
        uint256 votingPeriod,
        bytes proposalData,
        uint256 expiration,
        uint256 baalGas,
        bool selfSponsor,
        uint256 timestamp,
        string details
    ); /*emits after proposal is submitted*/
    event SponsorProposal(
        address indexed member,
        uint256 indexed proposal,
        uint256 indexed votingStarts
    ); /*emits after member has sponsored proposal*/
    event CancelProposal(uint256 indexed proposal); /*emits when proposal is cancelled*/
    event SubmitVote(
        address indexed member,
        uint256 balance,
        uint256 indexed proposal,
        bool indexed approved
    ); /*emits after vote is submitted on proposal*/
    event ProcessProposal(
        uint256 indexed proposal,
        bool passed,
        bool actionFailed
    ); /*emits when proposal is processed & executed*/
    event Ragequit(
        address indexed member,
        address to,
        uint256 indexed lootToBurn,
        uint256 indexed sharesToBurn,
        address[] tokens
    ); /*emits when users burn Baal `shares` and/or `loot` for given `to` account*/
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 amount
    ); /*emits when Baal `shares` are approved for pulls with erc20 accounting*/

    event ShamanSet(address indexed shaman, uint256 permission); /*emits when a shaman permission changes*/
    event SetTrustedForwarder(address indexed forwarder); /*emits when a trusted forwarder changes*/
    event GovernanceConfigSet(
        uint32 voting,
        uint32 grace,
        uint256 newOffering,
        uint256 quorum,
        uint256 sponsor,
        uint256 minRetention
    ); /*emits when gov config changes*/
    event SharesPaused(bool paused); /*emits when shares are paused or unpaused*/
    event LootPaused(bool paused); /*emits when loot is paused or unpaused*/
    event LockAdmin(bool adminLock); /*emits when admin is locked*/
    event LockManager(bool managerLock); /*emits when admin is locked*/
    event LockGovernor(bool governorLock); /*emits when admin is locked*/

    function encodeMultisend(bytes[] memory _calls, address _target)
        external
        pure
        returns (bytes memory encodedMultisend)
    {
        bytes memory encodedActions;
        for (uint256 i = 0; i < _calls.length; i++) {
            encodedActions = abi.encodePacked(
                encodedActions,
                uint8(0),
                _target,
                uint256(0),
                uint256(_calls[i].length),
                bytes(_calls[i])
            );
        }
        encodedMultisend = abi.encodeWithSignature(
            "multiSend(bytes)",
            encodedActions
        );
    }

    constructor() {
        _disableInitializers();
    }

    /// @notice Summon Baal with voting configuration & initial array of `members` accounts with `shares` & `loot` weights.
    /// @param _initializationParams Encoded setup information.
    function setUp(bytes memory _initializationParams)
        public
        override(FactoryFriendly)
        initializer
        nonReentrant
    {
        (
            address _lootToken, /*loot ERC20 token*/
            address _sharesToken, /*shares ERC20 token*/
            address _multisendLibrary, /*address of multisend library*/
            address _avatar, /*Safe contract address*/
            address _forwarder, /*Trusted forwarder address for meta-transactions (EIP 2771)*/
            bytes memory _initializationMultisendData /*here you call BaalOnly functions to set up initial shares, loot, shamans, periods, etc.*/
        ) = abi.decode(
                _initializationParams,
                (address, address, address, address, address, bytes)
            );

        require(
                _multisendLibrary != address(0) &&
                _avatar != address(0),
            "0 addr used"
        );
        // no need to check _forwarder address exists, the default is address(0) for no forwarder

        versionRecipient = "2.2.5+opengsn.payablewithbaal.irelayrecipient";
        __Ownable_init();
        __ReentrancyGuard_init();
        __EIP712_init("Vote", "4");
        transferOwnership(_avatar);

        // Set the Gnosis safe address
        avatar = _avatar;
        target = _avatar; /*Set target to same address as avatar on setup - can be changed later via setTarget, though probably not a good idea*/

        // Set trusted forwarder
        _setTrustedForwarder(_forwarder);

        lootToken = IBaalToken(_lootToken);
        sharesToken = IBaalToken(_sharesToken);

        /*Set address of Gnosis multisend library to use for all execution*/
        multisendLibrary = _multisendLibrary;

        // Execute all setups including but not limited to
        // * mint shares
        // * convert shares to loot
        // * set shamans
        // * set admin configurations
        require(
            exec(
                multisendLibrary,
                0,
                _initializationMultisendData,
                Enum.Operation.DelegateCall
            ),
            "call failure setup"
        );

        emit SetupComplete(
            lootToken.paused(),
            sharesToken.paused(),
            gracePeriod,
            votingPeriod,
            proposalOffering,
            quorumPercent,
            sponsorThreshold,
            minRetentionPercent,
            sharesToken.name(),
            sharesToken.symbol(),
            totalShares(),
            totalLoot()
        );

    }

    /*****************
    PROPOSAL FUNCTIONS
    *****************/
    /// @notice Submit proposal to Baal `members` for approval within given voting period.
    /// @param proposalData Multisend encoded transactions or proposal data
    /// @param details Context for proposal.
    /// @return proposal Count for submitted proposal.
    function submitProposal(
        bytes calldata proposalData,
        uint32 expiration,
        uint256 baalGas,
        string calldata details
    ) external payable nonReentrant returns (uint256) {
        require(
            expiration == 0 ||
                expiration > block.timestamp + votingPeriod + gracePeriod,
            "expired"
        );
        require(baalGas <= 20000000, "baalGas to high"); /* gwei 2/3 eth block limit */

        bool selfSponsor = false; /*plant sponsor flag*/
        if (sharesToken.getVotes(_msgSender()) >= sponsorThreshold ) {
            selfSponsor = true; /*if above sponsor threshold, self-sponsor*/
        } else {
            require(msg.value == proposalOffering, "Baal requires an offering"); /*Optional anti-spam gas token tribute*/
            (bool _success, ) = target.call{value: msg.value}(""); /*Send ETH to sink*/
            require(_success, "could not send");
        }

        bytes32 proposalDataHash = hashOperation(proposalData); /*Store only hash of proposal data*/

        proposalCount++; /*increment proposal counter*/
        proposals[proposalCount] = Proposal( /*push params into proposal struct - start voting period timer if member submission*/
            proposalCount,
            selfSponsor ? latestSponsoredProposalId : 0, /* prevProposalId */
            selfSponsor ? uint32(block.timestamp) : 0, /* votingStarts */
            selfSponsor ? uint32(block.timestamp) + votingPeriod : 0, /* votingEnds */
            selfSponsor
                ? uint32(block.timestamp) + votingPeriod + gracePeriod
                : 0, /* graceEnds */
            expiration,
            baalGas,
            0, /* yes votes */
            0, /* no votes */
            selfSponsor ? totalSupply() : 0, /* maxTotalSharesAndLootAtVote */
            selfSponsor ? totalShares() : 0, /* maxTotalSharesAtSponsor */
            [false, false, false, false], /* [cancelled, processed, passed, actionFailed] */
            selfSponsor ? _msgSender() : address(0),
            proposalDataHash
        );

        if (selfSponsor) {
            latestSponsoredProposalId = proposalCount;
        }

        emit SubmitProposal(
            proposalCount,
            proposalDataHash,
            votingPeriod,
            proposalData,
            expiration,
            baalGas,
            selfSponsor,
            block.timestamp,
            details
        ); /*emit event reflecting proposal submission*/

        return proposalCount;
    }

    /// @notice Sponsor proposal to Baal `members` for approval within voting period.
    /// @param id Number of proposal in `proposals` mapping to sponsor.
    function sponsorProposal(uint32 id) external nonReentrant {
        Proposal storage prop = proposals[id]; /*alias proposal storage pointers*/

        require(sharesToken.getVotes(_msgSender()) >= sponsorThreshold, "!sponsor"); /*check 'votes > threshold - required to sponsor proposal*/
        require(state(id) == ProposalState.Submitted, "!submitted");
        require(
            prop.expiration == 0 ||
                prop.expiration > block.timestamp + votingPeriod + gracePeriod,
            "expired"
        );

        prop.votingStarts = uint32(block.timestamp);

        unchecked {
            prop.votingEnds = uint32(block.timestamp) + votingPeriod;
            prop.graceEnds =
                uint32(block.timestamp) +
                votingPeriod +
                gracePeriod;
        }

        prop.prevProposalId = latestSponsoredProposalId;
        prop.sponsor = _msgSender();
        // snapshot both total supply and total shares
        prop.maxTotalSharesAndLootAtVote = totalSupply(); // updaed in votes for min retention
        prop.maxTotalSharesAtSponsor = totalShares(); // for yes vote quorum
        latestSponsoredProposalId = id;

        emit SponsorProposal(_msgSender(), id, block.timestamp);
    }

    /// @notice Submit vote - proposal must exist & voting period must not have ended.
    /// @param id Number of proposal in `proposals` mapping to cast vote on.
    /// @param approved If 'true', member will cast `yesVotes` onto proposal - if 'false', `noVotes` will be counted.
    function submitVote(uint32 id, bool approved) external nonReentrant {
        _submitVote(_msgSender(), id, approved);
    }

    /// @notice Submit vote with EIP-712 signature - proposal must exist & voting period must not have ended.
    /// @param voter Address of member who submitted vote.
    /// @param expiry Expiration of signature.
    /// @param id Number of proposal in `proposals` mapping to cast vote on.
    /// @param approved If 'true', member will cast `yesVotes` onto proposal - if 'false', `noVotes` will be counted.
    /// @param v v in signature
    /// @param r r in signature
    /// @param s s in signature
    function submitVoteWithSig(
        address voter,
        uint256 expiry,
        uint256 nonce,
        uint32 id,
        bool approved,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        require(block.timestamp <= expiry, "ERC20Votes: signature expired");
        require(nonce == votingNonces[voter], "!nonce");

        /*calculate EIP-712 struct hash*/
        bytes32 structHash = keccak256(
            abi.encode(
                VOTE_TYPEHASH,
                keccak256(abi.encodePacked(sharesToken.name())),
                voter,
                expiry,
                nonce,
                id,
                approved
            )
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSAUpgradeable.recover(hash, v, r, s);

        require(signer == voter, "invalid signature");
        require(signer != address(0), "!signer");
        votingNonces[voter] += 1;

        _submitVote(signer, id, approved);
    }

    /// @notice Execute vote submission internally - callable by submit vote or submit vote with signature
    /// @param voter Address of voter
    /// @param id Number of proposal in `proposals` mapping to cast vote on.
    /// @param approved If 'true', member will cast `yesVotes` onto proposal - if 'false', `noVotes` will be counted.
    function _submitVote(
        address voter,
        uint32 id,
        bool approved
    ) internal {
        Proposal storage prop = proposals[id]; /*alias proposal storage pointers*/
        require(state(id) == ProposalState.Voting, "!voting");

        uint256 balance = sharesToken.getPastVotes(voter, prop.votingStarts); /*fetch & gas-optimize voting weight at proposal creation time*/

        require(balance > 0, "!member"); /* check that user has shares*/
        require(!memberVoted[voter][id], "voted"); /*check vote not already cast*/

        memberVoted[voter][id] = true; /*record voting action to `members` struct per user account*/

        // get high water mark on all votes
        uint256 _totalSupply = totalSupply();
        if (_totalSupply > prop.maxTotalSharesAndLootAtVote) {
            prop.maxTotalSharesAndLootAtVote = _totalSupply;
        }

        unchecked {
            if (approved) {
                /*if `approved`, cast delegated balance `yesVotes` to proposal*/
                prop.yesVotes += balance;    
            } else {
                /*otherwise, cast delegated balance `noVotes` to proposal*/
                prop.noVotes += balance;
            }
        }

        emit SubmitVote(voter, balance, id, approved); /*emit event reflecting vote*/
    }

    /// @notice Process `proposal` & execute internal functions.
    /// @dev Proposal must have succeeded, not been processed, not expired, retention threshold must be met
    /// @param id Number of proposal in `proposals` mapping to process for execution.
    /// @param proposalData Packed multisend data to execute via Gnosis multisend library
    function processProposal(uint32 id, bytes calldata proposalData)
        external
        nonReentrant
    {
        Proposal storage prop = proposals[id]; /*alias `proposal` storage pointers*/

        require(prop.sponsor != address(0), "!sponsor"); /*check proposal has been sponsored*/
        require(state(id) == ProposalState.Ready, "!ready"); /* check proposal is Ready to process */

        ProposalState prevProposalState = state(prop.prevProposalId);
        require(
            prevProposalState == ProposalState.Processed ||
                prevProposalState == ProposalState.Cancelled ||
                prevProposalState == ProposalState.Defeated ||
                prevProposalState == ProposalState.Unborn,
            "prev!processed"
        );

        // check that the proposalData matches the stored hash
        require(
            hashOperation(proposalData) == prop.proposalDataHash,
            "incorrect calldata"
        );

        require(
            prop.baalGas == 0 || gasleft() >= prop.baalGas,
            "not enough gas"
        );

        prop.status[1] = true; /*Set processed flag to true*/
        bool okToExecute = true; /*Initialize and invalidate if conditions are not met below*/

        // Make proposal fail if after expiration
        if (prop.expiration != 0 && prop.expiration < block.timestamp)
            okToExecute = false;

        // Make proposal fail if it didn't pass quorum
        if (okToExecute && prop.yesVotes * 100 < quorumPercent * prop.maxTotalSharesAtSponsor)
            okToExecute = false;

        // Make proposal fail if the minRetentionPercent is exceeded
        if (
            okToExecute &&
            (totalSupply()) <
            (prop.maxTotalSharesAndLootAtVote * minRetentionPercent) / 100 /*Check for dilution since high water mark during voting*/
        ) {
            okToExecute = false;
        }

        /*check if `proposal` approved by simple majority of members*/
        if (okToExecute) {
            prop.status[2] = true; /*flag that proposal passed - allows baal-like extensions*/
            bool success = processActionProposal(proposalData); /*execute 'action'*/
            if (!success) {
                prop.status[3] = true;
            }
        }

        emit ProcessProposal(id, prop.status[2], prop.status[3]); /*emit event reflecting that given proposal processed*/
    }

    /// @notice Internal function to process 'action'[0] proposal.
    /// @param proposalData Packed multisend data to execute via Gnosis multisend library
    /// @return success Success or failure of execution
    function processActionProposal(bytes memory proposalData)
        private
        returns (bool success)
    {
        success = exec(
            multisendLibrary,
            0,
            proposalData,
            Enum.Operation.DelegateCall
        );
    }

    /// @notice Cancel proposal prior to execution
    /// @dev Cancellable if proposal is during voting, sender is sponsor, governor, or if sponsor has fallen below threshold
    /// @param id Number of proposal in `proposals` mapping to process for execution.
    function cancelProposal(uint32 id) external nonReentrant {
        Proposal storage prop = proposals[id];
        require(state(id) == ProposalState.Voting, "!voting");
        require(
            _msgSender() == prop.sponsor ||
                sharesToken.getPastVotes(prop.sponsor, block.timestamp - 1) <
                sponsorThreshold ||
                isGovernor(_msgSender()),
            "!cancellable"
        );
        prop.status[0] = true;
        emit CancelProposal(id);
    }

    /// @dev Function to Execute arbitrary code as baal - useful if funds are accidentally sent here
    /// @notice Can only be called by the avatar which means this can only be called if passed by another
    ///     proposal or by a delegated signer on the Safe
    /// @param _to address to call
    /// @param _value value to include in wei
    /// @param _data arbitrary transaction data
    function executeAsBaal(
        address _to,
        uint256 _value,
        bytes calldata _data
    ) external baalOnly {
        (bool success, ) = _to.call{value: _value}(_data);
        require(success, "call failure execute");
    }

    // ****************
    // MEMBER FUNCTIONS
    // ****************

    /// @notice Process member burn of `shares` and/or `loot` to claim 'fair share' of specified `tokens`
    /// @param to Account that receives 'fair share'.
    /// @param lootToBurn Baal pure economic weight to burn.
    /// @param sharesToBurn Baal voting weight to burn.
    /// @param tokens Array of tokens to include in rage quit calculation
    function ragequit(
        address to,
        uint256 sharesToBurn,
        uint256 lootToBurn,
        address[] calldata tokens
    ) external nonReentrant {
        for (uint256 i = 1; i < tokens.length; i++) {
                require(tokens[i] > tokens[i - 1], "!order");
        }

        _ragequit(to, sharesToBurn, lootToBurn, tokens);
    }

    /// @notice Internal execution of rage quite
    /// @param to Account that receives 'fair share'.
    /// @param lootToBurn Baal pure economic weight to burn.
    /// @param sharesToBurn Baal voting weight to burn.
    /// @param tokens Array of tokens to include in rage quit calculation
    function _ragequit(
        address to,
        uint256 sharesToBurn,
        uint256 lootToBurn,
        address[] memory tokens
    ) internal {
        uint256 _totalSupply = totalSupply();

        if (lootToBurn != 0) {
            /*gas optimization*/
            _burnLoot(_msgSender(), lootToBurn); /*subtract `loot` from user account & Baal totals*/
        }

        if (sharesToBurn != 0) {
            /*gas optimization*/
            _burnShares(_msgSender(), sharesToBurn); /*subtract `shares` from user account & Baal totals with erc20 accounting*/
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 balance;
            if(tokens[i] == ETH) {
                balance = address(target).balance;
            } else {
                (, bytes memory balanceData) = tokens[i].staticcall(
                    abi.encodeWithSelector(0x70a08231, address(target))
                ); /*get Baal token balances - 'balanceOf(address)'*/
                balance = abi.decode(balanceData, (uint256));
            }

            uint256 amountToRagequit = ((lootToBurn + sharesToBurn) * balance) /
                _totalSupply; /*calculate 'fair shair' claims*/

            if (amountToRagequit != 0) {
                /*gas optimization to allow higher maximum token limit*/
                tokens[i] == ETH
                    ? _safeTransferETH(to, amountToRagequit) /*execute 'safe' ETH transfer*/
                    : _safeTransfer(tokens[i], to, amountToRagequit); /*execute 'safe' token transfer*/
            }
        }

        emit Ragequit(_msgSender(), to, lootToBurn, sharesToBurn, tokens); /*event reflects claims made against Baal*/
    }

    /*******************
    GUILD MGMT FUNCTIONS
    *******************/
    /// @notice Baal-only function to set shaman status.
    /// @param _shamans Addresses of shaman contracts
    /// @param _permissions Permission level of each shaman in _shamans
    function setShamans(
        address[] calldata _shamans,
        uint256[] calldata _permissions
    ) external baalOnly {
        require(_shamans.length == _permissions.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < _shamans.length; i++) {
            uint256 permission = _permissions[i];
            if (adminLock)
                require(
                    permission != 1 &&
                        permission != 3 &&
                        permission != 5 &&
                        permission != 7,
                    "admin lock"
                );
            if (managerLock)
                require(
                    permission != 2 &&
                        permission != 3 &&
                        permission != 6 &&
                        permission != 7,
                    "manager lock"
                );
            if (governorLock)
                require(
                    permission != 4 &&
                        permission != 5 &&
                        permission != 6 &&
                        permission != 7,
                    "governor lock"
                );
            shamans[_shamans[i]] = permission;
            emit ShamanSet(_shamans[i], permission);
        }
    }

    /// @notice Lock admin so setShamans cannot be called with admin changes
    function lockAdmin() external baalOnly {
        adminLock = true;

        emit LockAdmin(adminLock);
    }

    /// @notice Lock manager so setShamans cannot be called with manager changes
    function lockManager() external baalOnly {
        managerLock = true;

        emit LockManager(managerLock);
    }

    /// @notice Lock governor so setShamans cannot be called with governor changes
    function lockGovernor() external baalOnly {
        governorLock = true;

        emit LockGovernor(governorLock);
    }

    // ****************
    // SHAMAN FUNCTIONS
    // ****************
    /// @notice Baal-or-admin-only function to set admin config (pause/unpause shares/loot) and call function on token
    /// @param pauseShares Turn share transfers on or off
    /// @param pauseLoot Turn loot transfers on or off
    function setAdminConfig(bool pauseShares, bool pauseLoot)
        external
        baalOrAdminOnly
    {

        if(pauseShares && !sharesToken.paused()){
            sharesToken.pause();
            emit SharesPaused(true);
        } else if(!pauseShares && sharesToken.paused()){
            sharesToken.unpause();
            emit SharesPaused(false);
        }

        if(pauseLoot && !lootToken.paused()){
            lootToken.pause();
            emit LootPaused(true);
        } else if(!pauseLoot && lootToken.paused()){
            lootToken.unpause();
            emit LootPaused(false);
        }
    }

    /// @notice Baal-or-manager-only function to mint shares.
    /// @param to Array of addresses to receive shares
    /// @param amount Array of amounts to mint
    function mintShares(address[] calldata to, uint256[] calldata amount)
        external
        baalOrManagerOnly
    {
        require(to.length == amount.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < to.length; i++) {
            _mintShares(to[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Minting function for Baal `shares`.
    /// @param to Address to receive shares
    /// @param shares Amount to mint
    function _mintShares(address to, uint256 shares) private {
        sharesToken.mint(to, shares);
    }

    /// @notice Baal-or-manager-only function to burn shares.
    /// @param from Array of addresses to lose shares
    /// @param amount Array of amounts to burn
    function burnShares(address[] calldata from, uint256[] calldata amount)
        external
        baalOrManagerOnly
    {
        require(from.length == amount.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < from.length; i++) {
            _burnShares(from[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Burn function for Baal `shares`.
    /// @param from Address to lose shares
    /// @param shares Amount to burn
    function _burnShares(address from, uint256 shares) private {
        sharesToken.burn(from, shares);
    }

    /// @notice Baal-or-manager-only function to mint loot.
    /// @param to Array of addresses to mint loot
    /// @param amount Array of amounts to mint
    function mintLoot(address[] calldata to, uint256[] calldata amount)
        external
        baalOrManagerOnly
    {
        require(to.length == amount.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < to.length; i++) {
            _mintLoot(to[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Minting function for Baal `loot`.
    /// @param to Address to mint loot
    /// @param loot Amount to mint
    function _mintLoot(address to, uint256 loot) private {
        lootToken.mint(to, loot);
    }

    /// @notice Baal-or-manager-only function to burn loot.
    /// @param from Array of addresses to lose loot
    /// @param amount Array of amounts to burn
    function burnLoot(address[] calldata from, uint256[] calldata amount)
        external
        baalOrManagerOnly
    {
        require(from.length == amount.length, "!array parity"); /*check array lengths match*/
        for (uint256 i = 0; i < from.length; i++) {
            _burnLoot(from[i], amount[i]); /*grant `to` `amount` `shares`*/
        }
    }

    /// @notice Burn function for Baal `loot`.
    /// @param from Address to lose loot
    /// @param loot Amount to burn
    function _burnLoot(address from, uint256 loot) private {
        lootToken.burn(from, loot);
    }

    /// @notice Baal-or-governance-only function to change periods.
    /// @param _governanceConfig Encoded configuration parameters voting, grace period, tribute, quorum, sponsor threshold, retention bound
    function setGovernanceConfig(bytes memory _governanceConfig)
        external
        baalOrGovernorOnly
    {
        (
            uint32 voting,
            uint32 grace,
            uint256 newOffering,
            uint256 quorum,
            uint256 sponsor,
            uint256 minRetention
        ) = abi.decode(
                _governanceConfig,
                (uint32, uint32, uint256, uint256, uint256, uint256)
            );
        require(quorum >= 0 && minRetention <= 100, 'bad quorum');
        require(minRetention >= 0 && minRetention <= 100, 'bad minRetention');

        // on initialization of governance config, there is no shares token
        // skip this check on initialization of governance config.
        if (sponsorThreshold > 0 && address(sharesToken) != address(0)) {
            require(sponsor <= totalShares(), 'sponsor > sharesSupply');
        }

        if (voting != 0) votingPeriod = voting; /*if positive, reset min. voting periods to first `value`*/
        if (grace != 0) gracePeriod = grace; /*if positive, reset grace period to second `value`*/
        proposalOffering = newOffering; /*set new proposal offering amount */
        quorumPercent = quorum;
        sponsorThreshold = sponsor;
        minRetentionPercent = minRetention;

        emit GovernanceConfigSet(
            voting,
            grace,
            newOffering,
            quorum,
            sponsor,
            minRetention
        );
    }

    /// @notice Baal-or-governance only function to set trusted forwarder for meta-transactions.
    /// @param _trustedForwarderAddress Trusted forwarder's address
    function setTrustedForwarder(address _trustedForwarderAddress)
        external
        baalOrGovernorOnly
    {
        _setTrustedForwarder(_trustedForwarderAddress);
        emit SetTrustedForwarder(_trustedForwarderAddress);
    }

    /***************
    GETTER FUNCTIONS
    ***************/
    /// @notice State helper to determine proposal state
    /// @param id Number of proposal in proposals
    /// @return Unborn -> Submitted -> Voting -> Grace -> Ready -> Processed
    ///         \-> Cancelled  \-> Defeated
    function state(uint32 id) public view returns (ProposalState) {
        Proposal memory prop = proposals[id];
        if (prop.id == 0) {
            /*Uninitialized state*/
            return ProposalState.Unborn;
        } else if (
            prop.status[0] /* cancelled */
        ) {
            return ProposalState.Cancelled;
        } else if (
            prop.votingStarts == 0 /*Voting has not started*/
        ) {
            return ProposalState.Submitted;
        } else if (
            block.timestamp <= prop.votingEnds /*Voting in progress*/
        ) {
            return ProposalState.Voting;
        } else if (
            block.timestamp <= prop.graceEnds /*Proposal in grace period*/
        ) {
            return ProposalState.Grace;
        } else if (
            prop.noVotes >= prop.yesVotes /*Voting has concluded and failed to pass*/
        ) {
            return ProposalState.Defeated;
        } else if (
            prop.status[1] /* processed */
        ) {
            return ProposalState.Processed;
        }
        /* Proposal is ready to be processed*/
        else {
            return ProposalState.Ready;
        }
    }

    /// @notice Helper to get recorded proposal flags
    /// @param id Number of proposal in proposals
    /// @return [cancelled, processed, passed, actionFailed]
    function getProposalStatus(uint32 id)
        external
        view
        returns (bool[4] memory)
    {
        return proposals[id].status;
    }

    /// @notice Helper to check if shaman permission contains admin capabilities
    /// @param shaman Address attempting to execute admin permissioned functions
    function isAdmin(address shaman) public view returns (bool) {
        uint256 permission = shamans[shaman];
        return (permission == 1 ||
            permission == 3 ||
            permission == 5 ||
            permission == 7);
    }

    /// @notice Helper to check if shaman permission contains manager capabilities
    /// @param shaman Address attempting to execute manager permissioned functions
    function isManager(address shaman) public view returns (bool) {
        uint256 permission = shamans[shaman];
        return (permission == 2 ||
            permission == 3 ||
            permission == 6 ||
            permission == 7);
    }

    /// @notice Helper to check if shaman permission contains governor capabilities
    /// @param shaman Address attempting to execute governor permissioned functions
    function isGovernor(address shaman) public view returns (bool) {
        uint256 permission = shamans[shaman];
        return (permission == 4 ||
            permission == 5 ||
            permission == 6 ||
            permission == 7);
    }

    /// @notice Helper to check total supply of child loot contract
    function totalLoot() public view returns (uint256) {
        return lootToken.totalSupply();
    }

    /// @notice Helper to check total supply of child shares contract
    function totalShares() public view returns (uint256) {
        return sharesToken.totalSupply();
    }

    /// @notice Helper to check total supply of loot and shares
    function totalSupply() public view returns (uint256) {
        return totalLoot() + totalShares();
    }

    /***************
    HELPER FUNCTIONS
    ***************/
    /// @notice Returns the keccak256 hash of calldata
    function hashOperation(bytes memory _transactions)
        public
        pure
        virtual
        returns (bytes32 hash)
    {
        return keccak256(abi.encode(_transactions));
    }

    /// @notice Provides 'safe' {transfer} for ETH.
    function _safeTransferETH(address to, uint256 amount) internal {
        // transfer eth from target
        (bool success, ) = execAndReturnData(
            to,
            amount,
            "",
            Enum.Operation.Call
        );

        require(success, "ETH_TRANSFER_FAILED");
    }

    /// @notice Provides 'safe' {transfer} for tokens that do not consistently return 'true/false'.
    function _safeTransfer(
        address token,
        address to,
        uint256 amount
    ) private {
        (bool success, bytes memory data) = execAndReturnData(
            token,
            0,
            abi.encodeWithSelector(0xa9059cbb, to, amount),
            Enum.Operation.Call
        ); /*'transfer(address,uint)'*/
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "transfer failed"
        ); /*checks success & allows non-conforming transfers*/
    }

    /// @notice Provides access to message sender of a meta transaction (EIP-2771)
    function _msgSender() internal view override(ContextUpgradeable, BaseRelayRecipient)
        returns (address sender) {
        sender = BaseRelayRecipient._msgSender();
    }

    /// @notice Provides access to message data of a meta transaction (EIP-2771)
    function _msgData() internal view override(ContextUpgradeable, BaseRelayRecipient)
        returns (bytes calldata) {
        return BaseRelayRecipient._msgData();
    }
}
