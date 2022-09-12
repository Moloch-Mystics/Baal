// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.13;

import "../Baal.sol";

contract MockBaal {
    bool public lootPaused;
    IBaalToken public lootToken; /*Sub ERC20 for loot mgmt*/

    constructor(
        address payable _lootSingleton,
        string memory _name,
        string memory _symbol
    ) {
        lootToken = IBaalToken(Clones.clone(_lootSingleton)); /*Clone loot singleton using EIP1167 minimal proxy pattern*/
        lootToken.setUp(
            string(abi.encodePacked(_name, " LOOT")),
            string(abi.encodePacked(_symbol, "-LOOT"))
        );
    }

    function setLootPaused(bool paused) external {
        lootPaused = paused;
    }
    
    function mintLoot(address _to, uint256 _amount) external {
        lootToken.mint(_to, _amount);
    }

    function burnLoot(address _from, uint256 _amount) external {
        lootToken.burn(_from, _amount);
    }
}
