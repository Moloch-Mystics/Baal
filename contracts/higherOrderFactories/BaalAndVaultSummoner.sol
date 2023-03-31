// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "../interfaces/IBaalSummoner.sol";

/*
Summon new 'non-ragequitable' treasury Safe (Vaults). (sidecar?)
Can summon a dao with a new Vault.
Can summon a new vault for a dao after initial dao setup.
Acts as a register and the owner of the contract or DAO can deactivate
register is primarily a helper for UIs
Owner of the contract can add new vaults, and set current vaults
Contract is upgradable and should be owned by a DAO
*/
contract BaalAndVaultSummoner is Initializable, OwnableUpgradeable, UUPSUpgradeable {

    IBaalSummoner public _baalSummoner;
    uint256 public vaultIdx;

    struct Vault{
        uint256 id;
        bool active;
        address daoAddress;
        address vaultAddress;
        string name;
    }
    mapping(uint256 => Vault) public vaults;
    mapping(address => address) public delegates;

    event SetVault(
        Vault vault
    );

    event SetDelegate(
        address daoAddress,
        address delegate
    );

    event setSummoner(
        address summoner
    );

    function initialize() initializer public {
        __Ownable_init();
        __UUPSUpgradeable_init();
        vaultIdx = 0;
    }

    function setSummonerAddr(
        address baalSummoner
    ) public onlyOwner {
        require(baalSummoner != address(0), "zero address");
        _baalSummoner = IBaalSummoner(baalSummoner);
        emit setSummoner(baalSummoner);
    }

    /** Summon a new baal and add a Vault */
    function summonBaalAndVault(
        bytes calldata initializationParams,
        bytes[] calldata initializationActions,
        uint256 saltNonce,
        bytes32 referrer,
        string memory name
    ) external returns (address _daoAddress, address _vaultAddress) {
        _daoAddress = _baalSummoner.summonBaalFromReferrer(
            initializationParams,
            initializationActions,
            saltNonce,
            referrer
        );
        _vaultAddress = summonVault(_daoAddress, name);
    }

    /** create and add a Vault(Safe) to an existing DAO */
    function summonVault(
        address daoAddress,
        string memory name
    ) public returns (address _vaultAddress) {
        _vaultAddress = _baalSummoner.deployAndSetupSafe(
            daoAddress
        );
        _setNewVault(name, daoAddress, _vaultAddress);
    }

    /** set a Vault as active or not on existing dao (owner only) */
    // Admin functions to help maintain the registry.
    function setVault(
        uint256 id,
        bool active
    ) public onlyOwner
    {
        _setVault(id, active);
    }

    /** set a new Vault as active on existing dao (owner only) */
    // Admin functions to help maintain the registry.
    function setNewVault(
        address daoAddress, 
        address vaultAddress,
        string memory name
    ) public onlyOwner
    {
        _setNewVault(name, daoAddress, vaultAddress);
    }

    /** 
    A DAO can set a Vault as inactive 
    */
    function deactivateVaultAsDao(
        uint256 id,
        address daoAddress
    ) external
    {
        require(msg.sender == daoAddress || msg.sender == delegates[daoAddress], "not DAO or delegate");
        require(vaults[id].daoAddress == daoAddress && vaults[id].active,"!not active DAO vault");
        _setVault(id, false);
    }

    /** Allow a Dao to set a delegate that can manage vault enteries */
    function setDelegate(
        address daoAddress,
        address delegate
    ) external
    {
        require(msg.sender == daoAddress, "!DAO");
        delegates[daoAddress] = delegate;
        emit SetDelegate(daoAddress, delegate);
    }


    function _setVault(
        uint256 id, 
        bool active
    ) internal 
    {
        vaults[id].active = active;
        emit SetVault(vaults[id]);
    }

    function _setNewVault(
        string memory name,
        address daoAddress, 
        address vaultAddress
    ) internal 
    {
        vaultIdx += 1;
        vaults[vaultIdx] = Vault(vaultIdx, true, daoAddress, vaultAddress, name);
        emit SetVault(vaults[vaultIdx]);
    }

    function _authorizeUpgrade(address newImplementation)
        internal
        onlyOwner
        override
    {}
}
