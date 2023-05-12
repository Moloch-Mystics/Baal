import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const deployFn: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {

    const { deployments, getNamedAccounts, network } = hre;

	const { deployer } = await getNamedAccounts();

    if (network.name === 'hardhat') {
        console.log('Deploying Safe infra locally...');

        const { deploy } = deployments;

        const multisendDeployed = await deploy('MultiSend', {
            contract: 'MultiSend',
            from: deployer,
            args: [],
            log: false,
        });

        const safeDeployed = await deploy('GnosisSafe', {
            contract: 'GnosisSafe',
            from: deployer,
            args: [],
            log: false,
        });

        const cfhDeployed = await deploy('CompatibilityFallbackHandler', {
            contract: 'CompatibilityFallbackHandler',
            from: deployer,
            args: [],
            log: false,
        });

        const safepfDeployed = await deploy('GnosisSafeProxyFactory', {
            contract: 'GnosisSafeProxyFactory',
            from: deployer,
            args: [],
            log: false,
        });

        const safemfDeployed = await deploy('ModuleProxyFactory', {
            contract: 'ModuleProxyFactory',
            from: deployer,
            args: [],
            log: false,
        });

        console.log('Deployed Safe Infra:\n');
        console.log('Multisend ->', multisendDeployed.address);
        console.log('CompatibilityFallbackHandler ->', cfhDeployed.address);
        console.log('ModuleProxyFactory ->', safemfDeployed.address);
        console.log('Safe Singleton ->', safeDeployed.address);
        console.log('GnosisSafeProxyFactor ->y', safepfDeployed.address);
    }

};

export default deployFn;
deployFn.tags = ['Infra', 'Safe'];
