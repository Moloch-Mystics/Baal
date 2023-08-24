// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@gnosis.pm/zodiac/contracts/factory/ModuleProxyFactory.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "../Baal.sol";
import "../interfaces/IBaalSummoner.sol";

contract BaalAdvTokenSummoner is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    IBaalSummoner public _baalSummoner;

    event setSummoner(address summoner);

    event DeployBaalTokens(address lootToken, address sharesToken);

    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
    }

    /**
     * @dev Sets the address of the BaalSummoner contract
     * @param baalSummoner The address of the BaalSummoner contract
     */
    function setSummonerAddr(address baalSummoner) public onlyOwner {
        require(baalSummoner != address(0), "zero address");
        _baalSummoner = IBaalSummoner(baalSummoner);
        emit setSummoner(baalSummoner);
    }

    /**
     * @dev Summon a new Baal contract with a new set of tokens
     * @param _safeAddr The address of the Gnosis Safe to be used as the treausry, 0x0 if new Safe
     * @param _forwarderAddr The address of the forwarder to be used, 0x0 if not set
     * @param _saltNonce The salt nonce to be used for the Safe contract
     * @param initializationMintParams The parameters for minting the tokens
     * @param initializationTokenParams The parameters for deploying the tokens
     * @param postInitializationActions The actions to be performed after the initialization
     */
    function summonBaalFromReferrer(
        address _safeAddr,
        address _forwarderAddr,
        uint256 _saltNonce,
        bytes calldata initializationMintParams,
        bytes calldata initializationTokenParams,
        bytes[] calldata postInitializationActions
    ) external {
        // summon tokens
        (address _lootToken, address _sharesToken) = deployTokens(
            initializationTokenParams
        );

        // mint shares loot tokens
        mintTokens(initializationMintParams, _lootToken, _sharesToken);

        // summon baal with new tokens
        address _baal = _baalSummoner.summonBaalFromReferrer(
            abi.encode(
                IBaalToken(_sharesToken).name(), 
                IBaalToken(_sharesToken).symbol(),
                _safeAddr,
                _forwarderAddr,
                _lootToken,
                _sharesToken
            ),
            postInitializationActions,
            _saltNonce,
            bytes32(bytes("DHAdvTokenSummoner")) // referrer
        );

        // change token ownership to baal
        IBaalToken(_lootToken).transferOwnership(address(_baal));
        IBaalToken(_sharesToken).transferOwnership(address(_baal));
    }

    /**
     * @dev mintTokens
     * @param initializationTokens The parameters for minting the tokens
     * @param _lootToken The loot token address
     * @param _sharesToken The shares token address
     */
    function mintTokens(
        bytes calldata initializationTokens,
        address _lootToken,
        address _sharesToken
    ) internal {
        (
            address[] memory summoners, // The address to mint initial tokens to
            uint256[] memory summonerShares, // The amount of shares to mint
            uint256[] memory summonerLoot // The amount of loot to mint
        ) = abi.decode(initializationTokens, (address[], uint256[], uint256[]));

        require(
            summoners.length == summonerShares.length &&
                summoners.length == summonerLoot.length,
            "!array parity"
        ); /*check array lengths match*/

        for (uint256 i = 0; i < summoners.length; i++) {
            if (summonerLoot[i] > 0) {
                IBaalToken(_lootToken).mint(
                    summoners[i],
                    summonerLoot[i]
                ); /*grant `to` `amount` `loot`*/
            }
            if (summonerShares[i] > 0) {
                IBaalToken(_sharesToken).mint(
                    summoners[i],
                    summonerShares[i]
                ); /*grant `to` `amount` `shares`*/
            }
        }
    }

    /**
     * @dev deployTokens
     * @param initializationParams The parameters for deploying the tokens
     */
    function deployTokens(
        bytes calldata initializationParams
    ) internal returns (address lootToken, address sharesToken) {
        (
            string
                memory _name /*_name Name for erc20 `shares` accounting, empty if token */,
            string
                memory _symbol /*_symbol Symbol for erc20 `shares` accounting, empty if token*/,
            string
                memory _lootName /* name for erc20 `loot` accounting, empty if token */,
            string
                memory _lootSymbol /* symbol for erc20 `loot` accounting, empty if token*/,
            bool _transferableShares /* if shares is transferable */,
            bool _transferableLoot /* if loot is transferable */
        ) = abi.decode(
                initializationParams,
                (string, string, string, string, bool, bool)
            );

        address lootSingleton = _baalSummoner.lootSingleton();
        address sharesSingleton = _baalSummoner.sharesSingleton();

        lootToken = address(
            new ERC1967Proxy(
                lootSingleton,
                abi.encodeWithSelector(
                    IBaalToken(lootSingleton).setUp.selector,
                    _lootName,
                    _lootSymbol
                )
            )
        );

        sharesToken = address(
            new ERC1967Proxy(
                sharesSingleton,
                abi.encodeWithSelector(
                    IBaalToken(sharesSingleton).setUp.selector,
                    _name,
                    _symbol
                )
            )
        );
        if (!_transferableShares) {
            IBaalToken(sharesToken).pause();
        }
        if (!_transferableLoot) {
            IBaalToken(lootToken).pause();
        }

        emit DeployBaalTokens(lootToken, sharesToken);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}
}
