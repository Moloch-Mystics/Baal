// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@gnosis.pm/zodiac/contracts/factory/ModuleProxyFactory.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "./Baal.sol";

contract BaalSummoner is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    // when some of the init addresses are updated
    uint256 public addrsVersion;

    address payable public template; // fixed template for baal using eip-1167 proxy pattern

    // Template contract to use for new Gnosis safe proxies
    address public gnosisSingleton;

    // Library to use for EIP1271 compatability
    address public gnosisFallbackLibrary;

    // Library to use for all safe transaction executions
    address public gnosisMultisendLibrary;

    // template contract to clone for loot ERC20 token
    address public lootSingleton;

    // template contract to clone for shares ERC20 token
    address public sharesSingleton;

    // Proxy summoners
    //
    GnosisSafeProxyFactory gnosisSafeProxyFactory;
    ModuleProxyFactory moduleProxyFactory;

    event SetAddrsVersion(
        uint256 version
    );

    event SummonBaal(
        address indexed baal,
        address indexed loot,
        address indexed shares,
        address safe,
        address forwarder,
        uint256 existingAddrs
    );

    event DaoReferral(
        bytes32 referrer,
        address daoAddress
    );

    event DeployBaalTokens(
        address lootToken, 
        address sharesToken
    );

    event DeployBaalSafe(
        address baalSafe,
        address moduleAddr
    );

    function initialize() initializer public {
        __Ownable_init();
        __UUPSUpgradeable_init();
    }

    // must be called after deploy to set libraries
    function setAddrs(
        address payable _template,
        address _gnosisSingleton,
        address _gnosisFallbackLibrary,
        address _gnosisMultisendLibrary,
        address _gnosisSafeProxyFactory,
        address _moduleProxyFactory,
        address _lootSingleton,
        address _sharesSingleton
    ) public onlyOwner {
        require(_lootSingleton != address(0), "!lootSingleton");
        require(_sharesSingleton != address(0), "!sharesSingleton");
        require(_gnosisSingleton != address(0), "!gnosisSingleton");
        require(_gnosisFallbackLibrary != address(0), '!gnosisFallbackLibrary');
        require(_gnosisMultisendLibrary != address(0), '!gnosisMultisendLibrary');
        require(_gnosisSafeProxyFactory != address(0), '!gnosisSafeProxyFactory');
        require(_moduleProxyFactory != address(0), '!moduleProxyFactory');

        template = _template;
        gnosisSingleton = _gnosisSingleton;
        gnosisFallbackLibrary = _gnosisFallbackLibrary;
        gnosisMultisendLibrary = _gnosisMultisendLibrary;
        gnosisSafeProxyFactory = GnosisSafeProxyFactory(_gnosisSafeProxyFactory);
        moduleProxyFactory = ModuleProxyFactory(_moduleProxyFactory);
        lootSingleton = _lootSingleton;
        sharesSingleton = _sharesSingleton;

        emit SetAddrsVersion(
        addrsVersion++
        );
        
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

    // Add a referrer to help keep track of where deploies are coming from
    function summonBaalFromReferrer(
        bytes calldata initializationParams,
        bytes[] calldata initializationActions,
        uint256 _saltNonce,
        bytes32 referrer
    ) external payable returns (address) {
        address daoAddress;

        daoAddress = _summonBaal(
            initializationParams,
            initializationActions,
            _saltNonce
        );

        emit DaoReferral(referrer, daoAddress);
        return daoAddress;
    }

    // deploy new share and loot contracts
    function deployTokens(string memory _name, string memory _symbol) 
        public 
        returns (address lootToken, address sharesToken) 
    {
        lootToken = address(new ERC1967Proxy(
            lootSingleton,
            abi.encodeWithSelector(
                IBaalToken(lootSingleton).setUp.selector, 
                string(abi.encodePacked(_name, " LOOT")), 
                string(abi.encodePacked(_symbol, "-LOOT")))
        ));

        sharesToken = address(new ERC1967Proxy(
            sharesSingleton,
            abi.encodeWithSelector(
                IBaalToken(sharesSingleton).setUp.selector, 
                _name, 
                _symbol)
        ));

        emit DeployBaalTokens(lootToken, sharesToken);

    }

    // deploy a safe with module and single module signer setup
    function deployAndSetupSafe(address _moduleAddr)
        public
        returns (address)
    {
        // Deploy new safe but do not set it up yet
        GnosisSafe _safe = GnosisSafe(
            payable(
                gnosisSafeProxyFactory.createProxy(
                    gnosisSingleton,
                    bytes("")
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

        emit DeployBaalSafe(address(_safe), address(_moduleAddr));

        return address(_safe);
    }

    // advanced summon baal with different configurations
    // name and symbol can be blank if bringing own baal tokens
    // zero address for either loot or shares token will summon new ones
    // if bringing own tokens the ownership must be transfered to the new DAO
    // zero address for Safe with summon and setup a new Safe
    // if bringing existing safe the new dao must be enabled as a module
    // todo: add a simple summon that just creates a dao with a single summoner
    function _summonBaal(
        bytes calldata initializationParams,
        bytes[] calldata initializationActions,
        uint256 _saltNonce
    ) internal returns (address) {
        uint256 existingAddrs; // 1 tokens, 2 safe, 3 both
        (
            string memory _name, /*_name Name for erc20 `shares` accounting, empty if token */
            string memory _symbol, /*_symbol Symbol for erc20 `shares` accounting, empty if token*/
            address _safeAddr, /*address of safe, 0 addr if new*/
            address _forwarder, /*Trusted forwarder address for meta-transactions (EIP 2771), 0 addr if initially disabled*/
            address _lootToken, /*predeployed loot token, 0 addr if new*/
            address _sharesToken /*predeployed shares token, 0 addr if new*/
        ) = abi.decode(initializationParams, (string, string, address, address, address, address));

        Baal _baal = Baal(
            moduleProxyFactory.deployModule(
                template, 
                abi.encodeWithSignature("avatar()"), 
                _saltNonce
            )
        );

        // if loot or shares are zero address new tokens are deployed
        // tokens need to be baalTokens
        if(_lootToken == address(0) || _sharesToken == address(0)){
            (_lootToken, _sharesToken) = deployTokens(_name, _symbol);
            // pause tokens by default and transfer to the DAO
            IBaalToken(_lootToken).pause();
            IBaalToken(_sharesToken).pause();
            IBaalToken(_lootToken).transferOwnership(address(_baal));
            IBaalToken(_sharesToken).transferOwnership(address(_baal));
        } else {
            existingAddrs += 1;
        }

        // if zero address deploy a new safe
        // Needs to be a valid zodiac treasury
        if(_safeAddr == address(0)){
            _safeAddr = deployAndSetupSafe(address(_baal));
        } else {
            existingAddrs += 2;
        }

        bytes memory _initializationMultisendData = encodeMultisend(
            initializationActions,
            address(_baal)
        );
        bytes memory _initializer = abi.encode(
            _lootToken,
            _sharesToken,
            gnosisMultisendLibrary,
            _safeAddr,
            _forwarder,
            _initializationMultisendData
        );
        // can run the actions now because we have a baal
        _baal.setUp(_initializer);

        emit SummonBaal(
            address(_baal),
            address(_baal.lootToken()),
            address(_baal.sharesToken()),
            _safeAddr,
            _forwarder,
            existingAddrs
        );

        return (address(_baal));
    }

    function _authorizeUpgrade(address newImplementation)
        internal
        onlyOwner
        override
    {}
}
