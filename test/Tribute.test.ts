import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import { use, expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  Baal,
  TestERC20,
  TributeMinion,
  Loot,
  MultiSend,
  CompatibilityFallbackHandler,
  BaalSummoner,
  GnosisSafe,
  Poster,
  Shares,
} from '../src/types';
import { decodeMultiAction, encodeMultiAction } from "../src/util";
import { BigNumber } from "@ethersproject/bignumber";
import { buildContractCall } from "@gnosis.pm/safe-contracts";
import { ContractFactory, ContractTransaction } from "ethers";
import { Test } from "mocha";

use(solidity);

const revertMessages = {
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
  sharesTransferPaused: "!transferable",
  sharesInsufficientBalance:
    "reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)",
};

const zeroAddress = "0x0000000000000000000000000000000000000000";

async function blockTime() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

async function blockNumber() {
  const block = await ethers.provider.getBlock("latest");
  return block.number;
}

async function moveForwardPeriods(periods: number, extra?: number) {
  const goToTime =
    (await blockTime()) +
    defaultDAOSettings.VOTING_PERIOD_IN_SECONDS * periods +
    (extra ? extra : 0);
  await ethers.provider.send("evm_mine", [goToTime]);
  return true;
}

const getNewBaalAddresses = async (
  tx: ContractTransaction
): Promise<{ baal: string; loot: string; safe: string }> => {
  const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
  // console.log({logs: receipt.logs})
  let baalSummonAbi = [
    "event SummonBaal(address indexed baal, address indexed loot, address indexed shares, address safe, address forwarder, uint256 existingAddrs)",
  ];
  let iface = new ethers.utils.Interface(baalSummonAbi);
  let log = iface.parseLog(receipt.logs[receipt.logs.length - 1]);
  const { baal, loot, safe } = log.args;
  return { baal, loot, safe };
};

const defaultDAOSettings = {
  GRACE_PERIOD_IN_SECONDS: 43200,
  VOTING_PERIOD_IN_SECONDS: 432000,
  PROPOSAL_OFFERING: 69,
  SPONSOR_THRESHOLD: 1,
  MIN_RETENTION_PERCENT: 0,
  MIN_STAKING_PERCENT: 0,
  QUORUM_PERCENT: 0,
  TOKEN_NAME: "wrapped ETH",
  TOKEN_SYMBOL: "WETH",
};

const metadataConfig = {
  CONTENT: '{"name":"test"}',
  TAG: "daohaus.summoner.daoProfile",
};

const abiCoder = ethers.utils.defaultAbiCoder;

type DAOSettings = {
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

const getBaalParams = async function (
  baal: Baal,
  poster: Poster,
  config: DAOSettings,
  adminConfig: [boolean, boolean],
  shamans: [string[], number[]],
  shares: [string[], number[]],
  loots: [string[], number[]]
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
    metadataConfig.CONTENT,
    metadataConfig.TAG,
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
        zeroAddress,
        zeroAddress,
        zeroAddress,
        zeroAddress
      ]
    ),
    initalizationActions,
  };
};

