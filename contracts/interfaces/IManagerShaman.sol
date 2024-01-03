//SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface IManagerShaman {

    function isManager(address shaman) external view returns (bool);

    // Manager Only
    function mintShares(address[] calldata to, uint256[] calldata amount) external;
    function burnShares(address[] calldata from, uint256[] calldata amount) external;

    function mintLoot(address[] calldata to, uint256[] calldata amount) external;
    function burnLoot(address[] calldata from, uint256[] calldata amount) external;

}
