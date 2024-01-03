pragma solidity 0.8.7;
//SPDX-License-Identifier: MIT

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20SnapshotUpgradeable.sol";

import "./utils/BaalVotes.sol";
import "./interfaces/IBaal.sol";

// import "hardhat/console.sol";

/// @title Shares
/// @notice Accounting for Baal non voting shares
contract Shares is BaalVotes, ERC20SnapshotUpgradeable, OwnableUpgradeable, PausableUpgradeable, UUPSUpgradeable {

    constructor() {
        _disableInitializers();
    }

    /// @notice Configure shares - called by Baal on summon
    /// @dev initializer should prevent this from being called again
    /// @param name_ Name for ERC20 token trackers
    /// @param symbol_ Symbol for ERC20 token trackers
    function setUp(string memory name_, string memory symbol_)
        external
        initializer
    {
        require(bytes(name_).length != 0, "shares: name empty");
        require(bytes(symbol_).length != 0, "shares: symbol empty");

        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        __Pausable_init();
        __ERC20Snapshot_init();
        __Ownable_init();
        __UUPSUpgradeable_init();
        __EIP712_init_delegation("delegation", "4");


    }

    /// @notice Baal-only function to pause shares.
    function pause() public onlyOwner {
        _pause();
    }

    /// @notice Baal-only function to unpause shares.
    function unpause() public onlyOwner {
        _unpause();
    }

    /// @notice Allows baal to create a snapshot
    function snapshot() external onlyOwner returns(uint256) {
        return _snapshot();
    }

    /// @notice get current SnapshotId
    function getCurrentSnapshotId() external view returns (uint256) {
        return _getCurrentSnapshotId();
    }

    /// @notice Baal-only function to mint shares.
    /// @param recipient Address to receive shares
    /// @param amount Amount to mint
    function mint(address recipient, uint256 amount) external onlyOwner {
        // can not be more than half the max because of totalsupply of loot and shares
        require(totalSupply() + amount <= type(uint256).max / 2, "shares: cap exceeded");
        _mint(recipient, amount);
    }

    /// @notice Baal-only function to burn shares.
    /// @param account Address to lose shares
    /// @param amount Amount to burn
    function burn(address account, uint256 amount) external onlyOwner {
        _burn(account, amount);
    }

    /// @notice Internal hook to restrict token transfers unless allowed by baal
    /// @dev Allows transfers if msg.sender is Baal which enables minting and burning
    /// @param from The address of the source account.
    /// @param to The address of the destination account.
    /// @param amount The number of `shares` tokens to transfer.
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(BaalVotes, ERC20SnapshotUpgradeable) {
        super._beforeTokenTransfer(from, to, amount);
        require(
            from == address(0) || /*Minting allowed*/
                (msg.sender == owner() && to == address(0)) || /*Burning by Baal allowed*/
                !paused(),
            "shares: !transferable"
        );
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
