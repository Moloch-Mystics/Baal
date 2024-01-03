import { expect } from 'chai';
import { BigNumber, BigNumberish, Contract, ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';

import { Baal, BaalSummoner, MultiSend, Poster } from '../../src/types';
import { encodeMultiAction } from '../../src/util';
import { moveForwardPeriods } from './evm';

export type DAOSettings = {
    PROPOSAL_OFFERING: any;
    GRACE_PERIOD_IN_SECONDS: any;
    VOTING_PERIOD_IN_SECONDS: any;
    QUORUM_PERCENT: any;
    SPONSOR_THRESHOLD: any;
    MIN_RETENTION_PERCENT: any;
    MIN_STAKING_PERCENT: any;
    TOKEN_NAME: any;
    TOKEN_SYMBOL: any;
};

export const abiCoder = ethers.utils.defaultAbiCoder;

export const revertMessages = {
    molochAlreadyInitialized: "Initializable: contract is already initialized",
    molochConstructorSharesCannotBe0: "shares cannot be 0",
    molochConstructorVotingPeriodCannotBe0: "votingPeriod cannot be 0",
    submitProposalExpired: "expired",
    submitProposalOffering: "Baal requires an offering",
    submitProposalVotingPeriod: "!votingPeriod",
    submitProposalArrays: "!array parity",
    submitProposalArrayMax: "array max",
    submitProposalFlag: "!flag",
    sponsorProposalExpired: "expired",
    sponsorProposalSponsor: "!sponsor",
    sponsorProposalExists: "!exist",
    sponsorProposalSponsored: "sponsored",
    submitVoteNotSponsored: "!sponsored",
    submitVoteTimeEnded: "ended",
    submitVoteVoted: "voted",
    submitVoteMember: "!member",
    submitVoteWithSigTimeEnded: "ended",
    submitVoteWithSigVoted: "voted",
    submitVoteWithSigMember: "!member",
    proposalMisnumbered: "!exist",
    unsetGuildTokensLastToken:
      "reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)",
    sharesTransferPaused: "shares: !transferable",
    sharesInsufficientBalance:
      "ERC20: transfer amount exceeds balance",

    // -----
    lootAlreadyInitialized: "Initializable: contract is already initialized",
    molochSetupSharesNoShares: "shares != 0",
    proposalNotSponsored: "!sponsor",
    sponsorProposalNotSubmitted: "!submitted",
    submitVoteNotVoting: "!voting",
    processProposalNotReady: "!ready",
    ragequitUnordered: "!order",
    // unsetGuildTokensLastToken: 'reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)',
    sharesInsufficientApproval: "ERC20: insufficient allowance", // Error: Transaction reverted without a reason string
    lootTransferPaused: "loot: !transferable",
    lootInsufficientBalance:
      "ERC20: transfer amount exceeds balance",
    // lootInsufficientApproval: 'reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)',
    lootInsufficientApproval: "ERC20: insufficient allowance", // Error: Transaction reverted without a reason string
    mintSharesArrayParity: "!array parity",
    burnSharesArrayParity: "!array parity",
    burnSharesInsufficientShares: "ERC20: burn amount exceeds balance",
    mintLootArrayParity: "!array parity",
    burnLootArrayParity: "!array parity",
    burnLootInsufficientShares:
      "ERC20: burn amount exceeds balance",
    cancelProposalNotVoting: "!voting",
    cancelProposalNotCancellable: "!cancellable",
    baalOrAdmin: "!baal & !admin",
    baalOrManager: "!baal & !manager",
    baalOrGovernor: "!baal & !governor",
    permitNotAuthorized: "!authorized",
    permitExpired: "expired",
    notEnoughGas: "not enough gas",
    baalGasToHigh: "baalGas to high",
    OwnableCallerIsNotTheOwner: "Ownable: caller is not the owner",
};

export type ProposalType = {
    flag: BigNumberish;
    account?: `0x${string}`;
    data: string;
    details: string;
    expiration: BigNumberish;
    baalGas: BigNumberish;
};
  
export const PROPOSAL_STATES = {
    UNBORN: 0,
    SUBMITTED: 1,
    VOTING: 2,
    CANCELLED: 3,
    GRACE: 4,
    READY: 5,
    PROCESSED: 6,
    DEEFEATED: 7,
};

export enum SHAMAN_PERMISSIONS {
    NONE,
    ADMIN,
    MANAGER,
    ADMIN_MANAGER,
    GOVERNANCE,
    ADMIN_GOVERNANCE,
    MANAGER_GOVERNANCE,
    ALL,
};

export const defaultDAOSettings: DAOSettings = {
    GRACE_PERIOD_IN_SECONDS: 43200,
    VOTING_PERIOD_IN_SECONDS: 432000,
    PROPOSAL_OFFERING: 0,
    SPONSOR_THRESHOLD: 1,
    MIN_RETENTION_PERCENT: 0,
    MIN_STAKING_PERCENT: 0,
    QUORUM_PERCENT: 0,
    TOKEN_NAME: "wrapped ETH",
    TOKEN_SYMBOL: "WETH",
};

export const defaultMetadataConfig = {
    CONTENT: '{"name":"test"}',
    TAG: "daohaus.summoner.daoProfile",
};

export const defaultProposalSettings = {
    DETAILS: 'all hail baal',
    EXPIRATION: 0,
    BAAL_GAS: 0,
};

export type SummonSetup = {
    loot: number;
    lootPaused: boolean;
    shamanPermissions: SHAMAN_PERMISSIONS;
    shares: number;
    sharesPaused: boolean;
};

export const defaultSummonSetup: SummonSetup = {
    loot: 500,
    lootPaused: false,
    shamanPermissions: SHAMAN_PERMISSIONS.ALL,
    shares: 100,
    sharesPaused: false,
};

export type NewBaalParams = {
    baalSummoner: Contract;
    baalSingleton: Baal;
    poster: Poster;
    config: DAOSettings;
    adminConfig: [boolean, boolean];
    shamans: [string[], number[]];
    shares: [string[], number[]];
    loots: [string[], number[]];
    safeAddress?: `0x${string}`;
    forwarderAddress?: `0x${string}`;
    lootAddress?: `0x${string}`;
    sharesAddress?: `0x${string}`;
    saltNonceOverride?: string;
}

export type NewBaalAddresses = {
    baal: string;
    loot: string;
    shares: string;
    safe: string;
}

export const getNewBaalAddresses = async (tx: ContractTransaction): Promise<NewBaalAddresses> => {
    const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
    // console.log({logs: receipt.logs})
    let baalSummonAbi = [
        "event SummonBaal(address indexed baal, address indexed loot, address indexed shares, address safe, address forwarder, uint256 existingAddrs)",
    ];
    let iface = new ethers.utils.Interface(baalSummonAbi);
    let log = iface.parseLog(receipt.logs[receipt.logs.length - 1]);
    const { baal, loot, shares, safe } = log.args;
    return { baal, loot, shares, safe };
};

export const getBaalParams = async function (
    baal: Baal,
    poster: Poster,
    config: DAOSettings,
    adminConfig: [boolean, boolean],
    shamans: [string[], number[]],
    shares: [string[], number[]],
    loots: [string[], number[]],
    safeAddress: string = ethers.constants.AddressZero,
    forwarderAddress: string = ethers.constants.AddressZero,
    lootAddress: string = ethers.constants.AddressZero,
    sharesAddress: string = ethers.constants.AddressZero,
) {
    const governanceConfig = abiCoder.encode(
        ["uint32", "uint32", "uint256", "uint256", "uint256", "uint256"],
        [
            config.VOTING_PERIOD_IN_SECONDS,
            config.GRACE_PERIOD_IN_SECONDS,
            config.PROPOSAL_OFFERING,
            config.QUORUM_PERCENT,
            config.SPONSOR_THRESHOLD,
            config.MIN_RETENTION_PERCENT,
        ]
    );

    const setAdminConfig = await baal.interface.encodeFunctionData(
        "setAdminConfig",
        adminConfig
    );
    const setGovernanceConfig = await baal.interface.encodeFunctionData(
        "setGovernanceConfig",
        [governanceConfig]
    );
    const setShaman = await baal.interface.encodeFunctionData(
        "setShamans",
        shamans
    );
    const mintShares = await baal.interface.encodeFunctionData(
        "mintShares",
        shares
    );
    const mintLoot = await baal.interface.encodeFunctionData("mintLoot", loots);
    const postMetaData = await poster.interface.encodeFunctionData("post", [
        defaultMetadataConfig.CONTENT,
        defaultMetadataConfig.TAG,
    ]);
    const posterFromBaal = await baal.interface.encodeFunctionData(
        "executeAsBaal",
        [poster.address, 0, postMetaData]
    );

    const initalizationActions = [
        setAdminConfig,
        setGovernanceConfig,
        setShaman,
        mintShares,
        mintLoot,
        posterFromBaal,
    ];

    return {
        initParams: abiCoder.encode(
            ["string", "string", "address", "address", "address", "address"],
            [
                config.TOKEN_NAME,
                config.TOKEN_SYMBOL,
                safeAddress,
                forwarderAddress,
                lootAddress,
                sharesAddress,
            ],
        ),
        initalizationActions,
    };
};

// export const setupBaal = async (params: NewBaalParams) => {
export const setupBaal = async ({
    baalSummoner,
    baalSingleton,
    poster,
    config,
    adminConfig,
    shamans,
    shares,
    loots,
    safeAddress,
    forwarderAddress,
    lootAddress,
    sharesAddress,
    saltNonceOverride
}: NewBaalParams) => {
    const saltNonce = saltNonceOverride || (Math.random() * 1000).toFixed(0);
    const encodedInitParams = await getBaalParams(
        baalSingleton,
        poster,
        config,
        adminConfig,
        shamans,
        shares,
        loots,
        safeAddress,
        forwarderAddress,
        lootAddress,
        sharesAddress,
    );
    const tx = await (baalSummoner as BaalSummoner).summonBaal(
        encodedInitParams.initParams,
        encodedInitParams.initalizationActions,
        saltNonce,
    );
    return await getNewBaalAddresses(tx);
};

export type ProposalParams = {
    baal: Baal;
    encodedAction: string;
    proposal: ProposalType;
    proposalId?: BigNumberish;
    daoSettings?: DAOSettings;
    extraSeconds?: number;
};

export const submitAndProcessProposal = async ({
    baal,
    encodedAction,
    proposal,
    proposalId,
    daoSettings = defaultDAOSettings,
    extraSeconds = 2,
  }: ProposalParams) => {
    await baal.submitProposal(encodedAction, proposal.expiration, proposal.baalGas, ethers.utils.id(proposal.details));
    const id = proposalId ? proposalId : await baal.proposalCount();
    await baal.submitVote(id, true);
    await moveForwardPeriods(daoSettings.VOTING_PERIOD_IN_SECONDS, extraSeconds);
    return await baal.processProposal(id, encodedAction);
  };
  
export const setShamanProposal = async (
    baal: Baal,
    multisend: MultiSend,
    shamanAddress: string,
    permission: BigNumberish,
    daoSettings = defaultDAOSettings,
    extraSeconds = 2,
) => {
    const setShaman = baal.interface.encodeFunctionData('setShamans', [
      [shamanAddress],
      [permission],
    ]);
    const setShamanAction = encodeMultiAction(
      multisend,
      [setShaman],
      [baal.address],
      [BigNumber.from(0)],
      [0]
    );
  
    // ----
    await baal.submitProposal(setShamanAction, 0, 0, '');
    const proposalId = await baal.proposalCount();
    await baal.submitVote(proposalId, true);
    await moveForwardPeriods(daoSettings.VOTING_PERIOD_IN_SECONDS, extraSeconds);
    await baal.processProposal(proposalId, setShamanAction);
    return proposalId;
};

export const verifyProposal = (prop1: any, prop2: any, overrides?: any) => {
    for (let key in prop1) {
      if (Number.isInteger(+key)) {
        continue;
      }
      if (overrides && key in overrides) {
        // console.log('override', key)
        expect(prop1[key]).to.equal(overrides[key]);
      } else {
        // console.log('check', key)
        expect(prop1[key]).to.equal(prop2[key]);
      }
    }
};
