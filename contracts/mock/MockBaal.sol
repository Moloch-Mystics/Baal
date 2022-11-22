// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/proxy/Clones.sol";

import "../Baal.sol";

contract MockBaal {
    bool public lootPaused;
    IBaalToken public lootToken; /*Sub ERC20 for loot mgmt*/

    constructor(
        address payable _lootSingleton,
        string memory _name,
        string memory _symbol
    ) {
        /*Clone loot singleton using EIP1167 minimal proxy pattern*/
        lootToken = IBaalToken(Clones.clone(_lootSingleton));
        lootToken.setUp(
            string(abi.encodePacked(_name, " LOOT")),
            string(abi.encodePacked(_symbol, "-LOOT"))
        );
    }

    function setLootPaused(bool paused) external {
        if(!lootToken.paused() && paused){
            lootToken.pause();
        } else if(lootToken.paused() && !paused){
            lootToken.unpause();
        }
        lootPaused = paused;
    }

    function mintLoot(address _to, uint256 _amount) external {
        lootToken.mint(_to, _amount);
    }

    function burnLoot(address _from, uint256 _amount) external {
        lootToken.burn(_from, _amount);
    }
}
