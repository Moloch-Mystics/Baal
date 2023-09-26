import { deployments } from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { Baal, BaalLessShares, BaalSummoner, GnosisSafe, Loot, MockBaal, MultiSend, Poster, Shares, TestERC20, TributeMinion } from '../../src/types';
import { DAOSettings, NewBaalAddresses, NewBaalParams, ProposalParams, ProposalType, SummonSetup, defaultDAOSettings, defaultSummonSetup, setShamanProposal, setupBaal, submitAndProcessProposal } from './baal';
import { BigNumberish, ContractTransaction } from 'ethers';
import { TributeProposalParams, TributeProposalStatus, submitAndProcessTributeProposal } from './tribute';

export type Signer = {
    address: string;
    sharesInitial: number;
    lootInitial: number;
    baal?: Baal;
    loot?: Loot;
    shares?: Shares;
    tributeMinion?: TributeMinion;
    weth?: TestERC20;
    dai?: TestERC20;
  };

export type ProposalHelpers = {
    submitAndProcessProposal: (params: Omit<ProposalParams, "daoSettings">) => Promise<ContractTransaction>,
    submitAndProcessTributeProposal: (params: Omit<TributeProposalParams, "daoSettings">) => Promise<TributeProposalStatus>,
    setShamanProposal: (baal: Baal, multisend: MultiSend, shamanAddress: string, permission: BigNumberish) => Promise<number>,
};

