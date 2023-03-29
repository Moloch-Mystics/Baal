//SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

interface IBaalSummoner {
    function lootSingleton() external view returns (address);
    function sharesSingleton() external view returns (address);

    function deployAndSetupSafe(address _moduleAddr)
        external
        returns (address);

    function summonBaalFromReferrer(
        bytes calldata initializationParams,
        bytes[] calldata initializationActions,
        uint256 _saltNonce,
        bytes32 referrer
    ) external payable returns (address);
}