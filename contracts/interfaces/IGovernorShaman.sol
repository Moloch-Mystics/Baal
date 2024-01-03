//SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface IGovernorShaman {
    function isGovernor(address shaman) external view returns (bool);
    // Governor Only
    function setGovernanceConfig(bytes memory _governanceConfig) external;
}
