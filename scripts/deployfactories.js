const { ethers } = require('hardhat');

// Test Deploy Values 

// deploy templates
// deploy dao factory
// deploy higher order factory 

const _shamans = {
    4: [''],
	1: [''],
	137: [''],
	42: [''],
	100: [''],
}

// same default for all networks, but different sometimes
// https://github.com/gnosis/zodiac/blob/master/src/factory/constants.ts#L20
// https://github.com/safe-global/safe-deployments/tree/main/src/assets
// moduleProxyFactory default 0x00000000062c52e29e8029dc2413172f6d619d85 goerli, optimism and arbitrum at 0x270c012B6C2A61153e8A6d82F2Cb4F88ddB7fD5E
const _addresses = {
	gnosisSingleton: "0xd9db270c1b5e3bd161e8c8503c55ceabee709552",
	gnosisFallbackLibrary: "0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4",
	gnosisMultisendLibrary: "0xa238cbeb142c10ef7ad8442c6d1f9e89e07e7761",
	poster: "0x000000000000cd17345801aa8147b8D3950260FF",
	gnosisSafeProxyFactory: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
	moduleProxyFactory: "0x00000000062c52e29e8029dc2413172f6d619d85",
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
	5: 'Goerli',
	1: 'mainnet',
	137: 'matic',
	42: 'kovan',
	100: 'gnosis'
};

const networkCurrency = {
	4: 'ETH',
	5: 'ETH',
	1: 'ETH',
	137: 'matic',
	42: 'ETH',
	100: 'xDai'
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
	
	console.log('start deploy');

	const LootFactory = await ethers.getContractFactory('Loot')
    const lootSingleton = (await LootFactory.deploy())
	await lootSingleton.deployed();
	console.log('loot deploy');
	console.log('lootSingleton',lootSingleton.address)
	const SharesFactory = await ethers.getContractFactory('Shares')
    const sharesSingleton = (await SharesFactory.deploy())
	await sharesSingleton.deployed();
	console.log('shares deploy');
	console.log('sharesSingleton',sharesSingleton.address)

    const BaalFactory = await ethers.getContractFactory('Baal')
    const baalSingleton = (await BaalFactory.deploy())
	await baalSingleton.deployed();

	console.log('baal deploy');
	console.log('baalSingleton',baalSingleton.address)

	const BaalSummoner = await ethers.getContractFactory('BaalSummoner')
	

    const baalSummoner = (await BaalSummoner.deploy(
		baalSingleton.address, 
		_addresses.gnosisSingleton, 
		_addresses.gnosisFallbackLibrary, 
		_addresses.gnosisMultisendLibrary,
		_addresses.gnosisSafeProxyFactory,
		_addresses.moduleProxyFactory,
		lootSingleton.address,
		sharesSingleton.address))
    
	await baalSummoner.deployed();

	const txHash = baalSummoner.deployTransaction.hash;
	const receipt = await deployer.provider.getTransactionReceipt(txHash);
	console.log('Transaction Hash:', txHash);
	console.log('Factory Contract Address:', baalSummoner.address);
	console.log('Block Number:', receipt.blockNumber);
	console.log('full verify params:', baalSummoner.address, 
	baalSingleton.address, 
	_addresses.gnosisSingleton, 
	_addresses.gnosisFallbackLibrary, 
	_addresses.gnosisMultisendLibrary,
	_addresses.gnosisSafeProxyFactory,
	_addresses.moduleProxyFactory,
	lootSingleton.address,
	sharesSingleton.address);
	}


main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});