//SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface IPoster {
    function post(string calldata content, string calldata tag) external;
}
