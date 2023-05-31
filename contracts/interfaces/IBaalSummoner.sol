//SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface IBaalSummoner {
    event AdminChanged(address previousAdmin, address newAdmin);
    event BeaconUpgraded(address indexed beacon);
    event DaoReferral(bytes32 referrer, address daoAddress);
    event DeployBaalSafe(address baalSafe, address moduleAddr);
    event DeployBaalTokens(address lootToken, address sharesToken);
    event Initialized(uint8 version);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SetAddrsVersion(uint256 version);
    event SummonBaal(
        address indexed baal,
        address indexed loot,
        address indexed shares,
        address safe,
        address forwarder,
        uint256 existingAddrs
    );
    event Upgraded(address indexed implementation);

    function setAddrs(
        address _template,
        address _gnosisSingleton,
        address _gnosisFallbackLibrary,
        address _gnosisMultisendLibrary,
        address _gnosisSafeProxyFactory,
        address _moduleProxyFactory,
        address _lootSingleton,
        address _sharesSingleton
    ) external;

    function initialize() external;

    function transferOwnership(address newOwner) external;
    function upgradeTo(address newImplementation) external;
    function upgradeToAndCall(address newImplementation, bytes memory data) external payable;
    function renounceOwnership() external;

    function summonBaal(bytes memory initializationParams, bytes[] memory initializationActions, uint256 _saltNonce)
        external
        returns (address);
    function summonBaalFromReferrer(
        bytes memory initializationParams,
        bytes[] memory initializationActions,
        uint256 _saltNonce,
        bytes32 referrer
    ) external payable returns (address);

    function deployAndSetupSafe(address _moduleAddr) external returns (address);
    function deployTokens(string memory _name, string memory _symbol)
        external
        returns (address lootToken, address sharesToken);

    function encodeMultisend(bytes[] memory _calls, address _target)
        external
        pure
        returns (bytes memory encodedMultisend);
    function addrsVersion() external view returns (uint256);
    function gnosisFallbackLibrary() external view returns (address);
    function gnosisMultisendLibrary() external view returns (address);
    function gnosisSingleton() external view returns (address);
    function lootSingleton() external view returns (address);
    function sharesSingleton() external view returns (address);
    function owner() external view returns (address);
    function proxiableUUID() external view returns (bytes32);
    function template() external view returns (address);
}
