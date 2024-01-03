const { ethers } = require('hardhat');

// Test Deploy Values 

// const _guildTokens = {
//     4: ['0x992e3005bb7a9efb9bff427f629bcb32fb61f706'],
// 	1: ['0x6b175474e89094c44da98b954eedeac495271d0f'],
// 	137: ['0xdd185af1bb417469461edbc95f22df9781a04624']
// }

const _shamans = {
    4: [''],
	1: [''],
	137: ['']
}

const _shares = ['1']; 
const _loot = ['1'];
const _minVoting = 60;
const _maxVoting = 600;
const _proposalOffering = 1;
const _name = "TestBaal";
const _symbol = "BAALTO";

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
	console.log('Summoning a Baal on network:', networkName[chainId]);
	console.log('Account address:', address);
	console.log(
		'Account balance:',
		ethers.utils.formatEther(await deployer.provider.getBalance(address)),
		networkCurrency[chainId]
	);

	// const BaalFactory = await ethers.getContractFactory('Baal')
	// const baalSingleton = (await BaalFactory.deploy())
	// await baalSingleton.deployed();

	// const txHash = baalSingleton.deployTransaction.hash;
	// const receipt = await deployer.provider.getTransactionReceipt(txHash);
	// console.log('Transaction Hash:', txHash);
	// console.log('Contract Address:', baalSingleton.address);
	// console.log('Block Number:', receipt.blockNumber);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});