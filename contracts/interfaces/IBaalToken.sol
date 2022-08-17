//SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IBaalToken {
    function name() external view returns (string memory);

    function setUp(string memory _name, string memory _symbol) external;

    function mint(address recipient, uint256 amount) external;

    function burn(address account, uint256 amount) external;

    function balanceOf(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    // below is shares token specific
    struct Checkpoint {
        /*Baal checkpoint for marking number of delegated votes*/
        uint32 fromTimeStamp; /*unix time for referencing voting balance*/
        uint256 votes; /*votes at given unix time*/
    }

    function getPriorVotes(address account, uint256 timeStamp) external view returns (uint256);

    function numCheckpoints(address) external view returns (uint256);

    function getCheckpoint(address, uint256)
        external
        view
        returns (Checkpoint memory);
}