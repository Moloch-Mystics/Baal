const { ethers } = require('hardhat');

// Test Deploy Values 

const networkName = {
	4: 'Rinkeby',
	1: 'mainnet',
	137: 'matic'
};

const networkCurrency = {
	4: 'ETH',
	1: 'ETH',
	137: 'matic'
};

async function main() {

	const [deployer] = await ethers.getSigners();
	const address = await deployer.getAddress();
	const { chainId } = await deployer.provider.getNetwork();
	console.log('Summoning tribute minion on network:', networkName[chainId]);
	console.log('Account address:', address);
	console.log(
		'Account balance:',
		ethers.utils.formatEther(await deployer.provider.getBalance(address)),
		networkCurrency[chainId]
	);

	// const network = await ethers.provider.getNetwork()
    // chainId = network.chainId
	

	const posterFactory = await ethers.getContractFactory('Poster')
    const posterSingleton = (await posterFactory.deploy())

	const txHash = posterSingleton.deployTransaction.hash;
	const receipt = await deployer.provider.getTransactionReceipt(txHash);
	console.log('Transaction Hash:', txHash);
	console.log('Contract Address:', posterSingleton.address);
	// console.log('Block Number:', receipt.blockNumber);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});