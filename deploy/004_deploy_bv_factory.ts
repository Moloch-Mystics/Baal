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

    console.log('\n\Deploying BaalAndVaultSummoner factory on network:', network.name);
	console.log('Deployer address:', `${chainId}:${deployer}`);
	console.log(
		'Deployer balance:',
		ethers.utils.formatEther(await ethers.provider.getBalance(deployer)),
	);

    const { deploy } = deployments;

    const baalSummoner = await deployments.get('BaalSummoner');
    console.log('BaalSummoner address', baalSummoner.address);

    const summonerDeeployed = await deploy('BaalAndVaultSummoner', {
		contract: 'BaalAndVaultSummoner',
		from: deployer,
		args: [],
        proxy: {
            proxyContract: 'UUPS',
            methodName: 'initialize',
        },
		log: true,
	});
    console.log('BaalSummoner deployment Tx ->', summonerDeeployed.transactionHash);
	
    const tx_3 = await deployments.execute('BaalAndVaultSummoner', {
        from: deployer,
    }, 'setSummonerAddr',
        baalSummoner.address
    );
    console.log('BaalAndVaultSummoner setSummonerAddr Tx ->', tx_3.transactionHash);


	if (network.name !== 'hardhat') {
        console.log("BaalAndVaultSummoner transferOwnership to", _addresses.DAO);
        const tx_4 = await deployments.execute('BaalAndVaultSummoner', {
            from: deployer,
        }, 'transferOwnership',
            _addresses.DAO
        );
        console.log('BaalAndVaultSummoner transferOwnership Tx ->', tx_4.transactionHash);
	}
};

export default deployFn;
deployFn.tags = ['Factories', 'BaalAndVaultSummoner'];
