// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.6;

contract SimpleShaman {
    address public baal;
    uint lootRate = 10;
    uint shareRate = 5;

    constructor(address _baal) {
        baal = _baal;
    }
    
    function memberBurn(uint loot, uint shares) external payable returns (uint96 lootReaction, uint96 sharesReaction) {
        require(msg.sender == baal,'!baal');
        lootReaction = uint96(loot * lootRate);
        sharesReaction = uint96(shares * shareRate);
    }
}