describe("Tribute proposal type", function () {
  let baal: Baal;
  let lootSingleton: Loot;
  let LootFactory: ContractFactory;
  let sharesSingleton: Shares;
  let SharesFactory: ContractFactory;
  let ERC20: ContractFactory;
  let lootToken: Loot;
  let sharesToken: Shares;
  let shamanLootToken: Loot;
  let shamanBaal: Baal;
  let applicantBaal: Baal;
  let weth: TestERC20;
  let applicantWeth: TestERC20;
  let multisend: MultiSend;
  let poster: Poster;

  let BaalFactory: ContractFactory;
  let baalSingleton: Baal;
  let baalSummoner: BaalSummoner;
  let gnosisSafeSingleton: GnosisSafe;
  let gnosisSafe: GnosisSafe;

  let Poster: ContractFactory;

  // shaman baals, to test permissions
  let s1Baal: Baal;
  let s2Baal: Baal;
  let s3Baal: Baal;
  let s4Baal: Baal;
  let s5Baal: Baal;
  let s6Baal: Baal;

  let applicant: SignerWithAddress;
  let summoner: SignerWithAddress;
  let shaman: SignerWithAddress;
  let s1: SignerWithAddress;
  let s2: SignerWithAddress;
  let s3: SignerWithAddress;
  let s4: SignerWithAddress;
  let s5: SignerWithAddress;
  let s6: SignerWithAddress;

  let proposal: { [key: string]: any };

  const loot = 500;
  const shares = 100;
  const sharesPaused = false;
  const lootPaused = false;

  const yes = true;
  const no = false;

  const setupBaal = async (
    baal: Baal,
    poster: Poster,
    config: DAOSettings,
    adminConfig: [boolean, boolean],
    shamans: [string[], number[]],
    shares: [string[], number[]],
    loots: [string[], number[]]
  ) => {
    const saltNonce = (Math.random() * 1000).toFixed(0);
    const encodedInitParams = await getBaalParams(
      baal,
      poster,
      config,
      adminConfig,
      shamans,
      shares,
      loots,
    );
    const tx = await baalSummoner.summonBaal(
      encodedInitParams.initParams,
      encodedInitParams.initalizationActions,
      saltNonce,
    );
    return await getNewBaalAddresses(tx);
  };

  this.beforeAll(async function () {
    LootFactory = await ethers.getContractFactory("Loot");
    lootSingleton = (await LootFactory.deploy()) as Loot;
    SharesFactory = await ethers.getContractFactory("Shares");
    sharesSingleton = (await SharesFactory.deploy()) as Shares;
    BaalFactory = await ethers.getContractFactory("Baal");
    baalSingleton = (await BaalFactory.deploy()) as Baal;
    Poster = await ethers.getContractFactory("Poster");
    poster = (await Poster.deploy()) as Poster;
  });

  beforeEach(async function () {
    const GnosisSafe = await ethers.getContractFactory("GnosisSafe");
    const BaalSummoner = await ethers.getContractFactory("BaalSummoner");
    const CompatibilityFallbackHandler = await ethers.getContractFactory(
      "CompatibilityFallbackHandler"
    );
    const BaalContract = await ethers.getContractFactory("Baal");
    const MultisendContract = await ethers.getContractFactory("MultiSend");
    const GnosisSafeProxyFactory = await ethers.getContractFactory(
      "GnosisSafeProxyFactory"
    );
    const ModuleProxyFactory = await ethers.getContractFactory(
      "ModuleProxyFactory"
    );
    [summoner, applicant, shaman, s1, s2, s3, s4, s5, s6] =
      await ethers.getSigners();

    ERC20 = await ethers.getContractFactory("TestERC20");
    weth = (await ERC20.deploy("WETH", "WETH", 10000000)) as TestERC20;
    applicantWeth = weth.connect(applicant);

    await weth.transfer(applicant.address, 1000);

    multisend = (await MultisendContract.deploy()) as MultiSend;
    gnosisSafeSingleton = (await GnosisSafe.deploy()) as GnosisSafe;
    const handler =
      (await CompatibilityFallbackHandler.deploy()) as CompatibilityFallbackHandler;
    const proxy = await GnosisSafeProxyFactory.deploy();
    const moduleProxyFactory = await ModuleProxyFactory.deploy();

    baalSummoner = (await BaalSummoner.deploy(
      baalSingleton.address,
      gnosisSafeSingleton.address,
      handler.address,
      multisend.address,
      proxy.address,
      moduleProxyFactory.address,
      lootSingleton.address,
      sharesSingleton.address,
    )) as BaalSummoner;

    const addresses = await setupBaal(
      baalSingleton,
      poster,
      defaultDAOSettings,
      [sharesPaused, lootPaused],
      [[shaman.address], [7]],
      [
        [summoner.address, applicant.address],
        [shares, shares],
      ],
      [
        [summoner.address, applicant.address],
        [loot, loot],
      ]
    );

    baal = BaalFactory.attach(addresses.baal) as Baal;
    gnosisSafe = BaalFactory.attach(addresses.safe) as GnosisSafe;
    shamanBaal = baal.connect(shaman); // needed to send txns to baal as the shaman
    applicantBaal = baal.connect(applicant); // needed to send txns to baal as the shaman
    s1Baal = baal.connect(s1);
    s2Baal = baal.connect(s2);
    s3Baal = baal.connect(s3);
    s4Baal = baal.connect(s4);
    s5Baal = baal.connect(s5);
    s6Baal = baal.connect(s6);

    const lootTokenAddress = await baal.lootToken();

    lootToken = LootFactory.attach(lootTokenAddress) as Loot;
    shamanLootToken = lootToken.connect(shaman);

    const sharesTokenAddress = await baal.sharesToken();

    sharesToken = SharesFactory.attach(sharesTokenAddress) as Shares;
    shamanLootToken = lootToken.connect(shaman);

    const selfTransferAction = encodeMultiAction(
      multisend,
      ["0x"],
      [baal.address],
      [BigNumber.from(0)],
      [0]
    );

    proposal = {
      flag: 0,
      account: applicant.address,
      data: selfTransferAction,
      details: "all hail baal",
      expiration: 0,
      baalGas: 0,
    };
  });

  describe("Dangerous proposal tribute", function () {
    it("Allows applicant to tribute tokens in exchagne for shares", async function () {
      expect(await weth.balanceOf(gnosisSafe.address)).to.equal(0);

      await applicantWeth.approve(gnosisSafe.address, 100);

      const mintShares = await baal.interface.encodeFunctionData("mintShares", [
        [applicant.address],
        [100],
      ]);
      const sendTribute = await applicantWeth.interface.encodeFunctionData(
        "transferFrom",
        [applicant.address, gnosisSafe.address, 100]
      );

      const encodedProposal = encodeMultiAction(
        multisend,
        [mintShares, sendTribute],
        [baal.address, weth.address],
        [BigNumber.from(0), BigNumber.from(0)],
        [0, 0]
      );
      // const encodedProposal = encodeMultiAction(multisend, [mintShares], [baal.address], [BigNumber.from(0)], [0])

      await baal.submitProposal(
        encodedProposal,
        proposal.expiration,
        0,
        ethers.utils.id(proposal.details),
        {value: defaultDAOSettings.PROPOSAL_OFFERING}
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      await baal.processProposal(1, encodedProposal);
      expect(await weth.balanceOf(gnosisSafe.address)).to.equal(100);
      expect(await sharesToken.balanceOf(applicant.address)).to.equal(200); // current shares plus new shares
    });

    it("EXPLOIT - Allows another proposal to spend tokens intended for tribute", async function () {
      expect(await weth.balanceOf(gnosisSafe.address)).to.equal(0);

      await applicantWeth.approve(gnosisSafe.address, 100);

      const mintShares = await baal.interface.encodeFunctionData("mintShares", [
        [applicant.address],
        [100],
      ]);
      const sendTribute = await applicantWeth.interface.encodeFunctionData(
        "transferFrom",
        [applicant.address, gnosisSafe.address, 100]
      );

      const encodedProposal = encodeMultiAction(
        multisend,
        [mintShares, sendTribute],
        [baal.address, weth.address],
        [BigNumber.from(0), BigNumber.from(0)],
        [0, 0]
      );
      const maliciousProposal = encodeMultiAction(
        multisend,
        [sendTribute],
        [weth.address],
        [BigNumber.from(0)],
        [0]
      );
      // const encodedProposal = encodeMultiAction(multisend, [mintShares], [baal.address], [BigNumber.from(0)], [0])

      await baal.submitProposal(
        encodedProposal,
        proposal.expiration,
        0,
        ethers.utils.id(proposal.details),
        {value: defaultDAOSettings.PROPOSAL_OFFERING}
      );
      await baal.submitProposal(
        maliciousProposal,
        proposal.expiration,
        0,
        ethers.utils.id(proposal.details),
        {value: defaultDAOSettings.PROPOSAL_OFFERING}
      );
      await baal.submitVote(1, no);
      await baal.submitVote(2, yes);
      await moveForwardPeriods(2);
      // await baal.processProposal(1, encodedProposal)
      await baal.processProposal(2, maliciousProposal);
      expect(await weth.balanceOf(gnosisSafe.address)).to.equal(100);
      expect(await sharesToken.balanceOf(applicant.address)).to.equal(100); // only current shares no new ones
    });
  });

  const baalOverride = async (daoSettings: DAOSettings) => {
    const addresses = await setupBaal(
      baalSingleton,
      poster,
      daoSettings,
      [sharesPaused, lootPaused],
      [[shaman.address], [7]],
      [
        [summoner.address, applicant.address],
        [shares + 1, shares],
      ],
      [
        [summoner.address, applicant.address],
        [loot, loot],
      ]
    );
    baal = BaalFactory.attach(addresses.baal) as Baal;
    gnosisSafe = BaalFactory.attach(addresses.safe) as GnosisSafe;
    const sharesTokenAddress = await baal.sharesToken();
    sharesToken = SharesFactory.attach(sharesTokenAddress) as Shares;
  };

  const submitAndProcessTributeProposal = async (
    tributeMinion: TributeMinion,
    baal: Baal,
    applicantAddress: string,
    tributeToken: string,
    tribute: number,
    requestedShares: number,
    requestedLoot: number,
    sponsor: boolean = true,
    proposalId: number = 1,
    proposalOffering: number = 0,
  ) => {
    await tributeMinion.submitTributeProposal(
      baal.address,
      tributeToken,
      tribute,
      requestedShares,
      requestedLoot,
      proposal.expiration,
      proposal.baalGas,
      "tribute",
      {value: proposalOffering},
    );
    if (sponsor) {
      await baal.sponsorProposal(proposalId);
    }
    await baal.submitVote(proposalId, yes);
    await moveForwardPeriods(2);

    const encodedProposal = await tributeMinion.encodeTributeProposal(
      baal.address,
      requestedShares,
      requestedLoot,
      applicantAddress,
      proposalId,
      tributeMinion.address,
    );

    await baal.processProposal(proposalId, encodedProposal);

    const state = await baal.state(proposalId);
    const propStatus = await baal.getProposalStatus(proposalId);
    console.log({ state, propStatus });
  };

  describe("Baal with NO proposal offering - Safe Tribute Proposal", function () {
    let daoConfig: DAOSettings;
    let tributeMinion: TributeMinion;
    this.beforeEach(async function () {
      daoConfig = {
        ...defaultDAOSettings,
        PROPOSAL_OFFERING: 0,
        SPONSOR_THRESHOLD: 0,
      };
      const TributeMinionContract = await ethers.getContractFactory(
        "TributeMinion"
      );
      tributeMinion = (await TributeMinionContract.deploy()) as TributeMinion;
    });

    it("allows external tribute minion to submit share proposal in exchange for tokens", async function () {
      const applicantTributeMinion = tributeMinion.connect(applicant);

      expect(await applicantWeth.balanceOf(gnosisSafe.address)).to.equal(0);
      expect(await applicantWeth.balanceOf(applicant.address)).to.equal(1000);

      const currentShares = await sharesToken.balanceOf(applicant.address);

      await applicantWeth.approve(tributeMinion.address, 10000);

      const tribute = 100;
      const requestedShares = 1234;
      const requestedLoot = 1007;
      await submitAndProcessTributeProposal(
        applicantTributeMinion,
        baal,
        applicant.address,
        applicantWeth.address,
        tribute,
        requestedShares,
        requestedLoot,
        false,
      );

      expect(await sharesToken.balanceOf(applicant.address)).to.equal(
        requestedShares + parseInt(currentShares.toString())
      );
      expect(await applicantWeth.balanceOf(gnosisSafe.address)).to.equal(tribute);
    });

    it("tribute without proposal offering", async function () {
      const currentShares = await sharesToken.balanceOf(applicant.address);

      const applicantTributeMinion = tributeMinion.connect(applicant);

      expect(await applicantWeth.balanceOf(gnosisSafe.address)).to.equal(0);
      expect(await applicantWeth.balanceOf(applicant.address)).to.equal(1000);

      await applicantWeth.approve(tributeMinion.address, 10000);

      const tribute = 100;
      const requestedShares = 1234;
      const requestedLoot = 1007;
      await submitAndProcessTributeProposal(
        applicantTributeMinion,
        baal,
        applicant.address,
        applicantWeth.address,
        tribute,
        requestedShares,
        requestedLoot,
        false,
      );
      expect(await sharesToken.balanceOf(applicant.address)).to.equal(
        requestedShares + parseInt(currentShares.toString())
      );
      expect(await applicantWeth.balanceOf(gnosisSafe.address)).to.equal(tribute);
    });
  });

  describe("Baal with proposal offering - Safe Tribute Proposal", function () {
    let daoConfig: DAOSettings;
    let tributeMinion: TributeMinion;
    this.beforeEach(async function () {
      daoConfig = {
        ...defaultDAOSettings,
        PROPOSAL_OFFERING: 69,
        SPONSOR_THRESHOLD: 101,
      };
      const TributeMinionContract = await ethers.getContractFactory(
        "TributeMinion"
      );
      tributeMinion = (await TributeMinionContract.deploy()) as TributeMinion;
      await baalOverride(daoConfig);
    });

    it("allows external tribute minion to submit share proposal in exchange for tokens", async function () {
      const applicantTributeMinion = tributeMinion.connect(applicant);

      expect(await applicantWeth.balanceOf(gnosisSafe.address)).to.equal(0);
      expect(await applicantWeth.balanceOf(applicant.address)).to.equal(1000);

      const currentShares = await sharesToken.balanceOf(applicant.address);

      await applicantWeth.approve(tributeMinion.address, 10000);

      const tribute = 100;
      const requestedShares = 1234;
      const requestedLoot = 1007;
      const proposalId = 1;
      const proposalOffering = daoConfig.PROPOSAL_OFFERING;
      await submitAndProcessTributeProposal(
        applicantTributeMinion,
        baal,
        applicant.address,
        applicantWeth.address,
        tribute,
        requestedShares,
        requestedLoot,
        true,
        proposalId,
        proposalOffering,
      );

      expect(await sharesToken.balanceOf(applicant.address)).to.equal(
        requestedShares + parseInt(currentShares.toString())
      );
      expect(await applicantWeth.balanceOf(gnosisSafe.address)).to.equal(tribute);
    });

    it("should not fail to tribute without offering", async function () {
      const currentShares = await sharesToken.balanceOf(summoner.address);
      // CONDITION: Member should be able to self-sponsor if shares >= SPONSOR_THRESHOLD
      expect(currentShares.gte(BigNumber.from(daoConfig.SPONSOR_THRESHOLD)));

      const summonerTributeMinion = tributeMinion.connect(summoner);
      const requestedShares = 1234;
      const tribute = 1000;
      const tributeToken = weth.connect(summoner);

      expect(await tributeToken.balanceOf(gnosisSafe.address)).to.equal(0);
      expect(await tributeToken.balanceOf(summoner.address)).to.gte(tribute);

      await tributeToken.approve(tributeMinion.address, tribute);

      await submitAndProcessTributeProposal(
        summonerTributeMinion,
        baal,
        summoner.address,
        tributeToken.address,
        tribute,
        requestedShares,
        0,
        false,
      );

      expect(await sharesToken.balanceOf(summoner.address))
        .to.eq(
          currentShares.add(BigNumber.from(requestedShares)),
        );
    });

    it("fails to tribute without offering", async function () {
      const currentShares = await sharesToken.balanceOf(applicant.address);
      // CONDITION: Member should send tribute if shares < SPONSOR_THRESHOLD
      expect(currentShares.lt(BigNumber.from(daoConfig.SPONSOR_THRESHOLD)));

      const applicantTributeMinion = tributeMinion.connect(applicant);

      expect(await applicantWeth.balanceOf(gnosisSafe.address)).to.equal(0);
      expect(await applicantWeth.balanceOf(applicant.address)).to.equal(1000);

      await applicantWeth.approve(tributeMinion.address, 10000);

      await expect(applicantTributeMinion.submitTributeProposal(
        baal.address,
        applicantWeth.address,
        100,
        1234,
        1007,
        proposal.expiration,
        proposal.baalGas,
        "tribute"
      )).to.be.revertedWith(revertMessages.submitProposalOffering);   
    });
  });
});
