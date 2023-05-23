//SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface IBaalToken {
    function name() external view returns (string memory);

    function symbol() external view returns (string memory);

    function setUp(string memory _name, string memory _symbol) external;

    function mint(address recipient, uint256 amount) external;

    function burn(address account, uint256 amount) external;

    function pause() external;

    function unpause() external;

    function paused() external view returns (bool);
    
    function transferOwnership(address newOwner) external;

    function owner() external view returns (address);

    function balanceOf(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function snapshot() external returns(uint256);

    function getCurrentSnapshotId() external returns(uint256);

    function balanceOfAt(address account, uint256 snapshotId) external view returns (uint256);

    function totalSupplyAt(uint256 snapshotId) external view returns (uint256);

    // below is shares token specific
    struct Checkpoint {
        uint32 fromTimePoint;
        uint256 votes;
    }

    function getPastVotes(address account, uint256 timePoint) external view returns (uint256);

    function numCheckpoints(address) external view returns (uint256);

    function getCheckpoint(address, uint256)
        external
        view
        returns (Checkpoint memory);

    function getVotes(address account) external view returns (uint256);

    function delegates(address account) external view returns (address);

    function delegationNonces(address account) external view returns (uint256);

    function delegate(address delegatee) external;

    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
