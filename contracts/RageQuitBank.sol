// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.0;

contract RageQuitBank {
    address public baal;
    
    event Receive(address indexed sender, uint256 value); // emits when ether (ETH) is received
    
    constructor(address _baal) {
        baal = _baal;
    }
    
    function memberBurn(address member, uint256 amount, uint256 total) external {
        require(msg.sender == baal, "!baal");
        (bool success, ) = member.call{value: address(this).balance * amount / total}("");
        require(success, "!ethCall");
    }
    
    /// @dev fallback to collect received ether into bank
    receive() external payable {emit Receive(msg.sender, msg.value);}
}
