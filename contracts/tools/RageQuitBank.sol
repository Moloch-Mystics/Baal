// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

contract RageQuitBank {
    address public baal;
    uint96 lootRate = 2;
    uint96 shareRate = 2;

    function init(address _baal) external {
        baal = _baal;
    }
    
    function memberAction(address, uint96 loot, uint96 shares) external payable returns (uint96 lootOut, uint96 sharesOut) {
        require(msg.sender == baal,'!baal');
        lootOut = loot * lootRate;
        sharesOut = shares * shareRate;
    }
}