export type BaalSetupType = {
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
    daoSettings: DAOSettings;
    helpers: ProposalHelpers;
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

export type SetupUsersParams = {
    addresses: NewBaalAddresses;
    baal: Baal;
    hre: HardhatRuntimeEnvironment;
};

export type UsersSetup = {
    dai: TestERC20;
    weth: TestERC20;
    signers: { [key: string]: Signer };
}

type BaalSetupOpts = {
    fixtureTags?: Array<string>;
    daoSettings?: Partial<DAOSettings>;
    summonSetupOpts?: Partial<SummonSetup>;
    safeAddress?: `0x${string}`;
    forwarderAddress?: `0x${string}`;
    lootAddress?: `0x${string}`;
    sharesAddress?: `0x${string}`;
    setupBaalOverride?: (params: NewBaalParams) => Promise<NewBaalAddresses>;
    setupUsersOverride?: (params: SetupUsersParams) => Promise<UsersSetup>;
}

export const setupUsersDefault = async ({
    // addresses,
    baal,
    hre,
}: SetupUsersParams) => {
    const { ethers, deployments, getNamedAccounts, getUnnamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const [summoner, applicant, shaman, s1, s2, s3, s4, s5, s6] = await getUnnamedAccounts();

    const tributeMinion = (await ethers.getContract('TributeMinion', deployer)) as TributeMinion;

    const lootTokenAddress = await baal.lootToken();
    const lootToken = (await ethers.getContractAt('Loot', lootTokenAddress)) as Loot;

    const sharesTokenAddress = await baal.sharesToken();
    const sharesToken = (await ethers.getContractAt('Shares', sharesTokenAddress)) as Shares;

    const wethDeployed = await deployments.deploy('TestERC20', {
        from: deployer,
        args: ['WETH', 'WETH', ethers.utils.parseUnits('10000000', 'ether')]
    });

    const daiDeployed = await deployments.deploy('TestERC20', {
        from: deployer,
        args: ['DAI', 'DAI', ethers.utils.parseUnits('10000000', 'ether')]
    });

    const weth = (await ethers.getContractAt('TestERC20', wethDeployed.address, deployer)) as TestERC20;
    await weth.transfer(summoner, 1000);
    await weth.transfer(applicant, 1000);

    const dai = (await ethers.getContractAt('TestERC20', daiDeployed.address, deployer)) as TestERC20;
    await dai.transfer(summoner, ethers.utils.parseUnits('10', 'ether'));
    await dai.transfer(applicant, ethers.utils.parseUnits('10', 'ether'));
    await dai.transfer(s1, ethers.utils.parseUnits('10', 'ether'));
    await dai.transfer(s2, ethers.utils.parseUnits('10', 'ether'));

    return {
        weth,
        dai,
        signers: {
            summoner: {
                address: summoner,
                baal: baal,
                loot: (await ethers.getContractAt('Loot', lootToken.address, summoner)) as Loot,
                lootInitial: (await lootToken.balanceOf(summoner)).toNumber(),
                shares: (await ethers.getContractAt('Shares', sharesTokenAddress, summoner)) as Shares,
                sharesInitial: (await sharesToken.balanceOf(summoner)).toNumber(),
                tributeMinion: (await ethers.getContractAt('TributeMinion', tributeMinion.address, summoner)) as TributeMinion,
                weth: (await ethers.getContractAt('TestERC20', weth.address, summoner)) as TestERC20,
                dai: (await ethers.getContractAt('TestERC20', dai.address, summoner)) as TestERC20,
            },
            applicant: {
                address: applicant,
                baal: (await ethers.getContractAt('Baal', baal.address, applicant)) as Baal,
                loot: (await ethers.getContractAt('Loot', lootToken.address, applicant)) as Loot,
                lootInitial: (await lootToken.balanceOf(applicant)).toNumber(),
                shares: (await ethers.getContractAt('Shares', sharesToken.address, applicant)) as Shares,
                sharesInitial: (await sharesToken.balanceOf(applicant)).toNumber(),
                tributeMinion: (await ethers.getContractAt('TributeMinion', tributeMinion.address, applicant)) as TributeMinion,
                weth: (await ethers.getContractAt('TestERC20', weth.address, applicant)) as TestERC20,
                dai: (await ethers.getContractAt('TestERC20', dai.address, applicant)) as TestERC20,
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
                dai: (await ethers.getContractAt('TestERC20', dai.address, s1)) as TestERC20,
            },
            s2: {
                address: s2,
                baal: (await ethers.getContractAt('Baal', baal.address, s2)) as Baal,
                lootInitial: 0,
                sharesInitial: 0,
                weth: (await ethers.getContractAt('TestERC20', weth.address, s2)) as TestERC20,
                dai: (await ethers.getContractAt('TestERC20', dai.address, s2)) as TestERC20,
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
}

export const baalSetup = deployments.createFixture<BaalSetupType, BaalSetupOpts>(
    async (hre: HardhatRuntimeEnvironment, options?: BaalSetupOpts
) => {
    const { ethers, deployments, getNamedAccounts, getUnnamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const [summoner, applicant, shaman] = await getUnnamedAccounts();

    await deployments.fixture(['Infra', 'TributeMinion', 'BaalSummoner', ...(options?.fixtureTags || [])]); // Deployment Tags

    console.log('baalSetup fixture', options);
    // console.log('deployments', Object.keys(await deployments.all()));

    const loot = options?.summonSetupOpts?.loot || defaultSummonSetup.loot;
    const lootPaused = options?.summonSetupOpts?.lootPaused || defaultSummonSetup.lootPaused;
    const shares = options?.summonSetupOpts?.shares || defaultSummonSetup.shares;
    const sharesPaused = options?.summonSetupOpts?.sharesPaused || defaultSummonSetup.sharesPaused;
    const shamanPermissions = options?.summonSetupOpts?.shamanPermissions || defaultSummonSetup.shamanPermissions;

    const baalSingleton = (await ethers.getContract('Baal', deployer)) as Baal;
    const baalSummoner = (await ethers.getContract('BaalSummoner', deployer)) as BaalSummoner;
    const poster = (await ethers.getContract('Poster', deployer)) as Poster
    const tributeMinion = (await ethers.getContract('TributeMinion', deployer)) as TributeMinion;

    const summonerDist = {
        shares: shares * 2,
        loot,
    };
    const applicantDist = { shares, loot };

    const daoSettings = {
        ...defaultDAOSettings,
        ...options?.daoSettings,
    };

    const setupParams: NewBaalParams = {
        baalSummoner,
        baalSingleton,
        poster,
        config: daoSettings,
        adminConfig: [sharesPaused, lootPaused],
        shamans: [[shaman], [shamanPermissions]],
        shares: [
            [summoner, applicant],
            [summonerDist.shares, applicantDist.shares]
        ],
        loots: [
            [summoner, applicant],
            [summonerDist.loot, applicantDist.loot]
        ],
        safeAddress: options?.safeAddress,
        forwarderAddress: options?.forwarderAddress,
        lootAddress: options?.lootAddress,
        sharesAddress: options?.sharesAddress,
    }; 

    const addresses = options?.setupBaalOverride
        ? await options.setupBaalOverride(setupParams)
        : await setupBaal(setupParams); // use default setup
    // console.log('addresses', addresses);

    const baal = (await ethers.getContractAt('Baal', addresses.baal, summoner)) as Baal;
    const gnosisSafe = (await ethers.getContractAt('GnosisSafe', addresses.safe)) as GnosisSafe;

    const lootTokenAddress = await baal.lootToken();
    const lootToken = (await ethers.getContractAt('Loot', lootTokenAddress)) as Loot;

    const sharesTokenAddress = await baal.sharesToken();
    const sharesToken = (await ethers.getContractAt('Shares', sharesTokenAddress)) as Shares;

    const {
        dai,
        weth,
        signers,
    } = options?.setupUsersOverride
        ? await options.setupUsersOverride({ addresses, baal, hre })
        : await setupUsersDefault({ addresses, baal, hre });

    return {
        daoSettings,
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
        signers,
        helpers: {
            setShamanProposal: (baal, multisend, shamanAddress, permission) => {
                return setShamanProposal(baal, multisend, shamanAddress, permission, daoSettings);
            },
            submitAndProcessProposal: (params) => {
                return submitAndProcessProposal({ ...params, daoSettings });
            },
            submitAndProcessTributeProposal(params) {
                return submitAndProcessTributeProposal({ ...params, daoSettings });
            },
        }
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
