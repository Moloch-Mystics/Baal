//SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface IBaalAndVaultSummoner {

    function _baalSummoner() external view returns (address);
    function summonBaalAndVault(
        bytes calldata initializationParams,
        bytes[] calldata initializationActions,
        uint256 saltNonce,
        bytes32 referrer,
        string memory name
    ) external returns (address _daoAddress, address _vaultAddress);
}
