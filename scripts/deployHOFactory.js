const { ethers, upgrades } = require('hardhat');
const { deployments } = require('../src/addresses/deployed');

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
// moduleProxyFactory https://github.com/gnosis/zodiac/blob/master/src/factory/constants.ts#L21
const _addresses = {
	gnosisSingleton: "0xd9db270c1b5e3bd161e8c8503c55ceabee709552",
	gnosisFallbackLibrary: "0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4",
	gnosisMultisendLibrary: "0xa238cbeb142c10ef7ad8442c6d1f9e89e07e7761",
	poster: "0x000000000000cd17345801aa8147b8D3950260FF",
	gnosisSafeProxyFactory: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
	moduleProxyFactory: "0x00000000000DC7F163742Eb4aBEf650037b1f588",
	DAO: "0x4A9a27d614a74Ee5524909cA27bdBcBB7eD3b315" // Change to Daohaus protocol zodiac baal avatar
	}

	// optimism
	// Safe singleton: 0x69f4D1788e39c87893C980c06EdF4b7f686e2938 
	// fall back: 0x017062a1dE2FE6b99BE3d9d37841FeD19F573804	
	// multisend: 0x998739BFdAAdde7C933B942a68053933098f9EDa
	// GnosisSafeProxyFactory: 0xC22834581EbC8527d974F8a1c97E1bEA4EF910BC
	// DAO: "0x1aCFF11474B9C6D15966Da7A08eD23438CDE23D4"



const _shares = ['1']; 
const _loot = ['1'];
const _minVoting = 60;
const _maxVoting = 600;
const _proposalOffering = 1;
const _name = "TestBaal";
const _symbol = "BAALTO";

const networkName = {
	4: 'Rinkeby',
	5: 'goerli',
	1: 'mainnet',
	137: 'polygon',
	80001: 'polygonMumbai',
	42: 'kovan',
	100: 'gnosisChain',
	42161: 'arbitrumOne',
	10: 'optimisticEthereum'
};

const networkCurrency = {
	4: 'ETH',
	5: 'ETH',
	1: 'ETH',
	137: 'matic',
	80001: 'matic',
	42: 'ETH',
	100: 'xDai',
	42161: 'ETH',
	10: 'ETH'
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

	// const tx = await deployer.sendTransaction({
	// 	to:_addresses.DAO,
	// 	value: ethers.utils.parseEther("0.3")
	// }
	// )

	// console.log('return funds', tx);
	
	console.log('start deploy');

    const baalSummonerAddress = deployments[0]["v103"][networkName[chainId]].addresses.factory;
	console.log('Summoner Address:', baalSummonerAddress);
	const BaalAdvTokenSummoner = await ethers.getContractFactory('BaalAdvTokenSummoner')
	

	// deploy proxy upgrades
	baalSummoner = await upgrades.deployProxy(BaalAdvTokenSummoner);
	await baalSummoner.deployed();
	console.log('Factory Contract Address:', baalSummoner.address);
	console.log('imp:', await upgrades.erc1967.getImplementationAddress(baalSummoner.address));
	
	
	// baalSummoner = BaalAdvTokenSummoner.attach("0x8a4A9E36106Ee290811B89e06e2faFE913507965");
	// set addresses of templates and libraries
	await baalSummoner.setSummonerAddr(baalSummonerAddress);
  
	// transfer ownership to DAO
	if(_addresses.DAO=="0x0000000000000000000000000000000000000000"){
		console.log("You need to transfer ownership of summoner");
	} else {
		console.log("transffering ownership too: ", _addresses.DAO);
		await baalSummoner.transferOwnership(_addresses.DAO);
	}


	const txHash = baalSummoner.deployTransaction.hash;
	const receipt = await deployer.provider.getTransactionReceipt(txHash);
	console.log('Transaction Hash:', txHash);
	console.log('Block Number:', receipt.blockNumber);


	}


main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});