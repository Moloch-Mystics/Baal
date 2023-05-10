import { deployments } from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { Baal, BaalLessShares, BaalSummoner, GnosisSafe, Loot, MockBaal, MultiSend, Poster, Shares, TestERC20, TributeMinion } from '../../src/types';
import { DAOSettings, defaultDAOSettings, defaultSummonSetup, setupBaal } from './baal';

export type Signer = {
    address: string;
    sharesInitial: number;
    lootInitial: number;
    baal?: Baal;
    loot?: Loot;
    shares?: Shares;
    tributeMinion?: TributeMinion;
    weth?: TestERC20;
  };

type BaalSetupType = {
    Loot: Loot;
    Shares: Shares;
    Baal: Baal;
    BaalSummoner: BaalSummoner;
    GnosisSafe: GnosisSafe;
    MultiSend: MultiSend;
    Poster?: Poster;
    TributeMinion: TributeMinion;
    WETH: TestERC20;
    DAI: TestERC20;
    signers: {
        [key: string]: Signer;
    };
}

type MockBaalSetupType = {
    Loot: Loot;
    LootSingleton: Loot;
    MockBaal: MockBaal;
    signers: {
        [key: string]: Signer;
    };
}

type MockBaalLessTokenSetupType = {
    BaalLessShares: BaalLessShares;
}

type BaalSetupOpts = {
    daoSettings?: Partial<DAOSettings>;
    safeAddress?: `0x${string}`,
    forwarderAddress?: `0x${string}`,
    lootAddress?: `0x${string}`,
    sharesAddress?: `0x${string}`,
}

