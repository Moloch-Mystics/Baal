import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

import { deployments as logDeployments } from '../src/addresses/deployed';
import { getSetupAddresses } from '../src/addresses/setup';

type SupportedNetwork = keyof typeof logDeployments[0]['v103'];

const deployFn: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {

	const { deployments, ethers, getChainId, getNamedAccounts, network } = hre;

    const { deployer } = await getNamedAccounts();
    const chainId = await getChainId();

    const _addresses = await getSetupAddresses(chainId, network, deployments);

    if ((!_addresses.DAO || _addresses.DAO === ethers.constants.AddressZero) && network.name !== 'hardhat') {
		console.log('You need to set DAO address to transfer ownership of summoner', _addresses.DAO);
		return;
	}

    console.log('\n\nDeploying BaalAdvTokenSummoner(UUPS) factory on network:', network.name);
	console.log('Deployer address:', `${chainId}:${deployer}`);
	console.log(
		'Deployer balance:',
		ethers.utils.formatEther(await ethers.provider.getBalance(deployer)),
	);

    const { deploy } = deployments;


    let baalSummonerAddress = logDeployments[0]['v103'][network.name as SupportedNetwork]?.addresses?.factory;
    if (!network.live || !baalSummonerAddress) {
        const baal = await deployments.get('BaalSummoner');
        baalSummonerAddress = baal.address;
    }
	console.log('BaalSummoner address', baalSummonerAddress);
	
    const summonerDeeployed = await deploy('BaalAdvTokenSummoner', {
		contract: 'BaalAdvTokenSummoner',
		from: deployer,
		args: [],
        proxy: {
            proxyContract: 'UUPS',
            methodName: 'initialize',
        },
		log: true,
	});
    console.log('BaalSummoner deployment Tx ->', summonerDeeployed.transactionHash);

    const tx_1 = await deployments.execute('BaalAdvTokenSummoner', {
        from: deployer,
    }, 'setSummonerAddr',
        baalSummonerAddress
    );
    console.log('BaalAdvTokenSummoner setSummonerAddr Tx ->', tx_1.transactionHash);
  
	// transfer ownership to DAO
	if (network.name !== 'hardhat') {
		console.log("BaalAdvTokenSummoner transferOwnership to", _addresses.DAO);
        const tx_2 = await deployments.execute('BaalAdvTokenSummoner', {
            from: deployer,
        }, 'transferOwnership',
            _addresses.DAO
        );
        console.log('BaalAdvTokenSummoner transferOwnership Tx ->', tx_2.transactionHash);
	}
};

export default deployFn;
deployFn.tags = ['Factories', 'BaalAdvTokenSummoner'];
