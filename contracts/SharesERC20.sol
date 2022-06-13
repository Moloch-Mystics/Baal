pragma solidity >=0.8.0;
//SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/access/Ownable.sol"; //https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "hardhat/console.sol";


interface IBaal {
    function sharesPaused() external returns (bool);
}

/// @title Shares
/// @notice Accounting for Baal non voting shares
contract Shares is ERC20, Initializable {
    using ECDSA for bytes32;

    struct Checkpoint {
        /*Baal checkpoint for marking number of delegated votes*/
        uint32 fromTimeStamp; /*unix time for referencing voting balance*/
        uint256 votes; /*votes at given unix time*/
    }

    // ERC20 CONFIG
    string private _name; /*Name for ERC20 trackers*/
    string private _symbol; /*Symbol for ERC20 trackers*/

    // DELEGATE TRACKING
    mapping(address => mapping(uint256 => Checkpoint)) public checkpoints; /*maps record of vote `checkpoints` for each account by index*/
    mapping(address => uint256) public numCheckpoints; /*maps number of `checkpoints` for each account*/
    mapping(address => address) public delegates; /*maps record of each account's `shares` delegate*/

    // SIGNATURE HELPERS
    mapping(address => uint256) public nonces; /*maps record of states for signing & validating signatures*/
    bytes32 constant DELEGATION_TYPEHASH =
        keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");
    bytes32 constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
        );
    bytes32 constant PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
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

    // Baal Config
    IBaal public baal;

    modifier baalOnly() {
        require(msg.sender == address(baal), "!auth");
        _;
    }

    constructor() ERC20("Template", "T") initializer {} /*Configure template to be unusable*/

    /// @notice Configure loot - called by Baal on summon
    /// @dev initializer should prevent this from being called again
    /// @param name_ Name for ERC20 token trackers
    /// @param symbol_ Symbol for ERC20 token trackers
    function setUp(string memory name_, string memory symbol_)
        public
        initializer
    {
        baal = IBaal(msg.sender); /*Configure Baal to setup sender*/
        _name = name_;
        _symbol = symbol_;
    }

    /// @notice Returns the name of the token.
    function name() public view override(ERC20) returns (string memory) {
        return _name;
    }

    /// @notice Returns the symbol of this token
    function symbol() public view override(ERC20) returns (string memory) {
        return _symbol;
    }

    /// @notice Transfer `amount` tokens from `from` to `to`.
    /// @param from The address of the source account.
    /// @param to The address of the destination account.
    /// @param amount The number of `loot` tokens to transfer.
    /// @return success Whether or not the transfer succeeded.
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override(ERC20) returns (bool success) {
        _transfer(from, to, amount);

        uint256 currentAllowance = allowance(from, msg.sender);
        if (currentAllowance != type(uint256).max) {
            _approve(from, msg.sender, currentAllowance - amount);
        }

        return true;
    }

    /// @notice Baal-only function to mint loot.
    /// @param recipient Address to receive loot
    /// @param amount Amount to mint
    function mint(address recipient, uint256 amount) public baalOnly {
        unchecked {
            if (totalSupply() + amount <= type(uint256).max / 2) {
                /*If recipient is receiving their first shares, auto-self delegate*/
                // if (
                //     balanceOf(recipient) == 0 && numCheckpoints[recipient] == 0 && amount > 0
                // ) {
                //     delegates[recipient] = recipient;
                // }

                _mint(recipient, amount);

                // in before transfer
                //_moveDelegates(address(0), delegates[recipient], amount); /*update delegation*/
            }
        }
    }

    /// @notice Baal-only function to burn loot.
    /// @param account Address to lose loot
    /// @param amount Amount to burn
    function burn(address account, uint256 amount) public baalOnly {
        _burn(account, amount);

        // in before transfer
        // _moveDelegates(delegates[account], address(0), amount); /*update delegation*/
    }

    /// @notice Triggers an approval from `owner` to `spender` with EIP-712 signature.
    /// @param owner The address to approve from.
    /// @param spender The address to be approved.
    /// @param amount The number of `loot` tokens that are approved (2^256-1 means infinite).
    /// @param deadline The time at which to expire the signature.
    /// @param signature Concatenated signature
    function permit(
        address owner,
        address spender,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(_name)),
                block.chainid,
                address(this)
            )
        ); /*calculate EIP-712 domain hash*/

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
            ); /*calculate EIP-712 struct hash*/
            bytes32 digest = keccak256(
                abi.encodePacked("\x19\x01", domainSeparator, structHash)
            ); /*calculate EIP-712 digest for signature*/
            address signatory = digest.recover(signature); /*recover signer from hash data*/
            require(signatory != address(0), "!signatory"); /*check signer is not null*/
            require(signatory == owner, "!authorized"); /*check signer is `owner`*/
        }

        require(block.timestamp <= deadline, "expired"); /*check signature is not expired*/
        _approve(owner, spender, amount); /*adjust `allowance`*/

        emit Approval(owner, spender, amount); /*emit event reflecting approval*/
    }

    /// @notice Internal hook to restrict token transfers unless allowed by baal
    /// @dev Allows transfers if msg.sender is Baal which enables minting and burning
    /// @param from The address of the source account.
    /// @param to The address of the destination account.
    /// @param amount The number of `loot` tokens to transfer.
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20) {
        super._beforeTokenTransfer(from, to, amount);
        require(
            from == address(0) || /*Minting allowed*/
                (msg.sender == address(baal) && to == address(0)) || /*Burning by Baal allowed*/
                !baal.sharesPaused(),
            "!transferable"
        );
        /*If recipient is receiving their first shares, auto-self delegate*/
        if (balanceOf(to) == 0 && numCheckpoints[to] == 0 && amount > 0) {
            delegates[to] = to;
        }

        _moveDelegates(delegates[from], delegates[to], amount);
    }

    /// @notice Delegate votes from user to `delegatee`.
    /// @param delegatee The address to delegate votes to.
    function delegate(address delegatee) external {
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
    ) external {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(_name)),
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
            require(nonce == nonces[signatory]++, "!nonce"); /*check given `nonce` is next in `nonces`*/
        }

        require(deadline == 0 || deadline < block.timestamp, "expired");

        _delegate(signatory, delegatee); /*execute delegation*/
    }

    /// @notice Delegates Baal voting weight.
    /// @param delegator The address to delegate 'votes' from.
    /// @param delegatee The address to delegate 'votes' to.
    // TODO sharestoken

    function _delegate(address delegator, address delegatee) private {
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
    // TODO sharestoken

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


    function getCheckpoint(address delegatee, uint256 nCheckpoints) public view returns(Checkpoint memory) {
        return checkpoints[delegatee][nCheckpoints]; 
    }
}

