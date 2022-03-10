const { ethers } = require('hardhat');

// Test Deploy Values 

// deploy templates
// deploy dao factory
// deploy higher order factory 

const _shamans = {
    4: [''],
	1: [''],
	137: ['']
}

// same for all networks
const _addresses = {
	gnosisSingleton: "0xd9db270c1b5e3bd161e8c8503c55ceabee709552",
	gnosisFallbackLibrary: "0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4",
	gnosisMultisendLibrary: "0xa238cbeb142c10ef7ad8442c6d1f9e89e07e7761",
	poster: "0x000000000000cd17345801aa8147b8D3950260FF"
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
	console.log('Summoning Baal factories on network:', networkName[chainId]);
	console.log('Account address:', address);
	console.log(
		'Account balance:',
		ethers.utils.formatEther(await deployer.provider.getBalance(address)),
		networkCurrency[chainId]
	);

	// const network = await ethers.provider.getNetwork()
    // chainId = network.chainId
	

	const LootFactory = await ethers.getContractFactory('Loot')
    const lootSingleton = (await LootFactory.deploy())
    const BaalFactory = await ethers.getContractFactory('Baal')
    const baalSingleton = (await BaalFactory.deploy())
	const BaalSummoner = await ethers.getContractFactory('BaalSummoner')
	
	console.log('lootSingleton',lootSingleton.address)
	console.log('baalSingleton',baalSingleton.address)

    const baalSummoner = (await BaalSummoner.deploy(
		baalSingleton.address, 
		_addresses.gnosisSingleton, 
		_addresses.gnosisFallbackLibrary, 
		_addresses.gnosisMultisendLibrary))
    
	await baalSummoner.deployed();

	// const factory = await ethers.getContractFactory('Baal');
	// const Baal = await factory.deploy(
    //     _shamans[chainId],
    //     // _guildTokens[chainId],
    //     [_deployer],
    //     _loot,
    //     _shares,
    //     _minVoting,
    //     _maxVoting,
	// 	_proposalOffering,
    //     _name,
    //     _symbol,
    //     false,
    //     false,
	// );

	// await Baal.deployed();

	const txHash = baalSummoner.deployTransaction.hash;
	const receipt = await deployer.provider.getTransactionReceipt(txHash);
	console.log('Transaction Hash:', txHash);
	console.log('Contract Address:', baalSummoner.address);
	console.log('Block Number:', receipt.blockNumber);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});