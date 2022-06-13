// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

contract RageQuitBank {
    address public baal;
    uint96 constant LOOT_RATE = 2;
    uint96 constant SHARE_RATE = 2;

    function init(address _baal) external {
        require(_baal != address(0), "transfer from the zero address");
        baal = _baal;
    }
    
    function memberAction(address, uint96 loot, uint96 shares) external payable returns (uint96 lootOut, uint96 sharesOut) {
        require(msg.sender == baal, "!baal");
        lootOut = loot * LOOT_RATE;
        sharesOut = shares * SHARE_RATE;
    }
}
