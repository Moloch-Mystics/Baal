import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

import { getSetupAddresses } from '../src/addresses/setup';

const deployFn: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {

    const { deployments, ethers, getChainId, getNamedAccounts, network } = hre;

    const { deployer } = await getNamedAccounts();
	const chainId = await getChainId();

	const _addresses = await getSetupAddresses(chainId, network, deployments);

	if ((!_addresses.DAO || _addresses.DAO === ethers.constants.AddressZero) && network.name !== 'hardhat') {
		console.log('You need to set DAO address to transfer ownership of summoner', _addresses.DAO);
		return;
	}

	console.log('\n\nDeploying BaalSummoner factory on network:', network.name);
	console.log('Deployer address:', `${chainId}:${deployer}`);
	console.log(
		'Deployer balance:',
		ethers.utils.formatEther(await ethers.provider.getBalance(deployer)),
	);

    const { deploy } = deployments;

	const lootSingleton = await deploy('Loot', {
		contract: 'Loot',
		from: deployer,
		args: [],
		log: true,
	});
	
    const sharesSingleton = await deploy('Shares', {
		contract: 'Shares',
		from: deployer,
		args: [],
		log: true,
	});

    const baalSingleton = await deploy('Baal', {
		contract: 'Baal',
		from: deployer,
		args: [],
		log: true,
	});

    const summonerDeeployed = await deploy('BaalSummoner', {
		contract: 'BaalSummoner',
		from: deployer,
		args: [],
        proxy: {
            proxyContract: 'UUPS',
            methodName: 'initialize',
        },
		log: true,
	});
	console.log('BaalSummoner deployment Tx ->', summonerDeeployed.transactionHash);

    // set addresses of templates and libraries
    const tx_1 = await deployments.execute('BaalSummoner', {
        from: deployer,
    }, 'setAddrs',
        baalSingleton.address, 
		_addresses.gnosisSingleton, 
		_addresses.gnosisFallbackLibrary, 
		_addresses.gnosisMultisendLibrary,
		_addresses.gnosisSafeProxyFactory,
		_addresses.moduleProxyFactory,
		lootSingleton.address,
		sharesSingleton.address
    );
    console.log('BaalSummoner setAddrs Tx ->', tx_1.transactionHash);
	
    
	// transfer ownership to DAO
	if (network.name !== 'hardhat') {
		console.log("BaalSummoner transferOwnership to", _addresses.DAO);
        const tx_2 = await deployments.execute('BaalSummoner', {
            from: deployer,
        }, 'transferOwnership',
            _addresses.DAO
        );
        console.log('BaalSummoner transferOwnership Tx ->', tx_2.transactionHash);
	}
};

export default deployFn;
deployFn.tags = ['Factories', 'BaalSummoner'];
