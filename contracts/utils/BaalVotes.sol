// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "./DelegationEIP712Upgradeable.sol";

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
abstract contract BaalVotes is ERC20PermitUpgradeable, DelegationEIP712Upgradeable {
    using ECDSAUpgradeable for bytes32;

    struct Checkpoint {
        /*Baal checkpoint for marking number of delegated votes*/
        uint32 fromTimePoint; /*unix time for referencing voting balance*/
        uint256 votes; /*votes at given unix time*/
    }

    // DELEGATE TRACKING
    mapping(address => mapping(uint256 => Checkpoint)) public checkpoints; /*maps record of vote `checkpoints` for each account by index*/
    mapping(address => uint256) public numCheckpoints; /*maps number of `checkpoints` for each account*/
    mapping(address => address) public delegates; /*maps record of each account's `shares` delegate*/
    mapping(address => uint256) public delegationNonces; /*nonces for delegating by signature*/

    // SIGNATURE HELPERS
    bytes32 constant DELEGATION_TYPEHASH = keccak256("Delegation(string name,address delegatee,uint256 nonce,uint256 expiry)");

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
    function delegate(address delegatee) external virtual {
        _delegate(msg.sender, delegatee);
    }

    /// @notice Delegates votes from `signer` to `delegatee` with EIP-712 signature.
    /// @param delegatee The address to delegate 'votes' to.
    /// @param nonce The contract state required to match the signature.
    /// @param expiry The time at which to expire the signature.
    /// @param v The v signature
    /// @param r The r signature
    /// @param s The s signature
    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        require(now() <= expiry, "ERC20Votes: signature expired");
        address signer = ECDSAUpgradeable.recover(
            _hashTypedDataV4Delegation(
                keccak256(
                    abi.encode(
                        DELEGATION_TYPEHASH,
                        keccak256(abi.encodePacked(name())),
                        delegatee,
                        nonce,
                        expiry
                    )
                )
            ),
            v,
            r,
            s
        );
        require(signer != address(0), "ERC20Votes: invalid signer (0x0)");
        require(nonce == delegationNonces[signer], "ERC20Votes: invalid nonce");

        delegationNonces[signer]++;
        _delegate(signer, delegatee);
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
        uint32 timePoint = uint32(now());

        unchecked {
            if (
                nCheckpoints != 0 &&
                checkpoints[delegatee][nCheckpoints - 1].fromTimePoint == timePoint
            ) {
                checkpoints[delegatee][nCheckpoints - 1].votes = newVotes;
            } else {
                checkpoints[delegatee][nCheckpoints] = Checkpoint(
                    timePoint,
                    newVotes
                );
                numCheckpoints[delegatee] = nCheckpoints + 1;
            }
        }

        emit DelegateVotesChanged(delegatee, oldVotes, newVotes);
    }

    /// @notice Returns the current timepoint.
    /// @return timePoint returns unix epoch timestamp
    function now() public view returns (uint256 timePoint) {
        return block.timestamp;
    }

    /// @notice Returns the prior number of `votes` for `account` as of `timePoint`.
    /// @param account The user to check `votes` for.
    /// @param timePoint The unix time to check `votes` for.
    /// @return votes Past `votes` delegated to `account`.
    function getPastVotes(address account, uint256 timePoint)
        external
        view
        virtual
        returns (uint256 votes)
    {
        require(timePoint < now(), "!determined"); /* Prior votes must be in the past*/

        uint256 nCheckpoints = numCheckpoints[account];
        if (nCheckpoints == 0) return 0;

        unchecked {
            if (
                getCheckpoint(account, nCheckpoints - 1).fromTimePoint <=
                timePoint
            ) return getCheckpoint(account, nCheckpoints - 1).votes; /* If most recent checkpoint is at or after desired timepoint, return*/
            if (getCheckpoint(account, 0).fromTimePoint > timePoint) return 0;
            uint256 lower = 0;
            uint256 upper = nCheckpoints - 1;
            while (upper > lower) {
                /* Binary search to look for highest timePoint before desired timePoint*/
                uint256 center = upper - (upper - lower) / 2;
                Checkpoint memory cp = getCheckpoint(account, center);
                if (cp.fromTimePoint == timePoint) return cp.votes;
                else if (cp.fromTimePoint < timePoint) lower = center;
                else upper = center - 1;
            }
            votes = getCheckpoint(account, lower).votes;
        }
    }

    /// @notice Returns the current delegated `vote` balance for `account`.
    /// @param account The user to check delegated `votes` for.
    /// @return votes Current `votes` delegated to `account`.
    function getVotes(address account)
        external
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
