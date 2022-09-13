//SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

interface IBaalToken {
    function name() external view returns (string memory);

    function setUp(string memory _name, string memory _symbol) external;

    function mint(address recipient, uint256 amount) external;

    function burn(address account, uint256 amount) external;

    function balanceOf(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    // below is shares token specific
    struct Checkpoint {
        uint32 fromTimeStamp;
        uint256 votes;
    }

    function getPriorVotes(address account, uint256 timeStamp) external view returns (uint256);

    function numCheckpoints(address) external view returns (uint256);

    function getCheckpoint(address, uint256)
        external
        view
        returns (Checkpoint memory);

    function getCurrentVotes(address account) external view returns(uint256);
}
