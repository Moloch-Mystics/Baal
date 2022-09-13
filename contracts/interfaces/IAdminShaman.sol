//SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IAdminShaman {
    function isAdmin(address shaman) external view returns (bool);
    // Admin Only
    function setAdminConfig(bool pauseShares, bool pauseLoot) external;

}
