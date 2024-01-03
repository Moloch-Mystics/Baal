//SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface IAdminShaman {
    function isAdmin(address shaman) external view returns (bool);

    // Admin Only
    function setAdminConfig(bool pauseShares, bool pauseLoot) external;
}