export const baalSetup = deployments.createFixture<BaalSetupType, BaalSetupOpts>(
    async (hre: HardhatRuntimeEnvironment, options?: BaalSetupOpts
) => {
    const { ethers, deployments, getNamedAccounts, getUnnamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const [summoner, applicant, shaman, s1, s2, s3, s4, s5, s6] = await getUnnamedAccounts();

    await deployments.fixture(['Infra', 'TributeMinion', 'BaalSummoner']); // Deployment Tags

    console.log('baalSetup fixture', options);
    // console.log('deployments', Object.keys(await deployments.all()));

    // TODO: check if set on fixture options
    const loot = defaultSummonSetup.loot;
    const lootPaused = defaultSummonSetup.lootPaused;
    const shares = defaultSummonSetup.shares;
    const sharesPaused = defaultSummonSetup.sharesPaused;

    const shamanPermissions = defaultSummonSetup.shamanPermissions;
    

    const baalSingleton = (await ethers.getContract('Baal', deployer)) as Baal;
    const baalSummoner = (await ethers.getContract('BaalSummoner', deployer)) as BaalSummoner;
    const poster = (await ethers.getContract('Poster', deployer)) as Poster
    const tributeMinion = (await ethers.getContract('TributeMinion', deployer)) as TributeMinion;

    const summonerDist = {
        shares: shares * 2,
        loot,
    };
    const applicantDist = { shares, loot };

    const addresses = await setupBaal(
        baalSummoner,
        baalSingleton,
        poster,
        {
            ...defaultDAOSettings,
            ...options?.daoSettings,
        },
        [sharesPaused, lootPaused],
        [[shaman], [shamanPermissions]],
        [
            [summoner, applicant],
            [summonerDist.shares, applicantDist.shares]
        ],
        [
            [summoner, applicant],
            [summonerDist.loot, applicantDist.loot]
        ],
        options?.safeAddress,
        options?.forwarderAddress,
        options?.lootAddress,
        options?.sharesAddress,
    );
    // console.log('addresses', addresses);


    const baal = (await ethers.getContractAt('Baal', addresses.baal, summoner)) as Baal;
    const gnosisSafe = (await ethers.getContractAt('GnosisSafe', addresses.safe)) as GnosisSafe;

    const lootTokenAddress = await baal.lootToken();
    const lootToken = (await ethers.getContractAt('Loot', lootTokenAddress)) as Loot;

    const sharesTokenAddress = await baal.sharesToken();
    const sharesToken = (await ethers.getContractAt('Shares', sharesTokenAddress)) as Shares;

    const wethDeployed = await deployments.deploy('TestERC20', {
        from: deployer,
        args: ['WETH', 'WETH', 10000000]
    });

    const daiDeployed = await deployments.deploy('TestERC20', {
        from: deployer,
        args: ['DAI', 'DAI', 10000000]
    });

    const weth = (await ethers.getContractAt('TestERC20', wethDeployed.address, deployer)) as TestERC20;
    await weth.transfer(summoner, 1000);
    await weth.transfer(applicant, 1000);

    const dai = (await ethers.getContractAt('TestERC20', daiDeployed.address, deployer)) as TestERC20;

    return {
        Loot: lootToken,
        Shares: sharesToken,
        // Baal: (await ethers.getContract('Baal', deployer)) as Baal,
        Baal: baal,
        BaalSummoner: baalSummoner,
        GnosisSafe: gnosisSafe,
        MultiSend: (await ethers.getContract('MultiSend', deployer)) as MultiSend,
        // Poster: poster,
        TributeMinion: tributeMinion,
        WETH: weth,
        DAI: dai,
        signers: {
            summoner: {
                address: summoner,
                baal: baal,
                loot: (await ethers.getContractAt('Loot', lootToken.address, summoner)) as Loot,
                lootInitial: summonerDist.loot,
                shares: (await ethers.getContractAt('Shares', sharesTokenAddress, summoner)) as Shares,
                sharesInitial: summonerDist.shares,
                tributeMinion: (await ethers.getContractAt('TributeMinion', tributeMinion.address, summoner)) as TributeMinion,
                weth: (await ethers.getContractAt('TestERC20', weth.address, summoner)) as TestERC20,
            },
            applicant: {
                address: applicant,
                baal: (await ethers.getContractAt('Baal', baal.address, applicant)) as Baal,
                loot: (await ethers.getContractAt('Loot', lootToken.address, applicant)) as Loot,
                lootInitial: applicantDist.loot,
                shares: (await ethers.getContractAt('Shares', sharesToken.address, applicant)) as Shares,
                sharesInitial: applicantDist.shares,
                tributeMinion: (await ethers.getContractAt('TributeMinion', tributeMinion.address, applicant)) as TributeMinion,
                weth: (await ethers.getContractAt('TestERC20', weth.address, applicant)) as TestERC20,
            },
            shaman: {
                address: shaman,
                baal: (await ethers.getContractAt('Baal', baal.address, shaman)) as Baal,
                loot: (await ethers.getContractAt('Loot', lootToken.address, shaman)) as Loot,
                lootInitial: 0,
                sharesInitial: 0,
                shares: (await ethers.getContractAt('Shares', sharesToken.address, shaman)) as Shares,
            },
            s1: {
                address: s1,
                baal: (await ethers.getContractAt('Baal', baal.address, s1)) as Baal,
                lootInitial: 0,
                sharesInitial: 0,
                weth: (await ethers.getContractAt('TestERC20', weth.address, s1)) as TestERC20,
            },
            s2: {
                address: s2,
                baal: (await ethers.getContractAt('Baal', baal.address, s2)) as Baal,
                lootInitial: 0,
                sharesInitial: 0,
            },
            s3: {
                address: s3,
                baal: (await ethers.getContractAt('Baal', baal.address, s3)) as Baal,
                lootInitial: 0,
                sharesInitial: 0,
            },
            s4: {
                address: s4,
                baal: (await ethers.getContractAt('Baal', baal.address, s4)) as Baal,
                lootInitial: 0,
                sharesInitial: 0,
            },
            s5: {
                address: s5,
                baal: (await ethers.getContractAt('Baal', baal.address, s5)) as Baal,
                lootInitial: 0,
                sharesInitial: 0,
            },
            s6: {
                address: s6,
                baal: (await ethers.getContractAt('Baal', baal.address, s6)) as Baal,
                lootInitial: 0,
                sharesInitial: 0,
            },

        },
    };


}, 'setupBaal');

export const mockBaalSetup = deployments.createFixture<MockBaalSetupType, unknown>(
    async (hre: HardhatRuntimeEnvironment, options?: unknown
) => {
    const { ethers, deployments, getNamedAccounts, getUnnamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const [summoner, , , s1, s2] = await getUnnamedAccounts();

    await deployments.fixture(['Infra', 'BaalSummoner']);

    const lootSingleton = (await ethers.getContract('Loot', deployer)) as Loot;
    await deployments.deploy('MockBaal', {
        contract: 'MockBaal',
        from: deployer,
        args: [
            lootSingleton.address,
            'NAME',
            'SYMBOL'
        ],
        log: false,
    });

    const mockBaal = (await ethers.getContract('MockBaal', deployer)) as MockBaal;
    const lootTokenAddress = await mockBaal.lootToken();
    await mockBaal.mintLoot(summoner, 500);

    return {
        Loot: (await ethers.getContractAt('Loot', lootTokenAddress)) as Loot,
        LootSingleton: lootSingleton,
        MockBaal: mockBaal,
        signers: {
            summoner: {
                address: summoner,
                loot: (await ethers.getContractAt('Loot', lootTokenAddress, summoner)) as Loot,
                lootInitial: 0,
                sharesInitial: 0,
                
            },
            s1: {
                address: s1,
                loot: (await ethers.getContractAt('Loot', lootTokenAddress, s1)) as Loot,
                lootInitial: 0,
                sharesInitial: 0,
            },
            s2: {
                address: s2,
                loot: (await ethers.getContractAt('Loot', lootTokenAddress, s2)) as Loot,
                lootInitial: 0,
                sharesInitial: 0,
            },
        }
    };
}, 'setupMockBaal');

export const mockBaalLessSharesSetup = deployments.createFixture<MockBaalLessTokenSetupType, unknown>(
    async (hre: HardhatRuntimeEnvironment, options?: unknown
) => {
    const { ethers, deployments, getNamedAccounts, getUnnamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const [summoner] = await getUnnamedAccounts();

    // await deployments.fixture(['Infra', 'BaalSummoner']);

    await deployments.deploy('BaalLessShares', {
        contract: 'BaalLessShares',
        from: deployer,
        args: [],
        log: false,
    });

    const baalLessSharesSingleton = (await ethers.getContract('BaalLessShares', deployer)) as BaalLessShares;

    return {
        BaalLessShares: baalLessSharesSingleton,
    };
}, 'setupBaalLessShares');
