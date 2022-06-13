// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;
import "../Baal.sol";

contract ShamanMinter {
    Baal public baal;
    IBaalToken public sharesToken;

    function init(address payable _baal) external {
        baal = Baal(_baal);
        sharesToken = IBaalToken(baal.sharesToken());
    }

    function doubler(address[] calldata members) external payable {
        uint256[] memory amounts;
        for (uint256 i = 0; i < members.length; i++) {
            amounts[i] = (uint256(sharesToken.balanceOf(members[i])));
        }
        baal.mintShares(members, amounts);
    }
}
