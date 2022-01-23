pragma solidity >=0.8.0;
//SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/access/Ownable.sol"; //https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

interface IBaal {
    function lootPaused() external returns (bool);
}

contract Loot is ERC20, Initializable {
    IBaal baal;

    modifier baalOnly() {
        require(msg.sender == address(baal), "!auth");
        _;
    }

    constructor() ERC20("Template", "T") {} /*Configure template to be unusable*/

    function setUp(string memory _name, string memory _symbol) public {
        baal = IBaal(msg.sender); /*Configure Baal to setup sender*/
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20) {
        require(
            from == address(0) || to == address(0) || !baal.lootPaused(),
            "!transferable"
        );
    }

    function mint(address recipient, uint256 amount) public baalOnly {
        _mint(recipient, amount);
    }

    function burn(address account, uint256 amount) public baalOnly {
        _burn(account, amount);
    }
}
