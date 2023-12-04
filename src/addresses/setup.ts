import { constants } from 'ethers';
import { Network } from 'hardhat/types';
import { DeploymentsExtension } from 'hardhat-deploy/types';
import {
    getCompatibilityFallbackHandlerDeployment,
    getMultiSendDeployment,
    getProxyFactoryDeployment,
    getSafeSingletonDeployment,
} from 'safe-deployments';
import { ContractVersions, SupportedNetworks } from '@gnosis.pm/zodiac';

export type ContractSetup = {
    gnosisSingleton: string;
    gnosisFallbackLibrary: string;
    gnosisMultisendLibrary: string;
    poster: string;
    gnosisSafeProxyFactory: string;
    moduleProxyFactory: string;
    DAO: string;
}

const DAO_ADDRESS: {[name: string]: string} = {
    mainnet: "0x4A9a27d614a74Ee5524909cA27bdBcBB7eD3b315",
    goerli: "0x4A9a27d614a74Ee5524909cA27bdBcBB7eD3b315",
    sepolia: "0x1aCFF11474B9C6D15966Da7A08eD23438CDE23D4",
    gnosis: "0x4A9a27d614a74Ee5524909cA27bdBcBB7eD3b315",
    polygon: "0x4A9a27d614a74Ee5524909cA27bdBcBB7eD3b315",
    polygonMumbai: "0x4A9a27d614a74Ee5524909cA27bdBcBB7eD3b315",
    arbitrumOne: "0x4A9a27d614a74Ee5524909cA27bdBcBB7eD3b315",
    optimisticEthereum: "0x1aCFF11474B9C6D15966Da7A08eD23438CDE23D4",
    base: "0x1aCFF11474B9C6D15966Da7A08eD23438CDE23D4",
};

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

    const filter = { network: chainId, version: '1.3.0' };

    const gnosisSingleton = getSafeSingletonDeployment(filter)?.networkAddresses[chainId];
    const gnosisFallbackLibrary = getCompatibilityFallbackHandlerDeployment(filter)?.networkAddresses[chainId];
    const gnosisMultisendLibrary = getMultiSendDeployment(filter)?.networkAddresses[chainId];
    const gnosisSafeProxyFactory = getProxyFactoryDeployment(filter)?.networkAddresses[chainId];
    let moduleProxyFactory = Object.values(SupportedNetworks).includes(Number(chainId))
        ? ContractVersions[Number(chainId) as SupportedNetworks]?.factory?.['1.2.0']
        : undefined;
    // TODO:  Base network is not officially supported by the Zodiac SDK
    if (chainId === '8453') moduleProxyFactory = '0x000000000000aDdB49795b0f9bA5BC298cDda236';
    const poster = '0x000000000000cd17345801aa8147b8D3950260FF';

    if (!gnosisSingleton || !gnosisFallbackLibrary || !gnosisMultisendLibrary || !gnosisSafeProxyFactory)
        throw new Error(`Safe infra not found for network ${network.name}`);
    if (!moduleProxyFactory)
        throw new Error(`Zodiac infra not found for network ${network.name}`);

    return {
        gnosisSingleton,
        gnosisFallbackLibrary,
        gnosisMultisendLibrary,
        gnosisSafeProxyFactory,
        moduleProxyFactory,
        poster,
        DAO: DAO_ADDRESS[network.name],
    };
};
