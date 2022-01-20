// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;
import '../Baal.sol';
contract ShamanMinter {
    Baal public baal;

    function init(address payable _baal) external {
        baal =  Baal(_baal);
    }
    
    function doubler(address[] calldata members) external payable {
        uint96[] memory amounts;
        for (uint256 i = 0; i < members.length; i++) {
            amounts[i] = ( uint96(baal.balanceOf(members[i])));
        }
        baal.mintShares(members, amounts);
    }
}