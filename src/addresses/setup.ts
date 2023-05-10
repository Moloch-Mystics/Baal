import { constants } from 'ethers';
import { Network } from 'hardhat/types';
import { DeploymentsExtension } from 'hardhat-deploy/types';

export type ContractSetup = {
    gnosisSingleton: string;
    gnosisFallbackLibrary: string;
    gnosisMultisendLibrary: string;
    poster: string;
    gnosisSafeProxyFactory: string;
    moduleProxyFactory: string;
    DAO: string;
}

export const getSetupAddresses = async (
    chainId: string,
    network: Network,
    deployments?: DeploymentsExtension
): Promise<ContractSetup> => {

    if (network.name === 'hardhat') {
        if (!deployments) throw Error(`Must specify contract deployments for ${network.name} network`);
        return {
            gnosisSingleton: (await deployments.get('GnosisSafe'))?.address,
            gnosisFallbackLibrary: (await deployments.get('CompatibilityFallbackHandler'))?.address,
            gnosisMultisendLibrary: (await deployments.get('MultiSend'))?.address,
            poster: (await deployments?.get('Poster')).address,
            gnosisSafeProxyFactory: (await deployments.get('GnosisSafeProxyFactory'))?.address,
            moduleProxyFactory: (await deployments.get('ModuleProxyFactory'))?.address,
            DAO: constants.AddressZero,
        };
    }

    // same default for all networks, but different sometimes
    // https://github.com/gnosis/zodiac/blob/master/src/factory/constants.ts#L20
    // https://github.com/safe-global/safe-deployments/tree/main/src/assets
    // moduleProxyFactory https://github.com/gnosis/zodiac/blob/master/src/factory/constants.ts#L21

    if (chainId !== '10') { // Optimism
        return {
            gnosisSingleton: "0xd9db270c1b5e3bd161e8c8503c55ceabee709552",
            gnosisFallbackLibrary: "0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4",
            gnosisMultisendLibrary: "0xa238cbeb142c10ef7ad8442c6d1f9e89e07e7761",
            poster: "0x000000000000cd17345801aa8147b8D3950260FF",
            gnosisSafeProxyFactory: "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
            moduleProxyFactory: "0x00000000000DC7F163742Eb4aBEf650037b1f588",
            DAO: "0x4A9a27d614a74Ee5524909cA27bdBcBB7eD3b315" // Change to Daohaus protocol zodiac baal avatar
        };
    }

	// Optimism ONLY
	// Safe singleton: 0x69f4D1788e39c87893C980c06EdF4b7f686e2938 
	// fall back: 0x017062a1dE2FE6b99BE3d9d37841FeD19F573804	
	// multisend: 0x998739BFdAAdde7C933B942a68053933098f9EDa
	// GnosisSafeProxyFactory: 0xC22834581EbC8527d974F8a1c97E1bEA4EF910BC
	// DAO: "0x1aCFF11474B9C6D15966Da7A08eD23438CDE23D4"
    return {
        gnosisSingleton: "0x69f4D1788e39c87893C980c06EdF4b7f686e2938",
        gnosisFallbackLibrary: "0x017062a1dE2FE6b99BE3d9d37841FeD19F573804",
        gnosisMultisendLibrary: "0x998739BFdAAdde7C933B942a68053933098f9EDa",
        poster: "0x000000000000cd17345801aa8147b8D3950260FF",
        gnosisSafeProxyFactory: "0xC22834581EbC8527d974F8a1c97E1bEA4EF910BC",
        moduleProxyFactory: "0x00000000000DC7F163742Eb4aBEf650037b1f588",
        DAO: "0x1aCFF11474B9C6D15966Da7A08eD23438CDE23D4" // Change to Daohaus protocol zodiac baal avatar
    };
};
