pragma solidity >=0.8.0;
//SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/access/Ownable.sol"; //https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IBaal {
    function lootPaused() external returns (bool);
}

/// @title Loot
/// @notice Accounting for Baal non voting shares
contract Loot is ERC20, Initializable {
    using ECDSA for bytes32;

    // ERC20 CONFIG
    string private _name; /*Name for ERC20 trackers*/
    string private _symbol; /*Symbol for ERC20 trackers*/

    // SIGNATURE HELPERS
    mapping(address => uint256) public nonces; /*maps record of states for signing & validating signatures*/
    bytes32 constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
        );
    bytes32 constant PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

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
        _mint(recipient, amount);
    }

    /// @notice Baal-only function to burn loot.
    /// @param account Address to lose loot
    /// @param amount Amount to burn
    function burn(address account, uint256 amount) public baalOnly {
        _burn(account, amount);
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
                !baal.lootPaused(),
            "!transferable"
        );
    }
}
