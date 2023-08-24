import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const deployFn: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments, ethers, getChainId, getNamedAccounts, network } = hre;

	const { deployer } = await getNamedAccounts();
	const chainId = await getChainId();

	console.log('\n\nDeploying Poster on network:', network.name);
	console.log('Deployer address:', `${chainId}:${deployer}`);
	console.log(
		'Deployer balance:',
		ethers.utils.formatEther(await ethers.provider.getBalance(deployer)),
	);

	const { deploy } = deployments;
	await deploy('Poster', {
		contract: 'Poster',
		from: deployer,
		args: [],
		log: true,
	});
}

export default deployFn;
deployFn.tags = ['Infra', 'Poster'];