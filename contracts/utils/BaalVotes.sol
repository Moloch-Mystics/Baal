// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.13;
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

/**
 * @dev similar to Openzeplin ERC20Votes
 * 
 * uses timestamp instead of block.number and auto self delegates.
 *
 * This extension keeps a history (checkpoints) of each account's vote power. Vote power can be delegated either
 * by calling the {delegate} function directly, or by providing a signature to be used with {delegateBySig}. Voting
 * power can be queried through the public accessors  {getPriorVotes}.
 *
 */
abstract contract BaalVotes is ERC20Permit {
    using ECDSA for bytes32;

    struct Checkpoint {
        /*Baal checkpoint for marking number of delegated votes*/
        uint32 fromTimeStamp; /*unix time for referencing voting balance*/
        uint256 votes; /*votes at given unix time*/
    }

    // DELEGATE TRACKING
    mapping(address => mapping(uint256 => Checkpoint)) public checkpoints; /*maps record of vote `checkpoints` for each account by index*/
    mapping(address => uint256) public numCheckpoints; /*maps number of `checkpoints` for each account*/
    mapping(address => address) public delegates; /*maps record of each account's `shares` delegate*/

    // SIGNATURE HELPERS
    mapping(address => uint256) public _nonces; /*maps record of states for signing & validating signatures*/
    bytes32 constant DELEGATION_TYPEHASH =
        keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");
    bytes32 constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
        );

    event DelegateChanged(
        address indexed delegator,
        address indexed fromDelegate,
        address indexed toDelegate
    ); /*emits when an account changes its voting delegate*/
    event DelegateVotesChanged(
        address indexed delegate,
        uint256 previousBalance,
        uint256 newBalance
    ); /*emits when a delegate account's voting balance changes*/

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);

        /*If recipient is receiving their first shares, auto-self delegate*/
        if (balanceOf(to) == 0 && numCheckpoints[to] == 0 && amount > 0) {
            delegates[to] = to;
        }

        _moveDelegates(delegates[from], delegates[to], amount);
    }

    /// @notice Delegate votes from user to `delegatee`.
    /// @param delegatee The address to delegate votes to.
    function delegate(address delegatee) public virtual {
        _delegate(msg.sender, delegatee);
    }

    /// @notice Delegates votes from `signatory` to `delegatee` with EIP-712 signature.
    /// @param delegatee The address to delegate 'votes' to.
    /// @param nonce The contract state required to match the signature.
    /// @param deadline The time at which to expire the signature.
    /// @param signature The concatenated signature
    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) public virtual {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(name())),
                // keccak256(bytes(name)),
                block.chainid,
                address(this)
            )
        ); /*calculate EIP-712 domain hash*/
        bytes32 structHash = keccak256(
            abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, deadline)
        ); /*calculate EIP-712 struct hash*/
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        ); /*calculate EIP-712 digest for signature*/
        address signatory = digest.recover(signature); /*recover signer from hash data*/

        require(signatory != address(0), "!signatory"); /*check signer is not null*/
        unchecked {
            require(nonce == _nonces[signatory]++, "!nonce"); /*check given `nonce` is next in `nonces`*/
        }

        require(deadline == 0 || deadline < block.timestamp, "expired");

        _delegate(signatory, delegatee); /*execute delegation*/
    }

    /// @notice Delegates Baal voting weight.
    /// @param delegator The address to delegate 'votes' from.
    /// @param delegatee The address to delegate 'votes' to.
    function _delegate(address delegator, address delegatee) internal virtual {
        require(balanceOf(delegator) > 0, "!shares");
        address currentDelegate = delegates[delegator];
        delegates[delegator] = delegatee;

        _moveDelegates(
            currentDelegate,
            delegatee,
            uint256(balanceOf(delegator))
        );

        emit DelegateChanged(delegator, currentDelegate, delegatee);
    }

    /// @notice Elaborates delegate update - cf., 'Compound Governance'.
    /// @param srcRep The address to delegate 'votes' from.
    /// @param dstRep The address to delegate 'votes' to.
    /// @param amount The amount of votes to delegate
    function _moveDelegates(
        address srcRep,
        address dstRep,
        uint256 amount
    ) private {
        unchecked {
            if (srcRep != dstRep && amount != 0) {
                if (srcRep != address(0)) {
                    uint256 srcRepNum = numCheckpoints[srcRep];
                    uint256 srcRepOld = srcRepNum != 0
                        ? getCheckpoint(srcRep, srcRepNum - 1).votes
                        : 0;
                    uint256 srcRepNew = srcRepOld - amount;
                    _writeCheckpoint(srcRep, srcRepNum, srcRepOld, srcRepNew);
                }

                if (dstRep != address(0)) {
                    uint256 dstRepNum = numCheckpoints[dstRep];
                    uint256 dstRepOld = dstRepNum != 0
                        ? getCheckpoint(dstRep, dstRepNum - 1).votes
                        : 0;
                    uint256 dstRepNew = dstRepOld + amount;
                    _writeCheckpoint(dstRep, dstRepNum, dstRepOld, dstRepNew);
                }
            }
        }
    }

    /// @notice Elaborates delegate update - cf., 'Compound Governance'.
    /// @param delegatee The address to snapshot
    /// @param nCheckpoints The number of checkpoints delegatee has
    /// @param oldVotes The number of votes the delegatee had
    /// @param newVotes The number of votes the delegate has now
    function _writeCheckpoint(
        address delegatee,
        uint256 nCheckpoints,
        uint256 oldVotes,
        uint256 newVotes
    ) private {
        uint32 timeStamp = uint32(block.timestamp);

        unchecked {
            if (
                nCheckpoints != 0 &&
                getCheckpoint(delegatee, nCheckpoints - 1).fromTimeStamp ==
                timeStamp
            ) {
                getCheckpoint(delegatee, nCheckpoints - 1).votes = newVotes;
            } else {
                checkpoints[delegatee][nCheckpoints] = Checkpoint(
                    timeStamp,
                    newVotes
                );
                numCheckpoints[delegatee] = nCheckpoints + 1;
            }
        }

        emit DelegateVotesChanged(delegatee, oldVotes, newVotes);
    }

    /// @notice Returns the prior number of `votes` for `account` as of `timeStamp`.
    /// @param account The user to check `votes` for.
    /// @param timeStamp The unix time to check `votes` for.
    /// @return votes Prior `votes` delegated to `account`.
    function getPriorVotes(address account, uint256 timeStamp)
        public
        view
        virtual
        returns (uint256 votes)
    {
        require(timeStamp < block.timestamp, "!determined"); /* Prior votes must be in the past*/

        uint256 nCheckpoints = numCheckpoints[account];
        if (nCheckpoints == 0) return 0;

        unchecked {
            if (
                getCheckpoint(account, nCheckpoints - 1).fromTimeStamp <=
                timeStamp
            ) return getCheckpoint(account, nCheckpoints - 1).votes; /* If most recent checkpoint is at or after desired timestamp, return*/
            if (getCheckpoint(account, 0).fromTimeStamp > timeStamp) return 0;
            uint256 lower = 0;
            uint256 upper = nCheckpoints - 1;
            while (upper > lower) {
                /* Binary search to look for highest timestamp before desired timestamp*/
                uint256 center = upper - (upper - lower) / 2;
                Checkpoint memory cp = getCheckpoint(account, center);
                if (cp.fromTimeStamp == timeStamp) return cp.votes;
                else if (cp.fromTimeStamp < timeStamp) lower = center;
                else upper = center - 1;
            }
            votes = getCheckpoint(account, lower).votes;
        }
    }

    /// @notice Returns the current delegated `vote` balance for `account`.
    /// @param account The user to check delegated `votes` for.
    /// @return votes Current `votes` delegated to `account`.
    function getCurrentVotes(address account)
        public
        view
        virtual
        returns (uint256 votes)
    {
        uint256 nCheckpoints = numCheckpoints[account]; /*Get most recent checkpoint, or 0 if no checkpoints*/
        unchecked {
            votes = nCheckpoints != 0
                ? getCheckpoint(account, nCheckpoints - 1).votes
                : 0;
        }
    }

    function getCheckpoint(address delegatee, uint256 nCheckpoints)
        public
        view
        virtual
        returns (Checkpoint memory)
    {
        return checkpoints[delegatee][nCheckpoints];
    }
}
