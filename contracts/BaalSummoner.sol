// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.7;

import "@gnosis.pm/zodiac/contracts/factory/ModuleProxyFactory.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";

import "./Baal.sol";

contract BaalSummoner is ModuleProxyFactory {
    address payable public immutable template; // fixed template for baal using eip-1167 proxy pattern

    // Template contract to use for new Gnosis safe proxies
    address public immutable gnosisSingleton;

    // Library to use for EIP1271 compatability
    address public immutable gnosisFallbackLibrary;

    // Library to use for all safe transaction executions
    address public immutable gnosisMultisendLibrary;

    // template contract to clone for loot ERC20 token
    address public immutable lootSingleton;

    // template contract to clone for shares ERC20 token
    address public immutable sharesSingleton;

    // Proxy summoners
    //
    GnosisSafeProxyFactory gnosisSafeProxyFactory;
    ModuleProxyFactory moduleProxyFactory;

    event SummonBaal(
        address indexed baal,
        address indexed loot,
        address indexed shares,
        address safe,
        bool existingSafe
    );

    event DaoReferral(
        bytes32 referrer,
        bool daoHadExistingSafe,
        address daoAddress
    );

    constructor(
        address payable _template,
        address _gnosisSingleton,
        address _gnosisFallbackLibrary,
        address _gnosisMultisendLibrary,
        address _gnosisSafeProxyFactory,
        address _moduleProxyFactory,
        address _lootSingleton,
        address _sharesSingleton
    ) {
        require(_lootSingleton != address(0), "!lootSingleton");
        require(_sharesSingleton != address(0), "!sharesSingleton");
        require(_gnosisSingleton != address(0), "!gnosisSingleton");
        template = _template;
        gnosisSingleton = _gnosisSingleton;
        gnosisFallbackLibrary = _gnosisFallbackLibrary;
        gnosisMultisendLibrary = _gnosisMultisendLibrary;
        gnosisSafeProxyFactory = GnosisSafeProxyFactory(
            _gnosisSafeProxyFactory
        );
        moduleProxyFactory = ModuleProxyFactory(_moduleProxyFactory);
        lootSingleton = _lootSingleton;
        sharesSingleton = _sharesSingleton;
    }

    function encodeMultisend(bytes[] memory _calls, address _target)
        public
        pure
        returns (bytes memory encodedMultisend)
    {
        bytes memory encodedActions;
        for (uint256 i = 0; i < _calls.length; i++) {
            encodedActions = abi.encodePacked(
                encodedActions,
                uint8(0),
                _target,
                uint256(0),
                uint256(_calls[i].length),
                bytes(_calls[i])
            );
        }
        encodedMultisend = abi.encodeWithSignature(
            "multiSend(bytes)",
            encodedActions
        );
    }

    function summonBaal(
        bytes calldata initializationParams,
        bytes[] calldata initializationActions,
        uint256 _saltNonce
    ) external returns (address) {
        return
            _summonBaal(
                initializationParams,
                initializationActions,
                _saltNonce
            );
    }

    function summonBaalAndSafe(
        bytes calldata initializationParams,
        bytes[] calldata initializationActions,
        uint256 _saltNonce
    ) external returns (address) {
        return
            _summonBaalAndSafe(
                initializationParams,
                initializationActions,
                _saltNonce
            );
    }

    function summonBaalFromReferrer(
        bytes calldata initializationParams,
        bytes[] calldata initializationActions,
        uint256 _saltNonce,
        bool existingSafe,
        bytes32 referrer
    ) external payable returns (address) {
        address daoAddress;

        if (existingSafe) {
            daoAddress = _summonBaal(
                initializationParams,
                initializationActions,
                _saltNonce
            );
        } else {
            daoAddress = _summonBaalAndSafe(
                initializationParams,
                initializationActions,
                _saltNonce
            );
        }

        emit DaoReferral(referrer, existingSafe, daoAddress);
        return daoAddress;
    }

    function deployAndSetupSafe(address _moduleAddr, uint256 _saltNonce)
        internal
        returns (address)
    {
        // Deploy new safe but do not set it up yet
        GnosisSafe _safe = GnosisSafe(
            payable(
                gnosisSafeProxyFactory.createProxy(
                    gnosisSingleton,
                    abi.encodePacked(_saltNonce)
                )
            )
        );
        // Generate delegate calls so the safe calls enableModule on itself during setup
        bytes memory _enableBaal = abi.encodeWithSignature(
            "enableModule(address)",
            address(_moduleAddr)
        );
        bytes memory _enableBaalMultisend = abi.encodePacked(
            uint8(0),
            address(_safe),
            uint256(0),
            uint256(_enableBaal.length),
            bytes(_enableBaal)
        );

        bytes memory _multisendAction = abi.encodeWithSignature(
            "multiSend(bytes)",
            _enableBaalMultisend
        );

        // Workaround for solidity dynamic memory array
        address[] memory _owners = new address[](1);
        _owners[0] = address(_moduleAddr);

        // Call setup on safe to enable our new module and set the module as the only signer
        _safe.setup(
            _owners,
            1,
            gnosisMultisendLibrary,
            _multisendAction,
            gnosisFallbackLibrary,
            address(0),
            0,
            payable(address(0))
        );

        return address(_safe);
    }

    function _summonBaal(
        bytes calldata initializationParams,
        bytes[] calldata initializationActions,
        uint256 _saltNonce
    ) internal returns (address) {
        (
            string memory _name, /*_name Name for erc20 `shares` accounting*/
            string memory _symbol, /*_symbol Symbol for erc20 `shares` accounting*/
            address _safeAddr /*address of safe*/
        ) = abi.decode(initializationParams, (string, string, address));

        bytes memory _anyCall = abi.encodeWithSignature("avatar()"); /*This call can be anything, it just needs to return successfully*/
        Baal _baal = Baal(
            moduleProxyFactory.deployModule(template, _anyCall, _saltNonce)
        );

        bytes memory _initializationMultisendData = encodeMultisend(
            initializationActions,
            address(_baal)
        );
        bytes memory _initializer = abi.encode(
            _name,
            _symbol,
            lootSingleton,
            sharesSingleton,
            gnosisMultisendLibrary,
            _safeAddr,
            _initializationMultisendData
        );
        // can run the actions now because we have a baal
        _baal.setUp(_initializer);

        emit SummonBaal(
            address(_baal),
            address(_baal.lootToken()),
            address(_baal.sharesToken()),
            _safeAddr,
            true
        );

        return (address(_baal));
    }

    function _summonBaalAndSafe(
        bytes calldata initializationParams,
        bytes[] calldata initializationActions,
        uint256 _saltNonce
    ) internal returns (address) {
        (
            string memory _name, /*_name Name for erc20 `shares` accounting*/
            string memory _symbol /*_symbol Symbol for erc20 `shares` accounting*/
        ) = abi.decode(initializationParams, (string, string));

        bytes memory _anyCall = abi.encodeWithSignature("avatar()"); /*This call can be anything, it just needs to return successfully*/
        Baal _baal = Baal(
            moduleProxyFactory.deployModule(template, _anyCall, _saltNonce)
        );

        address _safe = deployAndSetupSafe(address(_baal), _saltNonce);

        bytes memory _initializationMultisendData = encodeMultisend(
            initializationActions,
            address(_baal)
        );

        bytes memory _initializer = abi.encode(
            _name,
            _symbol,
            lootSingleton,
            sharesSingleton,
            gnosisMultisendLibrary,
            _safe,
            _initializationMultisendData
        );

        _baal.setUp(_initializer);

        emit SummonBaal(
            address(_baal),
            address(_baal.lootToken()),
            address(_baal.sharesToken()),
            _safe,
            false
        );

        return (address(_baal));
    }
}
