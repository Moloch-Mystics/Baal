import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import { use, expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { Shares } from "../src/types/Shares";

import { Baal } from "../src/types/Baal";
import { BaalSummoner } from "../src/types/BaalSummoner";
import { Poster } from "../src/types/Poster";
import { GnosisSafe } from "../src/types/GnosisSafe";
import { CompatibilityFallbackHandler } from "../src/types/CompatibilityFallbackHandler";
import { GnosisSafeProxy } from "../src/types/GnosisSafeProxy";
import { TestErc20 } from "../src/types/TestErc20";
import { Loot } from "../src/types/Loot";
import {
  decodeMultiAction,
  encodeMultiAction,
  hashOperation,
} from "../src/util";
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { buildContractCall } from "@gnosis.pm/safe-contracts";
import { MultiSend } from "../src/types/MultiSend";
import { ContractFactory, ContractTransaction, utils } from "ethers";
import { ConfigExtender } from "hardhat/types";
import { Test } from "mocha";
import signVote from "../src/signVote";
import signDelegation from "../src/signDelegation";
import signPermit from "../src/signPermit";
import { string } from "hardhat/internal/core/params/argumentTypes";

import { GnosisSafeProxyFactory } from "../src/types/GnosisSafeProxyFactory";
import { ModuleProxyFactory } from "../src/types/ModuleProxyFactory";

use(solidity);

// chai
//   .use(require('chai-as-promised'))
//   .should();

const revertMessages = {
  molochAlreadyInitialized: "Initializable: contract is already initialized",
  lootAlreadyInitialized: "Initializable: contract is already initialized",
  molochSetupSharesNoShares: "shares != 0",
  submitProposalExpired: "expired",
  submitProposalOffering: "Baal requires an offering",
  submitVoteTimeEnded: "ended",
  sponsorProposalExpired: "expired",
  sponsorProposalSponsor: "!sponsor",
  sponsorProposalNotSubmitted: "!submitted",
  submitVoteNotSponsored: "!sponsored",
  submitVoteNotVoting: "!voting",
  submitVoteVoted: "voted",
  submitVoteMember: "!member",
  submitVoteWithSigTimeEnded: "ended",
  submitVoteWithSigVoted: "voted",
  submitVoteWithSigMember: "!member",
  processProposalNotReady: "!ready",
  ragequitUnordered: "!order",
  // unsetGuildTokensLastToken: 'reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)',
  sharesTransferPaused: "!transferable",
  sharesInsufficientBalance: "ERC20: transfer amount exceeds balance",
  sharesInsufficientApproval: "", // Error: Transaction reverted without a reason string
  lootTransferPaused: "!transferable",
  lootInsufficientBalance:
    "reverted with reason string 'ERC20: transfer amount exceeds balance'",
  // lootInsufficientApproval: 'reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)',
  lootInsufficientApproval: "", // Error: Transaction reverted without a reason string
  mintSharesArrayParity: "!array parity",
  burnSharesArrayParity: "!array parity",
  burnSharesInsufficientShares: "ERC20: burn amount exceeds balance",
  mintLootArrayParity: "!array parity",
  burnLootArrayParity: "!array parity",
  burnLootInsufficientShares:
    "reverted with reason string 'ERC20: burn amount exceeds balance'",
  cancelProposalNotVoting: "!voting",
  cancelProposalNotCancellable: "!cancellable",
  baalOrAdmin: "!baal & !admin",
  baalOrManager: "!baal & !manager",
  baalOrGovernor: "!baal & !governor",
  permitNotAuthorized: "!authorized",
  permitExpired: "expired",
  notEnoughGas: "not enough gas",
};

const STATES = {
  UNBORN: 0,
  SUBMITTED: 1,
  VOTING: 2,
  CANCELLED: 3,
  GRACE: 4,
  READY: 5,
  PROCESSED: 6,
  DEEFEATED: 7,
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
    deploymentConfig.VOTING_PERIOD_IN_SECONDS * periods +
    (extra ? extra : 0);
  await ethers.provider.send("evm_mine", [goToTime]);
  return true;
}

const deploymentConfig = {
  GRACE_PERIOD_IN_SECONDS: 43200,
  VOTING_PERIOD_IN_SECONDS: 432000,
  PROPOSAL_OFFERING: 0,
  SPONSOR_THRESHOLD: 1,
  MIN_RETENTION_PERCENT: 0,
  MIN_STAKING_PERCENT: 0,
  QUORUM_PERCENT: 0,
  TOKEN_NAME: "Baal Shares",
  TOKEN_SYMBOL: "BAAL",
};

const metadataConfig = {
  CONTENT: '{"name":"test"}',
  TAG: "daohaus.summoner.daoProfile",
};

const abiCoder = ethers.utils.defaultAbiCoder;

const getBaalParams = async function (
  baal: Baal,
  multisend: MultiSend,
  lootSingleton: Loot,
  sharesSingleton: Shares,
  poster: Poster,
  config: {
    PROPOSAL_OFFERING: any;
    GRACE_PERIOD_IN_SECONDS: any;
    VOTING_PERIOD_IN_SECONDS: any;
    QUORUM_PERCENT: any;
    SPONSOR_THRESHOLD: any;
    MIN_RETENTION_PERCENT: any;
    MIN_STAKING_PERCENT: any;
    TOKEN_NAME: any;
    TOKEN_SYMBOL: any;
  },
  metadata: [string, string],
  adminConfig: [boolean, boolean],
  shamans: [string[], number[]],
  shares: [string[], number[]],
  loots: [string[], number[]],
  safeAddr?: string,
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

  // console.log('mint shares', shares);

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
    mintLoot,
    mintShares,
    posterFromBaal,
  ];

  // const initalizationActionsMulti = encodeMultiAction(
  //   multisend,
  //   [setAdminConfig, setGovernanceConfig, setGuildTokens, setShaman, mintShares, mintLoot],
  //   [baal.address, baal.address, baal.address, baal.address, baal.address, baal.address],
  //   [BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0)],
  //   [0, 0, 0, 0, 0, 0]
  // )
  return {
    initParams: abiCoder.encode(
      ["string", "string", "address", "address", "address"],
      [
        config.TOKEN_NAME,
        config.TOKEN_SYMBOL,
        lootSingleton.address,
        sharesSingleton.address,
        multisend.address,
      ]
    ),
    initalizationActions,
    safeAddr
  };
};

const getNewBaalAddresses = async (
  tx: ContractTransaction
): Promise<{ baal: string; loot: string; shares: string; safe: string }> => {
  const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
  let baalSummonAbi = [
    "event SummonBaal(address indexed baal, address indexed loot, address indexed shares, address safe)",
  ];
  let iface = new ethers.utils.Interface(baalSummonAbi);
  let log = iface.parseLog(receipt.logs[receipt.logs.length - 1]);
  const { baal, loot, shares, safe } = log.args;
  return { baal, loot, shares, safe };
};

const verifyProposal = function (prop1: any, prop2: any, overrides?: any) {
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

const setShamanProposal = async function (
  baal: Baal,
  multisend: MultiSend,
  shaman: SignerWithAddress,
  permission: BigNumberish
) {
  const setShaman = await baal.interface.encodeFunctionData("setShamans", [
    [shaman.address],
    [permission],
  ]);
  const setShamanAction = encodeMultiAction(
    multisend,
    [setShaman],
    [baal.address],
    [BigNumber.from(0)],
    [0]
  );
  await baal.submitProposal(setShamanAction, 0, 0, "");
  const proposalId = await baal.proposalCount();
  await baal.submitVote(proposalId, true);
  await moveForwardPeriods(2);
  await baal.processProposal(proposalId, setShamanAction);
  return proposalId;
};

describe("Baal contract", function () {
  let baal: Baal;
  let baalSingleton: Baal;
  let baalAsShaman: Baal;
  let baalSummoner: BaalSummoner;
  let poster: Poster;
  let lootSingleton: Loot;
  let LootFactory: ContractFactory;
  let sharesSingleton: Shares;
  let SharesFactory: ContractFactory;
  let BaalFactory: ContractFactory;
  let Poster: ContractFactory;
  let ERC20: ContractFactory;
  let lootToken: Loot;
  let sharesToken: Shares;
  let shamanLootToken: Loot;
  let summonerSharesToken: Shares;
  let shamanBaal: Baal;
  let shamanSharesToken: Shares;
  let applicantBaal: Baal;
  let weth: TestErc20;
  let weth2: TestErc20;
  let applicantWeth: TestErc20;
  let multisend: MultiSend;

  let GnosisSafe: ContractFactory;
  let gnosisSafeSingleton: GnosisSafe;
  let gnosisSafe: GnosisSafe;

  let GnosisSafeProxyFactory: ContractFactory;
  let gnosisSafeProxyFactory: GnosisSafeProxyFactory;

  let ModuleProxyFactory: ContractFactory;
  let moduleProxyFactory: ModuleProxyFactory;

  let signingShaman: SignerWithAddress;
  let chainId: number;

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

  let encodedInitParams: {
    initParams: string;
    initalizationActions: string[];
  };

  const shares = 100;
  const loot = 500;
  const sharesPaused = false;
  const lootPaused = false;

  const yes = true;
  const no = false;

  async function submitAndProcessProposal(
    baalAsAddress: Baal,
    action: any,
    proposalId: BigNumberish
  ) {
    const encodedAction = encodeMultiAction(
      multisend,
      [action],
      [baalAsAddress.address],
      [BigNumber.from(0)],
      [0]
    );
    await baalAsAddress.submitProposal(
      encodedAction,
      proposal.expiration,
      proposal.baalGas,
      ethers.utils.id(proposal.details)
    );
    await baalAsAddress.submitVote(proposalId, true);
    await moveForwardPeriods(2);
    return await baalAsAddress.processProposal(proposalId, encodedAction);
  }

  this.beforeAll(async function () {
    LootFactory = await ethers.getContractFactory("Loot");
    lootSingleton = (await LootFactory.deploy()) as Loot;
    SharesFactory = await ethers.getContractFactory("Shares");
    sharesSingleton = (await SharesFactory.deploy()) as Shares;
    BaalFactory = await ethers.getContractFactory("Baal");
    baalSingleton = (await BaalFactory.deploy()) as Baal;
    Poster = await ethers.getContractFactory("Poster");
    poster = (await Poster.deploy()) as Poster;
    const network = await ethers.provider.getNetwork();
    chainId = network.chainId;
  });

  beforeEach(async function () {
    const BaalContract = await ethers.getContractFactory("Baal");
    const GnosisSafe = await ethers.getContractFactory("GnosisSafe");
    const BaalSummoner = await ethers.getContractFactory("BaalSummoner");

    const GnosisSafeProxyFactory = await ethers.getContractFactory(
      "GnosisSafeProxyFactory"
    );
    const ModuleProxyFactory = await ethers.getContractFactory(
      "ModuleProxyFactory"
    );

    const CompatibilityFallbackHandler = await ethers.getContractFactory(
      "CompatibilityFallbackHandler"
    );
    const MultisendContract = await ethers.getContractFactory("MultiSend");
    [summoner, applicant, shaman, signingShaman, s1, s2, s3, s4, s5, s6] =
      await ethers.getSigners();

    ERC20 = await ethers.getContractFactory("TestERC20");
    weth = (await ERC20.deploy("WETH", "WETH", 10000000)) as TestErc20;
    weth2 = (await ERC20.deploy("WETH2", "WETH2", 10000000)) as TestErc20;
    applicantWeth = weth.connect(applicant);

    multisend = (await MultisendContract.deploy()) as MultiSend;
    gnosisSafeSingleton = (await GnosisSafe.deploy()) as GnosisSafe;
    const handler =
      (await CompatibilityFallbackHandler.deploy()) as CompatibilityFallbackHandler;

    const proxy = await GnosisSafeProxyFactory.deploy();
    moduleProxyFactory =
      (await ModuleProxyFactory.deploy()) as ModuleProxyFactory;

    baalSummoner = (await BaalSummoner.deploy(
      baalSingleton.address,
      gnosisSafeSingleton.address,
      handler.address,
      multisend.address,
      proxy.address,
      moduleProxyFactory.address
    )) as BaalSummoner;

    encodedInitParams = await getBaalParams(
      baalSingleton,
      multisend,
      lootSingleton,
      sharesSingleton,
      poster,
      deploymentConfig,
      [metadataConfig.CONTENT, metadataConfig.TAG],
      [sharesPaused, lootPaused],
      [[shaman.address], [7]],
      [[summoner.address], [shares]],
      [[summoner.address], [loot]]
    );

    const tx = await baalSummoner.summonBaalAndSafe(
      encodedInitParams.initParams,
      encodedInitParams.initalizationActions,
      101
    );
    const addresses = await getNewBaalAddresses(tx);

    // console.log('addresses', addresses);

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

    // const lootTokenAddress = await baal.lootToken()

    lootToken = LootFactory.attach(addresses.loot) as Loot;
    sharesToken = SharesFactory.attach(addresses.shares) as Shares;
    shamanLootToken = lootToken.connect(shaman);
    shamanSharesToken = sharesToken.connect(shaman);
    summonerSharesToken = sharesToken.connect(summoner);

    const selfTransferAction = encodeMultiAction(
      multisend,
      ["0x"],
      [gnosisSafe.address],
      [BigNumber.from(0)],
      [0]
    );

    proposal = {
      flag: 0,
      account: summoner.address,
      data: selfTransferAction,
      details: "all hail baal",
      expiration: 0,
      baalGas: 0,
    };

    baalAsShaman = baal.connect(signingShaman);
  });

  describe("constructor", function () {
    it("verify deployment parameters", async function () {
      const now = await blockTime();

      // const decimals = await baal.decimals()
      // expect(decimals).to.equal(18)

      const gracePeriod = await baal.gracePeriod();
      expect(gracePeriod).to.equal(deploymentConfig.GRACE_PERIOD_IN_SECONDS);

      const votingPeriod = await baal.votingPeriod();
      expect(votingPeriod).to.equal(deploymentConfig.VOTING_PERIOD_IN_SECONDS);

      const proposalOffering = await baal.proposalOffering();
      expect(proposalOffering).to.equal(deploymentConfig.PROPOSAL_OFFERING);

      // const symbol = await baal.symbol()
      // expect(symbol).to.equal(deploymentConfig.TOKEN_SYMBOL)

      const lootPaused = await baal.lootPaused();
      expect(lootPaused).to.be.false;

      const sharesPaused = await baal.sharesPaused();
      expect(sharesPaused).to.be.false;

      const shamans = await baal.shamans(shaman.address);
      expect(shamans).to.be.equal(7);

      const summonerLoot = await lootToken.balanceOf(summoner.address);
      expect(summonerLoot).to.equal(loot);

      const summonerVotes = await baal.getCurrentVotes(summoner.address);
      expect(summonerVotes).to.equal(shares); // shares = 100

      const summonerSelfDelegates = await sharesToken.delegates(
        summoner.address
      );
      expect(summonerSelfDelegates).to.equal(summoner.address);

      const summonerShares = await sharesToken.balanceOf(summoner.address);
      expect(summonerShares).to.equal(shares);

      const totalLoot = await baal.totalLoot();
      expect(totalLoot).to.equal(loot); // loot = 500

      const avatar = await baal.avatar();
      const target = await baal.target();
    });

    // it('stuff', function () {
    //   const encoded =
    //     '0x8d80ff0a000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000002cb0028d91005050fdca5dfccadd886313561f3ea4d3600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044056b0dcd000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028d91005050fdca5dfccadd886313561f3ea4d36000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c44526d846000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000001f40028d91005050fdca5dfccadd886313561f3ea4d36000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c40f656a210000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000010000000000000000000000003c44cdddb6a900fa2b585dd299e03d12fa4293bc00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000007000000000000000000000000000000000000000000'
    //   const decoded = decodeMultiAction(multisend, encoded)
    //   console.log({ decoded })
    // })
  });
  describe("shaman actions - permission level 7 (full)", function () {
    it("setAdminConfig", async function () {
      await shamanBaal.setAdminConfig(true, true);
      expect(await shamanBaal.sharesPaused()).to.equal(true);
      expect(await shamanBaal.lootPaused()).to.equal(true);
    });

    it("mint shares - recipient has shares", async function () {
      await shamanBaal.mintShares([summoner.address], [69]);
      // expect(await shamansharesToken.balanceOf(summoner.address)).to.equal(169)
      expect(await sharesToken.balanceOf(summoner.address)).to.equal(169);
      const votes = await baal.getCurrentVotes(summoner.address);
      expect(votes).to.equal(169);
      // const totalShares = await baal.totalSupply()
      const totalShares = await baal.totalShares();
      expect(totalShares).to.equal(169);
    });

    it("mint shares - new recipient", async function () {
      await shamanBaal.mintShares([shaman.address], [69]);
      const now = await blockTime();
      expect(await sharesToken.balanceOf(shaman.address)).to.equal(69);

      const votes = await baal.getCurrentVotes(shaman.address);
      expect(votes).to.equal(69);

      const shamanDelegate = await sharesToken.delegates(shaman.address);
      expect(shamanDelegate).to.equal(shaman.address);
    });

    it("mint shares - recipient has delegate - new shares are also delegated", async function () {
      await sharesToken.delegate(shaman.address);
      const t1 = await blockTime();
      await shamanBaal.mintShares([summoner.address], [69]);

      expect(await sharesToken.balanceOf(summoner.address)).to.equal(169);

      const summonerVotes = await baal.getCurrentVotes(summoner.address);
      expect(summonerVotes).to.equal(0);

      const shamanVotes = await baal.getCurrentVotes(shaman.address);
      expect(shamanVotes).to.equal(169);

      const summonerDelegate = await sharesToken.delegates(summoner.address);
      expect(summonerDelegate).to.equal(shaman.address);
    });

    it("mint shares - zero mint amount - no votes", async function () {
      await shamanBaal.mintShares([shaman.address], [0]);
      const now = await blockTime();
      expect(await sharesToken.balanceOf(shaman.address)).to.equal(0);
      const votes = await baal.getCurrentVotes(shaman.address);
      expect(votes).to.equal(0);
      const totalShares = await sharesToken.totalSupply();
      expect(totalShares).to.equal(100);

      const shamanVotes = await baal.getCurrentVotes(shaman.address);
      expect(shamanVotes).to.equal(0);

      const shamanDelegate = await sharesToken.delegates(shaman.address);
      expect(shamanDelegate).to.equal(zeroAddress);
    });

    it("mint shares - require fail - array parity", async function () {
      await expect(
        shamanBaal.mintShares([summoner.address], [69, 69])
      ).to.be.revertedWith(revertMessages.mintSharesArrayParity);
    });

    it("burn shares", async function () {
      await shamanBaal.burnShares([summoner.address], [69]);
      expect(await sharesToken.balanceOf(summoner.address)).to.equal(31);
    });

    it("burn shares - require fail - array parity", async function () {
      await expect(
        shamanBaal.burnShares([summoner.address], [69, 69])
      ).to.be.revertedWith(revertMessages.burnSharesArrayParity);
    });

    it("burn shares - require fail - insufficent shares", async function () {
      await expect(
        shamanBaal.burnShares([summoner.address], [101])
      ).to.be.revertedWith(revertMessages.burnSharesInsufficientShares);
    });

    it("mint loot", async function () {
      await shamanBaal.mintLoot([summoner.address], [69]);
      expect(await lootToken.balanceOf(summoner.address)).to.equal(569);
      expect(await baal.totalLoot()).to.equal(569);
    });

    it("mint loot - require fail - array parity", async function () {
      await expect(
        shamanBaal.mintLoot([summoner.address], [69, 69])
      ).to.be.revertedWith(revertMessages.mintSharesArrayParity);
    });

    it("burn loot", async function () {
      await shamanBaal.burnLoot([summoner.address], [69]);
      expect(await lootToken.balanceOf(summoner.address)).to.equal(431);
      expect(await baal.totalLoot()).to.equal(431);
    });

    it("burn loot - require fail - array parity", async function () {
      await expect(
        shamanBaal.burnLoot([summoner.address], [69, 69])
      ).to.be.revertedWith(revertMessages.burnLootArrayParity);
    });

    it("burn loot - require fail - insufficent shares", async function () {
      await expect(
        shamanBaal.burnLoot([summoner.address], [501])
      ).to.be.revertedWith(revertMessages.burnLootInsufficientShares);
    });

    it("have shaman mint and burn _delegated_ shares", async function () {
      const minting = 100;

      expect(await sharesToken.balanceOf(applicant.address)).to.equal(0);

      // mint shares for a separate member than the summoner
      await shamanBaal.mintShares([applicant.address], [minting]);

      expect(await sharesToken.balanceOf(applicant.address)).to.equal(minting);
      expect(await sharesToken.delegates(applicant.address)).to.equal(
        applicant.address
      );
      expect(await baal.getCurrentVotes(applicant.address)).to.equal(minting);
      expect(await baal.getCurrentVotes(summoner.address)).to.equal(shares);

      // delegate shares from applicant to the summoner
      const baalAsApplicant = sharesToken.connect(applicant);

      await expect(baalAsApplicant.delegate(summoner.address))
        .to.emit(sharesToken, "DelegateChanged")
        .withArgs(applicant.address, applicant.address, summoner.address)
        .to.emit(sharesToken, "DelegateVotesChanged")
        .withArgs(summoner.address, shares, shares + minting);

      expect(await sharesToken.balanceOf(applicant.address)).to.equal(minting);
      expect(await sharesToken.delegates(applicant.address)).to.equal(
        summoner.address
      );
      expect(await baal.getCurrentVotes(applicant.address)).to.equal(0);
      expect(await baal.getCurrentVotes(summoner.address)).to.equal(
        shares + minting
      );

      // mint shares for the delegator
      await expect(shamanBaal.mintShares([applicant.address], [minting]))
        .to.emit(sharesToken, "DelegateVotesChanged")
        .withArgs(summoner.address, shares + minting, shares + 2 * minting);

      expect(await sharesToken.balanceOf(applicant.address)).to.equal(
        2 * minting
      );
      expect(await sharesToken.delegates(applicant.address)).to.equal(
        summoner.address
      );
      expect(await baal.getCurrentVotes(applicant.address)).to.equal(0);
      expect(await baal.getCurrentVotes(summoner.address)).to.equal(
        shares + 2 * minting
      );

      // burn shares for the delegator
      await shamanBaal.burnShares([applicant.address], [minting]);

      expect(await sharesToken.balanceOf(applicant.address)).to.equal(minting);
      expect(await sharesToken.delegates(applicant.address)).to.equal(
        summoner.address
      );
      expect(await baal.getCurrentVotes(applicant.address)).to.equal(0);
      expect(await baal.getCurrentVotes(summoner.address)).to.equal(
        shares + minting
      );
    });

    it("setGovernanceConfig", async function () {
      const governanceConfig = abiCoder.encode(
        ["uint32", "uint32", "uint256", "uint256", "uint256", "uint256"],
        [10, 20, 50, 1, 2, 3]
      );

      await shamanBaal.setGovernanceConfig(governanceConfig);
      const voting = await baal.votingPeriod();
      const grace = await baal.gracePeriod();
      const offering = await baal.proposalOffering();
      const quorum = await baal.quorumPercent();
      const sponsorThreshold = await baal.sponsorThreshold();
      const minRetentionPercent = await baal.minRetentionPercent();
      expect(voting).to.be.equal(10);
      expect(grace).to.be.equal(20);
      expect(offering).to.be.equal(50);
      expect(quorum).to.be.equal(1);
      expect(sponsorThreshold).to.be.equal(2);
      expect(minRetentionPercent).to.equal(3);
    });

    it("setGovernanceConfig - doesnt set voting/grace if =0", async function () {
      const governanceConfig = abiCoder.encode(
        ["uint32", "uint32", "uint256", "uint256", "uint256", "uint256"],
        [0, 0, 50, 1, 2, 3]
      );

      await shamanBaal.setGovernanceConfig(governanceConfig);
      const voting = await baal.votingPeriod();
      const grace = await baal.gracePeriod();
      const offering = await baal.proposalOffering();
      const quorum = await baal.quorumPercent();
      const sponsorThreshold = await baal.sponsorThreshold();
      const minRetentionPercent = await baal.minRetentionPercent();
      expect(voting).to.be.equal(deploymentConfig.VOTING_PERIOD_IN_SECONDS);
      expect(grace).to.be.equal(deploymentConfig.GRACE_PERIOD_IN_SECONDS);
      expect(offering).to.be.equal(50);
      expect(quorum).to.be.equal(1);
      expect(sponsorThreshold).to.be.equal(2);
      expect(minRetentionPercent).to.equal(3);
    });

    it("cancelProposal - happy case - as gov shaman", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await shamanBaal.cancelProposal(1); // cancel as gov shaman
      const state = await baal.state(1);
      expect(state).to.equal(STATES.CANCELLED);
    });

    it("cancelProposal - happy case - as proposal sponsor", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.cancelProposal(1); // cancel as sponsor
      const state = await baal.state(1);
      expect(state).to.equal(STATES.CANCELLED);
    });

    // TODO: get prior votes is 100 and threshold is 1
    it("cancelProposal - happy case - after undelegation", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await sharesToken.transfer(shamanBaal.address, shares); // transfer all shares/votes to shaman
      await applicantBaal.cancelProposal(1); // cancel as rando
      const state = await baal.state(1);
      expect(state).to.equal(STATES.CANCELLED);
    });

    it("cancelProposal - require fail - not cancellable by rando", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      expect(applicantBaal.cancelProposal(1)).to.be.revertedWith(
        revertMessages.cancelProposalNotCancellable
      );
    });

    it("cancelProposal - require fail - !voting (submitted)", async function () {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      const state = await baal.state(1);
      expect(state).to.equal(STATES.SUBMITTED);
      await expect(baal.cancelProposal(1)).to.be.revertedWith(
        revertMessages.cancelProposalNotVoting
      );
    });

    it("cancelProposal - require fail - !voting (grace)", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await moveForwardPeriods(1, 1); // add 1 extra second to push us into grace period
      const state = await baal.state(1);
      expect(state).to.equal(STATES.GRACE);
      await expect(baal.cancelProposal(1)).to.be.revertedWith(
        revertMessages.cancelProposalNotVoting
      );
    });

    it("cancelProposal - require fail - !voting (defeated)", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await moveForwardPeriods(2);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.DEEFEATED);
      await expect(baal.cancelProposal(1)).to.be.revertedWith(
        revertMessages.cancelProposalNotVoting
      );
    });

    it("cancelProposal - require fail - !voting (cancelled)", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.cancelProposal(1);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.CANCELLED);
      await expect(baal.cancelProposal(1)).to.be.revertedWith(
        revertMessages.cancelProposalNotVoting
      );
    });

    it("cancelProposal - require fail - !voting (ready)", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, true);
      await moveForwardPeriods(2);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.READY);
      await expect(baal.cancelProposal(1)).to.be.revertedWith(
        revertMessages.cancelProposalNotVoting
      );
    });

    it("cancelProposal - require fail - !voting (processed)", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, true);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.PROCESSED);
      await expect(baal.cancelProposal(1)).to.be.revertedWith(
        revertMessages.cancelProposalNotVoting
      );
    });
  });

  describe("shaman permissions: 0-6", function () {
    const governanceConfig = abiCoder.encode(
      ["uint32", "uint32", "uint256", "uint256", "uint256", "uint256"],
      [10, 20, 50, 1, 2, 3]
    );

    beforeEach(async function () {
      const shamanAddresses = [
        shaman.address,
        s1.address,
        s2.address,
        s3.address,
        s4.address,
        s5.address,
        s6.address,
      ];
      const permissions = [0, 1, 2, 3, 4, 5, 6];
      const setShaman = await baal.interface.encodeFunctionData("setShamans", [
        shamanAddresses,
        permissions,
      ]);
      const setShamanAction = encodeMultiAction(
        multisend,
        [setShaman],
        [baal.address],
        [BigNumber.from(0)],
        [0]
      );
      proposal.data = setShamanAction;
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, true);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      const shamanPermission = await baal.shamans(shaman.address);
      expect(shamanPermission).to.equal(0);
    });

    it("permission = 0 - all actions fail", async function () {
      // admin
      await expect(shamanBaal.setAdminConfig(true, true)).to.be.revertedWith(
        revertMessages.baalOrAdmin
      );

      // manager
      await expect(
        shamanBaal.mintShares([shaman.address], [69])
      ).to.be.revertedWith(revertMessages.baalOrManager);
      await expect(
        shamanBaal.burnShares([shaman.address], [69])
      ).to.be.revertedWith(revertMessages.baalOrManager);
      await expect(
        shamanBaal.mintLoot([shaman.address], [69])
      ).to.be.revertedWith(revertMessages.baalOrManager);
      await expect(
        shamanBaal.burnLoot([shaman.address], [69])
      ).to.be.revertedWith(revertMessages.baalOrManager);

      // governor
      await expect(
        shamanBaal.setGovernanceConfig(governanceConfig)
      ).to.be.revertedWith(revertMessages.baalOrGovernor);

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await expect(shamanBaal.cancelProposal(2)).to.be.revertedWith(
        revertMessages.cancelProposalNotCancellable
      );
    });

    it("permission = 1 - admin actions succeed", async function () {
      // admin - success
      await s1Baal.setAdminConfig(true, true);
      expect(await s1Baal.sharesPaused()).to.equal(true);
      expect(await s1Baal.lootPaused()).to.equal(true);

      // manager - fail
      expect(s1Baal.mintShares([s1.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );
      expect(s1Baal.burnShares([s1.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );
      expect(s1Baal.mintLoot([s1.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );
      expect(s1Baal.burnLoot([s1.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );

      // governor - fail
      expect(s1Baal.setGovernanceConfig(governanceConfig)).to.be.revertedWith(
        revertMessages.baalOrGovernor
      );

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      expect(s1Baal.cancelProposal(2)).to.be.revertedWith(
        revertMessages.cancelProposalNotCancellable
      );
    });

    it("permission = 2 - manager actions succeed", async function () {
      // admin - fail
      expect(s2Baal.setAdminConfig(true, true)).to.be.revertedWith(
        revertMessages.baalOrAdmin
      );

      // manager - success
      await s2Baal.mintShares([s2.address], [69]);
      expect(await sharesToken.balanceOf(s2.address)).to.equal(69);
      await s2Baal.burnShares([s2.address], [69]);
      expect(await sharesToken.balanceOf(s2.address)).to.equal(0);
      await s2Baal.mintLoot([s2.address], [69]);
      expect(await lootToken.balanceOf(s2.address)).to.equal(69);
      await s2Baal.burnLoot([s2.address], [69]);
      expect(await lootToken.balanceOf(s2.address)).to.equal(0);

      await s2Baal.mintShares([summoner.address], [100]); // cleanup - mint summoner shares so they can submit/sponsor

      // governor - fail
      expect(s2Baal.setGovernanceConfig(governanceConfig)).to.be.revertedWith(
        revertMessages.baalOrGovernor
      );

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      expect(s2Baal.cancelProposal(2)).to.be.revertedWith(
        revertMessages.cancelProposalNotCancellable
      );
    });

    it("permission = 3 - admin + manager actions succeed", async function () {
      // admin - success
      await s3Baal.setAdminConfig(true, true);
      expect(await s3Baal.sharesPaused()).to.equal(true);
      expect(await s3Baal.lootPaused()).to.equal(true);

      // manager - success
      await s3Baal.mintShares([s3.address], [69]);
      expect(await sharesToken.balanceOf(s3.address)).to.equal(69);
      await s3Baal.burnShares([s3.address], [69]);
      expect(await sharesToken.balanceOf(s3.address)).to.equal(0);
      await s3Baal.mintLoot([s3.address], [69]);
      expect(await lootToken.balanceOf(s3.address)).to.equal(69);
      await s3Baal.burnLoot([s3.address], [69]);
      expect(await lootToken.balanceOf(s3.address)).to.equal(0);

      await s3Baal.mintShares([summoner.address], [100]); // cleanup - mint summoner shares so they can submit/sponsor

      // governor - fail
      expect(s3Baal.setGovernanceConfig(governanceConfig)).to.be.revertedWith(
        revertMessages.baalOrGovernor
      );

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      expect(s3Baal.cancelProposal(2)).to.be.revertedWith(
        revertMessages.cancelProposalNotCancellable
      );
    });

    it("permission = 4 - governor actions succeed", async function () {
      // admin - fail
      await expect(s4Baal.setAdminConfig(true, true)).to.be.revertedWith(
        revertMessages.baalOrAdmin
      );

      // manager - fail
      await expect(s4Baal.mintShares([s4.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );
      await expect(s4Baal.burnShares([s4.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );
      await expect(s4Baal.mintLoot([s4.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );
      await expect(s4Baal.burnLoot([s4.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );

      // governor - succeed
      await s4Baal.setGovernanceConfig(governanceConfig);
      const voting = await baal.votingPeriod();
      const grace = await baal.gracePeriod();
      const offering = await baal.proposalOffering();
      const quorum = await baal.quorumPercent();
      const sponsorThreshold = await baal.sponsorThreshold();
      expect(voting).to.be.equal(10);
      expect(grace).to.be.equal(20);
      expect(offering).to.be.equal(50);
      expect(quorum).to.be.equal(1);
      expect(sponsorThreshold).to.be.equal(2);

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await s4Baal.cancelProposal(2);
      const state = await baal.state(2);
      expect(state).to.equal(STATES.CANCELLED);
    });

    it("permission = 5 - admin + governor actions succeed", async function () {
      // admin - success
      await s5Baal.setAdminConfig(true, true);
      expect(await s5Baal.sharesPaused()).to.equal(true);
      expect(await s5Baal.lootPaused()).to.equal(true);

      // manager - fail
      expect(s5Baal.mintShares([s5.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );
      expect(s5Baal.burnShares([s5.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );
      expect(s5Baal.mintLoot([s5.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );
      expect(s5Baal.burnLoot([s5.address], [69])).to.be.revertedWith(
        revertMessages.baalOrManager
      );

      // governor - succeed
      await s5Baal.setGovernanceConfig(governanceConfig);
      const voting = await baal.votingPeriod();
      const grace = await baal.gracePeriod();
      const offering = await baal.proposalOffering();
      const quorum = await baal.quorumPercent();
      const sponsorThreshold = await baal.sponsorThreshold();
      expect(voting).to.be.equal(10);
      expect(grace).to.be.equal(20);
      expect(offering).to.be.equal(50);
      expect(quorum).to.be.equal(1);
      expect(sponsorThreshold).to.be.equal(2);

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await s5Baal.cancelProposal(2);
      const state = await baal.state(2);
      expect(state).to.equal(STATES.CANCELLED);
    });

    it("permission = 6 - manager + governor actions succeed", async function () {
      // admin - fail
      expect(s6Baal.setAdminConfig(true, true)).to.be.revertedWith(
        revertMessages.baalOrAdmin
      );

      // manager - success
      await s6Baal.mintShares([s6.address], [69]);
      expect(await sharesToken.balanceOf(s6.address)).to.equal(69);
      await s6Baal.burnShares([s6.address], [69]);
      expect(await sharesToken.balanceOf(s6.address)).to.equal(0);
      await s6Baal.mintLoot([s6.address], [69]);
      expect(await lootToken.balanceOf(s6.address)).to.equal(69);
      await s6Baal.burnLoot([s6.address], [69]);
      expect(await lootToken.balanceOf(s6.address)).to.equal(0);

      await s6Baal.mintShares([summoner.address], [100]); // cleanup - mint summoner shares so they can submit/sponsor

      // governor - succeed
      await s6Baal.setGovernanceConfig(governanceConfig);
      const voting = await baal.votingPeriod();
      const grace = await baal.gracePeriod();
      const offering = await baal.proposalOffering();
      const quorum = await baal.quorumPercent();
      const sponsorThreshold = await baal.sponsorThreshold();
      expect(voting).to.be.equal(10);
      expect(grace).to.be.equal(20);
      expect(offering).to.be.equal(50);
      expect(quorum).to.be.equal(1);
      expect(sponsorThreshold).to.be.equal(2);

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await s6Baal.cancelProposal(2);
      const state = await baal.state(2);
      expect(state).to.equal(STATES.CANCELLED);
    });
  });

  describe("shaman locks", function () {
    it("lockAdmin", async function () {
      const lockAdmin = await baal.interface.encodeFunctionData("lockAdmin");
      const lockAdminAction = encodeMultiAction(
        multisend,
        [lockAdmin],
        [baal.address],
        [BigNumber.from(0)],
        [0]
      );
      proposal.data = lockAdminAction;
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, true);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      expect(await baal.adminLock()).to.equal(true);
    });

    it("lockManager", async function () {
      const lockManager = await baal.interface.encodeFunctionData(
        "lockManager"
      );
      const lockManagerAction = encodeMultiAction(
        multisend,
        [lockManager],
        [baal.address],
        [BigNumber.from(0)],
        [0]
      );
      proposal.data = lockManagerAction;
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, true);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      expect(await baal.managerLock()).to.equal(true);
    });

    it("lockGovernor", async function () {
      const lockGovernor = await baal.interface.encodeFunctionData(
        "lockGovernor"
      );
      const lockGovernorAction = encodeMultiAction(
        multisend,
        [lockGovernor],
        [baal.address],
        [BigNumber.from(0)],
        [0]
      );
      proposal.data = lockGovernorAction;
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, true);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      expect(await baal.governorLock()).to.equal(true);
    });
  });

  describe("setShamans - adminLock (1, 3, 5, 7)", function () {
    beforeEach(async function () {
      const lockAdmin = await baal.interface.encodeFunctionData("lockAdmin");
      const lockAdminAction = encodeMultiAction(
        multisend,
        [lockAdmin],
        [baal.address],
        [BigNumber.from(0)],
        [0]
      );
      proposal.data = lockAdminAction;
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, true);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      expect(await baal.adminLock()).to.equal(true);
    });

    it("setShamans - 0 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 0);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(0);
    });

    it("setShamans - 1 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 1);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 2 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 2);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(2);
    });

    it("setShamans - 3 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 3);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 4 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 4);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(4);
    });

    it("setShamans - 5 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 5);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 6 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 6);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(6);
    });

    it("setShamans - 7 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, summoner, 7); // use summoner bc shaman default = 7
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(summoner.address)).to.equal(0);
    });
  });

  describe("setShamans - managerLock (2, 3, 6, 7)", function () {
    beforeEach(async function () {
      const lockManager = await baal.interface.encodeFunctionData(
        "lockManager"
      );
      const lockManagerAction = encodeMultiAction(
        multisend,
        [lockManager],
        [baal.address],
        [BigNumber.from(0)],
        [0]
      );
      proposal.data = lockManagerAction;
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, true);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      expect(await baal.managerLock()).to.equal(true);
    });

    it("setShamans - 0 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 0);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(0);
    });

    it("setShamans - 1 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 1);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(1);
    });

    it("setShamans - 2 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 2);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 3 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 3);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 4 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 4);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(4);
    });

    it("setShamans - 5 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 5);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(5);
    });

    it("setShamans - 6 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 6);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 7 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, summoner, 7); // use summoner bc shaman default = 7
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(summoner.address)).to.equal(0);
    });
  });

  describe("setShamans - governorLock (4, 5, 6, 7)", function () {
    beforeEach(async function () {
      const lockGovernor = await baal.interface.encodeFunctionData(
        "lockGovernor"
      );
      const lockGovernorAction = encodeMultiAction(
        multisend,
        [lockGovernor],
        [baal.address],
        [BigNumber.from(0)],
        [0]
      );
      proposal.data = lockGovernorAction;
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, true);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      expect(await baal.governorLock()).to.equal(true);
    });

    it("setShamans - 0 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 0);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(0);
    });

    it("setShamans - 1 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 1);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(1);
    });

    it("setShamans - 2 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 2);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(2);
    });

    it("setShamans - 3 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 3);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(3);
    });

    it("setShamans - 4 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 4);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 5 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 5);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 6 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 6);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 7 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, summoner, 7); // use summoner bc shaman default = 7
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(summoner.address)).to.equal(0);
    });
  });

  describe("setShamans - all locked", function () {
    beforeEach(async function () {
      const lockAdmin = await baal.interface.encodeFunctionData("lockAdmin");
      const lockManager = await baal.interface.encodeFunctionData(
        "lockManager"
      );
      const lockGovernor = await baal.interface.encodeFunctionData(
        "lockGovernor"
      );
      const lockAllAction = encodeMultiAction(
        multisend,
        [lockAdmin, lockManager, lockGovernor],
        [baal.address, baal.address, baal.address],
        [BigNumber.from(0), BigNumber.from(0), BigNumber.from(0)],
        [0, 0, 0]
      );
      proposal.data = lockAllAction;
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, true);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      expect(await baal.adminLock()).to.equal(true);
      expect(await baal.managerLock()).to.equal(true);
      expect(await baal.governorLock()).to.equal(true);
    });

    it("setShamans - 0 - success", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 0);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, false]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(0);
    });

    it("setShamans - 1 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 1);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 2 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 2);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 3 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 3);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 4 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 4);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 5 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 5);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 6 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, shaman, 6);
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7);
    });

    it("setShamans - 7 - fail", async function () {
      const id = await setShamanProposal(baal, multisend, summoner, 7); // use summoner bc shaman default = 7
      const propStatus = await baal.getProposalStatus(id);
      expect(propStatus).to.eql([false, true, true, true]); // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(summoner.address)).to.equal(0);
    });
  });

  describe("erc20 shares - approve", function () {
    it("happy case", async function () {
      await sharesToken.approve(shaman.address, 20);
      const allowance = await sharesToken.allowance(
        summoner.address,
        shaman.address
      );
      expect(allowance).to.equal(20);
    });

    it("overwrites previous value", async function () {
      await sharesToken.approve(shaman.address, 20);
      const allowance = await sharesToken.allowance(
        summoner.address,
        shaman.address
      );
      expect(allowance).to.equal(20);

      await sharesToken.approve(shaman.address, 50);
      const allowance2 = await sharesToken.allowance(
        summoner.address,
        shaman.address
      );
      expect(allowance2).to.equal(50);
    });
  });

  describe("erc20 shares - transfer", function () {
    it("transfer to first time recipient - auto self delegates", async function () {
      const beforeTransferTimestamp = await blockTime();

      await summonerSharesToken.transfer(
        shaman.address,
        deploymentConfig.SPONSOR_THRESHOLD
      );

      const afterTransferTimestamp = await blockTime();
      const summonerBalance = await sharesToken.balanceOf(summoner.address);
      const summonerVotes = await baal.getCurrentVotes(summoner.address);
      const shamanBalance = await sharesToken.balanceOf(shaman.address);
      const shamanVotes = await baal.getCurrentVotes(shaman.address);
      expect(summonerBalance).to.equal(99);
      expect(summonerVotes).to.equal(99);
      expect(shamanBalance).to.equal(1);
      expect(shamanVotes).to.equal(1);

      const summonerCheckpoints = await sharesToken.numCheckpoints(
        summoner.address
      );
      const shamanCheckpoints = await sharesToken.numCheckpoints(
        shaman.address
      );
      const summonerCP0 = await sharesToken.checkpoints(summoner.address, 0);
      const summonerCP1 = await sharesToken.checkpoints(summoner.address, 1);
      const shamanCP0 = await sharesToken.checkpoints(shaman.address, 0);
      const shamanCP1 = await sharesToken.checkpoints(shaman.address, 1);
      expect(summonerCheckpoints).to.equal(2);
      expect(shamanCheckpoints).to.equal(1);
      expect(summonerCP0.votes).to.equal(100);
      expect(summonerCP1.votes).to.equal(99);
      expect(shamanCP0.votes).to.equal(1);
      expect(shamanCP1.fromTimeStamp).to.equal(0); // checkpoint DNE

      const delegate = await sharesToken.delegates(shaman.address);
      expect(delegate).to.equal(shaman.address);
    });

    it("require fails - shares paused", async function () {
      await shamanBaal.setAdminConfig(true, false); // pause shares
      await expect(
        sharesToken.transfer(shaman.address, deploymentConfig.SPONSOR_THRESHOLD)
      ).to.be.revertedWith(revertMessages.sharesTransferPaused);
    });

    it("require fails - insufficient balance", async function () {
      await expect(
        sharesToken.transfer(shaman.address, 101)
      ).to.be.revertedWith(revertMessages.sharesInsufficientBalance);
    });

    it("0 transfer - doesnt update delegates", async function () {
      const beforeTransferTimestamp = await blockTime();
      await sharesToken.transfer(shaman.address, 0);
      const summonerBalance = await sharesToken.balanceOf(summoner.address);
      const summonerVotes = await baal.getCurrentVotes(summoner.address);
      const shamanBalance = await sharesToken.balanceOf(shaman.address);
      const shamanVotes = await baal.getCurrentVotes(shaman.address);
      expect(summonerBalance).to.equal(100);
      expect(summonerVotes).to.equal(100);
      expect(shamanBalance).to.equal(0);
      expect(shamanVotes).to.equal(0);

      const summonerCheckpoints = await sharesToken.numCheckpoints(
        summoner.address
      );
      const shamanCheckpoints = await sharesToken.numCheckpoints(
        shaman.address
      );
      const summonerCP0 = await sharesToken.checkpoints(summoner.address, 0);
      const shamanCP0 = await sharesToken.checkpoints(shaman.address, 0);
      expect(summonerCheckpoints).to.equal(1);
      expect(shamanCheckpoints).to.equal(0);
      expect(summonerCP0.votes).to.equal(100);
      expect(shamanCP0.fromTimeStamp).to.equal(0); // checkpoint DNE
    });

    it("self transfer - doesnt update delegates", async function () {
      const beforeTransferTimestamp = await blockTime();
      await sharesToken.transfer(summoner.address, 10);
      const summonerBalance = await sharesToken.balanceOf(summoner.address);
      const summonerVotes = await baal.getCurrentVotes(summoner.address);
      expect(summonerBalance).to.equal(100);
      expect(summonerVotes).to.equal(100);

      const summonerCheckpoints = await sharesToken.numCheckpoints(
        summoner.address
      );
      const summonerCP0 = await sharesToken.checkpoints(summoner.address, 0);
      expect(summonerCheckpoints).to.equal(1);
      expect(summonerCP0.votes).to.equal(100);
    });

    it("transferring to shareholder w/ delegate assigns votes to delegate", async function () {
      const t1 = await blockTime();
      await sharesToken.transfer(
        shaman.address,
        deploymentConfig.SPONSOR_THRESHOLD
      );
      const t2 = await blockTime();
      await shamanSharesToken.delegate(applicant.address); // set shaman delegate -> applicant
      const t3 = await blockTime();
      await sharesToken.transfer(
        shaman.address,
        deploymentConfig.SPONSOR_THRESHOLD
      );

      const summonerBalance = await sharesToken.balanceOf(summoner.address);
      const summonerVotes = await baal.getCurrentVotes(summoner.address);
      const shamanBalance = await sharesToken.balanceOf(shaman.address);
      const shamanVotes = await baal.getCurrentVotes(shaman.address);
      const applicantVotes = await baal.getCurrentVotes(applicant.address);
      expect(summonerBalance).to.equal(98);
      expect(summonerVotes).to.equal(98);
      expect(shamanBalance).to.equal(2);
      expect(shamanVotes).to.equal(0);
      expect(applicantVotes).to.equal(2);

      const delegate = await sharesToken.delegates(shaman.address);
      expect(delegate).to.equal(applicant.address);

      const summonerCheckpoints = await sharesToken.numCheckpoints(
        summoner.address
      );
      const shamanCheckpoints = await sharesToken.numCheckpoints(
        shaman.address
      );
      const applicantCheckpoints = await sharesToken.numCheckpoints(
        applicant.address
      );
      const summonerCP0 = await sharesToken.checkpoints(summoner.address, 0);
      const summonerCP1 = await sharesToken.checkpoints(summoner.address, 1);
      const summonerCP2 = await sharesToken.checkpoints(summoner.address, 2);
      const shamanCP0 = await sharesToken.checkpoints(shaman.address, 0);
      const shamanCP1 = await sharesToken.checkpoints(shaman.address, 1);
      const applicantCP0 = await sharesToken.checkpoints(applicant.address, 0);
      const applicantCP1 = await sharesToken.checkpoints(applicant.address, 1);
      expect(summonerCheckpoints).to.equal(3);
      expect(shamanCheckpoints).to.equal(2);
      expect(applicantCheckpoints).to.equal(2);
      expect(summonerCP0.votes).to.equal(100);
      expect(summonerCP1.votes).to.equal(99);
      expect(summonerCP2.votes).to.equal(98);
      expect(shamanCP0.votes).to.equal(1);
      expect(shamanCP1.votes).to.equal(0);
      expect(applicantCP0.votes).to.equal(1);
      expect(applicantCP1.votes).to.equal(2);
    });
  });

  describe("erc20 shares - transferFrom", function () {
    it("transfer to first time recipient", async function () {
      const beforeTransferTimestamp = await blockTime();
      await sharesToken.approve(
        shaman.address,
        deploymentConfig.SPONSOR_THRESHOLD
      );

      const allowanceBefore = await sharesToken.allowance(
        summoner.address,
        shaman.address
      );
      expect(allowanceBefore).to.equal(1);

      await shamanSharesToken.transferFrom(
        summoner.address,
        shaman.address,
        deploymentConfig.SPONSOR_THRESHOLD
      );

      const allowanceAfter = await sharesToken.allowance(
        summoner.address,
        shaman.address
      );
      expect(allowanceAfter).to.equal(0);

      const afterTransferTimestamp = await blockTime();
      const summonerBalance = await sharesToken.balanceOf(summoner.address);
      const summonerVotes = await baal.getCurrentVotes(summoner.address);
      const shamanBalance = await sharesToken.balanceOf(shaman.address);
      const shamanVotes = await baal.getCurrentVotes(shaman.address);
      expect(summonerBalance).to.equal(99);
      expect(summonerVotes).to.equal(99);
      expect(shamanBalance).to.equal(1);
      expect(shamanVotes).to.equal(1);

      const summonerCheckpoints = await sharesToken.numCheckpoints(
        summoner.address
      );
      const shamanCheckpoints = await sharesToken.numCheckpoints(
        shaman.address
      );
      const summonerCP0 = await sharesToken.checkpoints(summoner.address, 0);
      const summonerCP1 = await sharesToken.checkpoints(summoner.address, 1);
      const shamanCP0 = await sharesToken.checkpoints(shaman.address, 0);
      const shamanCP1 = await sharesToken.checkpoints(shaman.address, 1);
      expect(summonerCheckpoints).to.equal(2);
      expect(shamanCheckpoints).to.equal(1);
      expect(summonerCP0.votes).to.equal(100);
      expect(summonerCP1.votes).to.equal(99);
      expect(shamanCP0.votes).to.equal(1);
      expect(shamanCP1.fromTimeStamp).to.equal(0); // checkpoint DNE
    });

    it("require fails - shares paused", async function () {
      await shamanBaal.setAdminConfig(true, false); // pause shares
      await sharesToken.approve(
        shaman.address,
        deploymentConfig.SPONSOR_THRESHOLD
      );
      await expect(
        sharesToken.transferFrom(
          summoner.address,
          shaman.address,
          deploymentConfig.SPONSOR_THRESHOLD
        )
      ).to.be.revertedWith(revertMessages.sharesTransferPaused);
    });

    it("require fails - insufficeint approval", async function () {
      await sharesToken.approve(shaman.address, 1);

      await expect(
        sharesToken.transferFrom(summoner.address, shaman.address, 2)
      ).to.be.revertedWith(revertMessages.sharesInsufficientApproval);
    });
  });

  describe("erc20 loot - approve", function () {
    it("happy case", async function () {
      await lootToken.approve(shaman.address, 20);
      const allowance = await lootToken.allowance(
        summoner.address,
        shaman.address
      );
      expect(allowance).to.equal(20);
    });

    it("overwrites previous value", async function () {
      await lootToken.approve(shaman.address, 20);
      const allowance = await lootToken.allowance(
        summoner.address,
        shaman.address
      );
      expect(allowance).to.equal(20);

      await lootToken.approve(shaman.address, 50);
      const allowance2 = await lootToken.allowance(
        summoner.address,
        shaman.address
      );
      expect(allowance2).to.equal(50);
    });
  });

  describe("erc20 loot - transfer", function () {
    it("sends tokens, not votes", async function () {
      await lootToken.transfer(shaman.address, 500);
      const summonerBalance = await lootToken.balanceOf(summoner.address);
      const summonerVotes = await baal.getCurrentVotes(summoner.address);
      const shamanBalance = await lootToken.balanceOf(shaman.address);
      const shamanVotes = await baal.getCurrentVotes(shaman.address);
      expect(summonerBalance).to.equal(0);
      expect(summonerVotes).to.equal(100);
      expect(shamanBalance).to.equal(500);
      expect(shamanVotes).to.equal(0);
    });

    it("require fails - loot paused", async function () {
      await shamanBaal.setAdminConfig(false, true); // pause loot
      await expect(lootToken.transfer(shaman.address, 1)).to.be.revertedWith(
        revertMessages.lootTransferPaused
      );
    });

    it("require fails - insufficient balance", async function () {
      await expect(lootToken.transfer(shaman.address, 501)).to.be.revertedWith(
        revertMessages.lootInsufficientBalance
      );
    });
  });

  describe("erc20 loot - transferFrom", function () {
    it("sends tokens, not votes", async function () {
      await lootToken.approve(shaman.address, 500);
      await shamanLootToken.transferFrom(summoner.address, shaman.address, 500);
      const summonerBalance = await lootToken.balanceOf(summoner.address);
      const summonerVotes = await baal.getCurrentVotes(summoner.address);
      const shamanBalance = await lootToken.balanceOf(shaman.address);
      const shamanVotes = await baal.getCurrentVotes(shaman.address);
      expect(summonerBalance).to.equal(0);
      expect(summonerVotes).to.equal(100);
      expect(shamanBalance).to.equal(500);
      expect(shamanVotes).to.equal(0);
    });

    it("require fails - loot paused", async function () {
      await shamanBaal.setAdminConfig(false, true); // pause loot
      await lootToken.approve(shaman.address, 500);
      await expect(
        shamanLootToken.transferFrom(summoner.address, shaman.address, 500)
      ).to.be.revertedWith(revertMessages.lootTransferPaused);
    });

    it("require fails - insufficient balance", async function () {
      await lootToken.approve(shaman.address, 500);
      await expect(
        shamanLootToken.transferFrom(summoner.address, shaman.address, 501)
      ).to.be.revertedWith(revertMessages.lootInsufficientBalance);
    });

    it("require fails - insufficeint approval", async function () {
      await lootToken.approve(shaman.address, 499);
      await expect(
        shamanLootToken.transferFrom(summoner.address, shaman.address, 500)
      ).to.be.revertedWith(revertMessages.lootInsufficientApproval);
    });
  });

  describe("submitProposal", function () {
    it("happy case", async function () {
      // note - this also tests that members can submit proposals without offering tribute
      // note - this also tests that member proposals are self-sponsored (bc votingStarts != 0)
      const countBefore = await baal.proposalCount();

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      // TODO test return value - use a helper contract to submit + save the returned ID

      const now = await blockTime();

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);

      const state = await baal.state(1);
      expect(state).to.equal(STATES.VOTING);

      const proposalData = await baal.proposals(1);
      expect(proposalData.id).to.equal(1);
      expect(proposalData.votingStarts).to.equal(now);
      expect(proposalData.votingEnds).to.equal(
        now + deploymentConfig.VOTING_PERIOD_IN_SECONDS
      );
      expect(proposalData.yesVotes).to.equal(0);
      expect(proposalData.noVotes).to.equal(0);
      expect(proposalData.expiration).to.equal(proposal.expiration);
      expect(proposalData.details).to.equal(ethers.utils.id(proposal.details));
      expect(hashOperation(proposal.data)).to.equal(
        proposalData.proposalDataHash
      );
      const proposalStatus = await baal.getProposalStatus(1);
      expect(proposalStatus).to.eql([false, false, false, false]);
    });

    it("require fail - expiration passed", async function () {
      const now = await blockTime();

      await expect(
        baal.submitProposal(
          proposal.data,
          now,
          proposal.baalGas,
          ethers.utils.id(proposal.details)
        )
      ).to.be.revertedWith(revertMessages.submitProposalExpired);
    });

    it("edge case - expiration exists, but far enough ahead", async function () {
      const countBefore = await baal.proposalCount();
      const expiration =
        (await blockTime()) +
        deploymentConfig.VOTING_PERIOD_IN_SECONDS +
        deploymentConfig.GRACE_PERIOD_IN_SECONDS +
        10000;
      await baal.submitProposal(
        proposal.data,
        expiration,
        0,
        ethers.utils.id(proposal.details)
      );

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);

      const proposalData = await baal.proposals(1);
      expect(proposalData.id).to.equal(1);
    });
  });

  describe("sponsorProposal", function () {
    it("happy case", async function () {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );

      const proposalData = await baal.proposals(1);
      expect(proposalData.votingStarts).to.equal(0);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.SUBMITTED);

      await baal.sponsorProposal(1);
      const now = await blockTime();
      const proposalDataSponsored = await baal.proposals(1);
      expect(proposalDataSponsored.votingStarts).to.equal(now);
      expect(proposalDataSponsored.votingEnds).to.equal(
        now + deploymentConfig.VOTING_PERIOD_IN_SECONDS
      );

      const state2 = await baal.state(1);
      expect(state2).to.equal(STATES.VOTING);
    });

    it("require fail - proposal expired", async function () {
      const now = await blockTime();

      const expiration =
        now +
        deploymentConfig.VOTING_PERIOD_IN_SECONDS +
        deploymentConfig.GRACE_PERIOD_IN_SECONDS +
        1000;

      await shamanBaal.submitProposal(
        proposal.data,
        expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await moveForwardPeriods(2);
      console.log(now > expiration, proposal.baalGas);

      // TODO: fix
      await expect(baal.sponsorProposal(1)).to.be.revertedWith(
        revertMessages.sponsorProposalExpired
      );
    });

    it("edge case - expiration exists, but far enough ahead 2", async function () {
      const now = await blockTime();
      const expiration =
        now +
        deploymentConfig.VOTING_PERIOD_IN_SECONDS +
        deploymentConfig.GRACE_PERIOD_IN_SECONDS +
        100000;
      await baal.submitProposal(
        proposal.data,
        expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );

      const proposalDataSponsored = await baal.proposals(1);
      const now2 = await blockTime();

      expect(proposalDataSponsored.votingStarts).to.equal(now2);
    });

    it("require fail - not sponsor", async function () {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );

      await expect(shamanBaal.sponsorProposal(1)).to.be.revertedWith(
        revertMessages.sponsorProposalSponsor
      );
    });

    it("edge case - just enough shares to sponsor", async function () {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );

      const proposalData = await baal.proposals(1);
      expect(proposalData.votingStarts).to.equal(0);

      await sharesToken.transfer(
        shaman.address,
        deploymentConfig.SPONSOR_THRESHOLD
      );

      await shamanBaal.sponsorProposal(1);
      const now = await blockTime();
      const proposalDataSponsored = await baal.proposals(1);
      expect(proposalDataSponsored.votingStarts).to.equal(now);
    });

    it("require fail - proposal doesnt exist", async function () {
      const state = await baal.state(1);
      expect(state).to.equal(STATES.UNBORN);
      await expect(baal.sponsorProposal(1)).to.be.revertedWith(
        revertMessages.sponsorProposalNotSubmitted
      );
    });

    it("require fail - already sponsored", async function () {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );

      const proposalData = await baal.proposals(1);
      expect(proposalData.votingStarts).to.equal(0);
      await baal.sponsorProposal(1);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.VOTING);
      await expect(baal.sponsorProposal(1)).to.be.revertedWith(
        revertMessages.sponsorProposalNotSubmitted
      );
    });
  });

  describe("submitVote (w/ auto self-sponsor)", function () {
    beforeEach(async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
    });

    it("happy case - yes vote", async function () {
      await baal.submitVote(1, yes);
      const prop = await baal.proposals(1);
      const nCheckpoints = await sharesToken.numCheckpoints(summoner.address);
      const votes = (
        await sharesToken.checkpoints(summoner.address, nCheckpoints.sub(1))
      ).votes;
      const priorVotes = await baal.getPriorVotes(
        summoner.address,
        prop.votingStarts
      );
      expect(priorVotes).to.equal(votes);
      expect(prop.yesVotes).to.equal(votes);
      expect(prop.maxTotalSharesAndLootAtYesVote).to.equal(shares + loot);
    });

    it("happy case - no vote", async function () {
      await baal.submitVote(1, no);
      const prop = await baal.proposals(1);
      const nCheckpoints = await sharesToken.numCheckpoints(summoner.address);
      const votes = (
        await sharesToken.checkpoints(summoner.address, nCheckpoints.sub(1))
      ).votes;
      expect(prop.noVotes).to.equal(votes);
    });

    it("require fail - voting period has ended", async function () {
      await moveForwardPeriods(2);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.DEEFEATED);
      await expect(baal.submitVote(1, no)).to.be.revertedWith(
        revertMessages.submitVoteNotVoting
      );
    });

    it("require fail - already voted", async function () {
      await baal.submitVote(1, yes);
      await expect(baal.submitVote(1, yes)).to.be.revertedWith(
        revertMessages.submitVoteVoted
      );
    });

    it("require fail - not a member", async function () {
      await expect(shamanBaal.submitVote(1, yes)).to.be.revertedWith(
        revertMessages.submitVoteMember
      );
    });

    it("scenario - two yes votes", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      ); // p2
      await baal.submitVote(1, yes);
      await baal.submitVote(2, yes);
      const prop1 = await baal.proposals(1);
      const votes1 = await baal.getPriorVotes(
        summoner.address,
        prop1.votingStarts
      );
      expect(prop1.yesVotes).to.equal(votes1);

      const prop2 = await baal.proposals(2);
      const votes2 = await baal.getPriorVotes(
        summoner.address,
        prop2.votingStarts
      );
      expect(prop2.yesVotes).to.equal(votes2);
    });
  });

  describe("submitVote (no self-sponsor)", function () {
    it("require fail - voting not started", async function () {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      const state = await baal.state(1);
      expect(state).to.equal(STATES.SUBMITTED);
      await expect(baal.submitVote(1, no)).to.be.revertedWith(
        revertMessages.submitVoteNotVoting
      );
    });

    it("scenario - increase shares during voting", async function () {
      await shamanBaal.mintShares([shaman.address], [100]); // add 100 shares for shaman
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      const prop1 = await baal.proposals(1);
      expect(prop1.maxTotalSharesAndLootAtYesVote).to.equal(
        shares + loot + 100
      );
      await shamanBaal.mintShares([shaman.address], [100]); // add another 100 shares for shaman
      await shamanBaal.submitVote(1, yes);
      const prop = await baal.proposals(1);
      expect(prop.yesVotes).to.equal(200); // 100 summoner and 1st 100 from shaman are counted
      expect(prop.maxTotalSharesAndLootAtYesVote).to.equal(shares + loot + 200);
    });

    it("scenario - decrease shares during voting", async function () {
      await shamanBaal.mintShares([shaman.address], [100]); // add 100 shares for shaman
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      const prop1 = await baal.proposals(1);
      expect(prop1.maxTotalSharesAndLootAtYesVote).to.equal(
        shares + loot + 100
      );
      await shamanBaal.ragequit(shaman.address, 50, 0, [weth.address]);
      await shamanBaal.submitVote(1, yes);
      const prop = await baal.proposals(1);
      expect(prop.yesVotes).to.equal(200); // 100 summoner and 1st 100 from shaman are counted (not affected by rq)
      expect(prop.maxTotalSharesAndLootAtYesVote).to.equal(shares + loot + 100); // unchanged
    });
  });

  describe("submitVoteWithSig (w/ auto self-sponsor)", function () {
    beforeEach(async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
    });

    it("happy case - yes vote", async function () {
      const signature = await signVote(
        chainId,
        baal.address,
        summoner,
        deploymentConfig.TOKEN_NAME,
        1,
        true
      );
      await baal.submitVoteWithSig(1, true, signature);
      const prop = await baal.proposals(1);
      const nCheckpoints = await sharesToken.numCheckpoints(summoner.address);
      const votes = (
        await sharesToken.checkpoints(summoner.address, nCheckpoints.sub(1))
      ).votes;
      const priorVotes = await baal.getPriorVotes(
        summoner.address,
        prop.votingStarts
      );
      expect(priorVotes).to.equal(votes);
      expect(prop.yesVotes).to.equal(votes);
    });
  });

  describe("delegateBySig", function () {
    it("happy case ", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      const signature = await signDelegation(
        chainId,
        sharesToken.address,
        summoner,
        deploymentConfig.TOKEN_NAME,
        shaman.address,
        0,
        0
      );
      console.log(summoner.address);
      await shamanSharesToken.delegateBySig(shaman.address, 0, 0, signature);
      const summonerDelegate = await sharesToken.delegates(summoner.address);
      expect(summonerDelegate).to.equal(shaman.address);
    });

    it("require fail - nonce is re-used", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      const signature = await signDelegation(
        chainId,
        sharesToken.address,
        summoner,
        deploymentConfig.TOKEN_NAME,
        shaman.address,
        0,
        0
      );
      console.log(summoner.address);
      await shamanSharesToken.delegateBySig(shaman.address, 0, 0, signature);
      expect(
        shamanSharesToken.delegateBySig(shaman.address, 0, 0, signature)
      ).to.be.revertedWith("!nonce");
    });
  });

  describe("processProposal", function () {
    it("happy case yes wins", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      const beforeProcessed = await baal.proposals(1);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(1);
      expect(propStatus).to.eql([false, true, true, false]);
    });

    it("require fail - not enough gas", async function () {
      const proposalCount = await baal.proposalCount();

      const baalGas = 100000000;
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        baalGas,
        ethers.utils.id(proposal.details)
      );

      await baal.submitVote(1, yes);
      await moveForwardPeriods(3);

      const procprop = baal.processProposal(1, proposal.data);
      // const procprop =  baal.processProposal(1, proposal.data, {gasPrice: ethers.utils.parseUnits('1', 'gwei'), gasLimit: 10000000})

      expect(procprop).to.be.revertedWith(revertMessages.notEnoughGas);

      const state = await baal.state(1);
      expect(state).to.equal(STATES.READY);
    });

    it("has enough baalGas", async function () {
      const baalGas = 1000000;
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        baalGas,
        ethers.utils.id(proposal.details)
      );

      await baal.submitVote(1, yes);
      await moveForwardPeriods(5);
      await baal.processProposal(1, proposal.data, {
        gasPrice: ethers.utils.parseUnits("100", "gwei"),
        gasLimit: 10000000,
      });

      const state = await baal.state(1);
      expect(state).to.equal(STATES.PROCESSED);
    });

    it("require fail - no wins, proposal is defeated", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, no);
      await moveForwardPeriods(5);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.DEEFEATED);
      await expect(baal.processProposal(1, proposal.data)).to.be.revertedWith(
        revertMessages.processProposalNotReady
      );
    });

    it("require fail - proposal does not exist", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      const state = await baal.state(2);
      expect(state).to.equal(STATES.UNBORN);
      await expect(baal.processProposal(2, proposal.data)).to.be.revertedWith(
        revertMessages.processProposalNotReady
      );
    });

    it("require fail - prev proposal not processed", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(2, yes);
      await moveForwardPeriods(2);
      await expect(baal.processProposal(2, proposal.data)).to.be.revertedWith(
        "prev!processed"
      );
    });

    it("require fail - proposal data mismatch on processing", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      const badSelfTransferAction = encodeMultiAction(
        multisend,
        ["0xbeefbabe"],
        [baal.address],
        [BigNumber.from(0)],
        [0]
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      await expect(
        baal.processProposal(1, badSelfTransferAction)
      ).to.be.revertedWith("incorrect calldata");
    });

    it("require fail - proposal not in voting", async function () {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await expect(baal.processProposal(1, proposal.data)).to.be.revertedWith(
        revertMessages.processProposalNotReady
      ); // fail at submitted
      await baal.sponsorProposal(1);
      await expect(baal.processProposal(1, proposal.data)).to.be.revertedWith(
        revertMessages.processProposalNotReady
      ); // fail at voting
      await baal.submitVote(1, yes);
      const beforeProcessed = await baal.proposals(1);
      await moveForwardPeriods(1);
      const state1 = await baal.state(1);
      expect(state1).to.equal(STATES.GRACE);
      await expect(baal.processProposal(1, proposal.data)).to.be.revertedWith(
        revertMessages.processProposalNotReady
      ); // fail at grace
      await moveForwardPeriods(1);
      await baal.processProposal(1, proposal.data); // propsal ready, works
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(1);
      expect(propStatus).to.eql([false, true, true, false]);
    });

    it("require fail - proposal cancelled", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await shamanBaal.cancelProposal(1);
      await moveForwardPeriods(2);
      const state = await baal.state(1);
      expect(state).to.equal(STATES.CANCELLED);
      await expect(baal.processProposal(1, proposal.data)).to.be.revertedWith(
        revertMessages.processProposalNotReady
      );
    });

    it("require fail - proposal expired 2", async function () {
      const now = await blockTime();
      const expiration =
        now +
        deploymentConfig.VOTING_PERIOD_IN_SECONDS +
        deploymentConfig.GRACE_PERIOD_IN_SECONDS +
        2;

      await baal.submitProposal(
        proposal.data,
        expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1);
      expect(state1).to.equal(STATES.READY);
      const beforeProcessed = await baal.proposals(1);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed);
      const state2 = await baal.state(1);
      expect(state2).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(1);
      expect(propStatus).to.eql([false, true, false, false]); // passed [3] is false
    });

    it("edge case - exactly at quorum", async function () {
      const governanceConfig = abiCoder.encode(
        ["uint32", "uint32", "uint256", "uint256", "uint256", "uint256"],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS,
          deploymentConfig.GRACE_PERIOD_IN_SECONDS,
          deploymentConfig.PROPOSAL_OFFERING,
          10,
          deploymentConfig.SPONSOR_THRESHOLD,
          deploymentConfig.MIN_RETENTION_PERCENT,
        ]
      );

      await shamanBaal.mintShares([shaman.address], [900]); // mint 900 shares so summoner has exectly 10% w/ 100 shares

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1);
      expect(state1).to.equal(STATES.READY);
      await shamanBaal.setGovernanceConfig(governanceConfig); // set quorum to 10%
      const beforeProcessed = await baal.proposals(1);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed);
      const state2 = await baal.state(1);
      expect(state2).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(1);
      expect(propStatus).to.eql([false, true, true, false]); // passed [3] is true
    });

    it("edge case - just under quorum", async function () {
      const governanceConfig = abiCoder.encode(
        ["uint32", "uint32", "uint256", "uint256", "uint256", "uint256"],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS,
          deploymentConfig.GRACE_PERIOD_IN_SECONDS,
          deploymentConfig.PROPOSAL_OFFERING,
          10,
          deploymentConfig.SPONSOR_THRESHOLD,
          deploymentConfig.MIN_RETENTION_PERCENT,
        ]
      );

      await shamanBaal.mintShares([shaman.address], [901]); // mint 901 shares so summoner has <10% w/ 100 shares

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1);
      expect(state1).to.equal(STATES.READY);
      await shamanBaal.setGovernanceConfig(governanceConfig); // set quorum to 10%
      const beforeProcessed = await baal.proposals(1);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed);
      const state2 = await baal.state(1);
      expect(state2).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(1);
      expect(propStatus).to.eql([false, true, false, false]); // passed [3] is false
    });

    it("edge case - exactly at minRetentionPercent", async function () {
      const governanceConfig = abiCoder.encode(
        ["uint32", "uint32", "uint256", "uint256", "uint256", "uint256"],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS,
          deploymentConfig.GRACE_PERIOD_IN_SECONDS,
          deploymentConfig.PROPOSAL_OFFERING,
          0,
          deploymentConfig.SPONSOR_THRESHOLD,
          90, // min retention % = 90%, ragequit >10% of shares+loot to trigger
        ]
      );

      await shamanBaal.setGovernanceConfig(governanceConfig); // set min retention to 90%

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1);
      await baal.ragequit(summoner.address, 10, 50, [weth.address]); // ragequit 10 shares out of 100 and 50 loot out of 500
      expect(state1).to.equal(STATES.READY);
      const beforeProcessed = await baal.proposals(1);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed);
      const state2 = await baal.state(1);
      expect(state2).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(1);
      expect(propStatus).to.eql([false, true, true, false]); // passed [3] is true
    });

    it("edge case - just below minRetentionPercent - shares+loot", async function () {
      const governanceConfig = abiCoder.encode(
        ["uint32", "uint32", "uint256", "uint256", "uint256", "uint256"],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS,
          deploymentConfig.GRACE_PERIOD_IN_SECONDS,
          deploymentConfig.PROPOSAL_OFFERING,
          0,
          deploymentConfig.SPONSOR_THRESHOLD,
          90, // min retention % = 90%, ragequit >10% of shares to trigger
        ]
      );

      await shamanBaal.setGovernanceConfig(governanceConfig); // set min retention to 90%

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1);
      await baal.ragequit(summoner.address, 11, 50, [weth.address]); // ragequit 11 shares out of 100, and 50 out of 500
      expect(state1).to.equal(STATES.READY);
      const beforeProcessed = await baal.proposals(1);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed);
      const state2 = await baal.state(1);
      expect(state2).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(1);
      expect(propStatus).to.eql([false, true, false, false]); // passed [3] is false - min retention exceeded
    });

    it("edge case - just below minRetentionPercent - just shares", async function () {
      const governanceConfig = abiCoder.encode(
        ["uint32", "uint32", "uint256", "uint256", "uint256", "uint256"],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS,
          deploymentConfig.GRACE_PERIOD_IN_SECONDS,
          deploymentConfig.PROPOSAL_OFFERING,
          0,
          deploymentConfig.SPONSOR_THRESHOLD,
          90, // min retention % = 90%, ragequit >10% of shares to trigger
        ]
      );

      await shamanBaal.setGovernanceConfig(governanceConfig); // set min retention to 90%

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1);
      await baal.ragequit(summoner.address, 61, 0, [weth.address]); // ragequit 61 shares out of 100, and 0 out of 500
      expect(state1).to.equal(STATES.READY);
      const beforeProcessed = await baal.proposals(1);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed);
      const state2 = await baal.state(1);
      expect(state2).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(1);
      expect(propStatus).to.eql([false, true, false, false]); // passed [3] is false - min retention exceeded
    });

    it("edge case - just below minRetentionPercent - just loot", async function () {
      const governanceConfig = abiCoder.encode(
        ["uint32", "uint32", "uint256", "uint256", "uint256", "uint256"],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS,
          deploymentConfig.GRACE_PERIOD_IN_SECONDS,
          deploymentConfig.PROPOSAL_OFFERING,
          0,
          deploymentConfig.SPONSOR_THRESHOLD,
          90, // min retention % = 90%, ragequit >10% of shares to trigger
        ]
      );

      await shamanBaal.setGovernanceConfig(governanceConfig); // set min retention to 90%

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1);
      await baal.ragequit(summoner.address, 0, 61, [weth.address]); // ragequit 0 shares out of 100, and 61 out of 500
      expect(state1).to.equal(STATES.READY);
      const beforeProcessed = await baal.proposals(1);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed);
      const state2 = await baal.state(1);
      expect(state2).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(1);
      expect(propStatus).to.eql([false, true, false, false]); // passed [3] is false - min retention exceeded
    });

    it("scenario - offer tribute unsafe", async function () {
      weth.transfer(applicant.address, 100); // summoner transfer 100 weth
      const offerWeth = weth.interface.encodeFunctionData("transferFrom", [
        applicant.address,
        gnosisSafe.address,
        100,
      ]);
      const tributeMultiAction = encodeMultiAction(
        multisend,
        [offerWeth],
        [weth.address],
        [BigNumber.from(0)],
        [0]
      );
      proposal.data = tributeMultiAction;

      await applicantWeth.approve(gnosisSafe.address, 100);

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      const beforeProcessed = await baal.proposals(1);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed, {
        processed: true,
        passed: true,
      });
      const applicantWethBalance = await weth.balanceOf(applicant.address);
      expect(applicantWethBalance).to.equal(0);
      const safeWethBalance = await weth.balanceOf(gnosisSafe.address);
      expect(safeWethBalance).to.equal(100);
    });

    it("scenario - two propsals, prev is processed", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(2, yes);
      const beforeProcessed = await baal.proposals(2);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      const state1 = await baal.state(1);
      expect(state1).to.equal(STATES.PROCESSED); // prev prop processed
      await baal.processProposal(2, proposal.data);
      const afterProcessed = await baal.proposals(2);
      verifyProposal(afterProcessed, beforeProcessed);
      const state2 = await baal.state(2);
      expect(state2).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(2);
      expect(propStatus).to.eql([false, true, true, false]);
    });

    it("scenario - two propsals, prev is defeated", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, no);
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(2, yes);
      const beforeProcessed = await baal.proposals(2);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1);
      expect(state1).to.equal(STATES.DEEFEATED); // prev prop defeated
      await baal.processProposal(2, proposal.data);
      const afterProcessed = await baal.proposals(2);
      verifyProposal(afterProcessed, beforeProcessed);
      const state2 = await baal.state(2);
      expect(state2).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(2);
      expect(propStatus).to.eql([false, true, true, false]);
    });

    it("scenario - two propsals, prev is cancelled", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await shamanBaal.cancelProposal(1);
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(2, yes);
      const beforeProcessed = await baal.proposals(2);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1);
      expect(state1).to.equal(STATES.CANCELLED); // prev prop cancelled
      await baal.processProposal(2, proposal.data);
      const afterProcessed = await baal.proposals(2);
      verifyProposal(afterProcessed, beforeProcessed);
      const state2 = await baal.state(2);
      expect(state2).to.equal(STATES.PROCESSED);
      const propStatus = await baal.getProposalStatus(2);
      expect(propStatus).to.eql([false, true, true, false]);
    });

    it("happy case - mint shares via proposal", async function () {
      const minting = 100;

      expect(await sharesToken.balanceOf(applicant.address)).to.equal(0);

      const mintSharesAction = await baal.interface.encodeFunctionData(
        "mintShares",
        [[applicant.address], [minting]]
      );

      await expect(submitAndProcessProposal(baal, mintSharesAction, 1))
        .to.emit(baal, "ProcessProposal")
        .withArgs(1, true, false);

      expect(await sharesToken.balanceOf(applicant.address)).to.equal(minting);
    });

    it("happy case - burn shares via proposal", async function () {
      const burning = 100;

      expect(await sharesToken.balanceOf(summoner.address)).to.equal(shares);

      const burnSharesAction = await baal.interface.encodeFunctionData(
        "burnShares",
        [[summoner.address], [burning]]
      );

      await expect(submitAndProcessProposal(baal, burnSharesAction, 1))
        .to.emit(baal, "ProcessProposal")
        .withArgs(1, true, false);

      expect(await sharesToken.balanceOf(summoner.address)).to.equal(
        shares - burning
      );
    });

    it("happy case - mint loot via proposal", async function () {
      const minting = 100;

      expect(await lootToken.balanceOf(applicant.address)).to.equal(0);

      const mintLootAction = await baal.interface.encodeFunctionData(
        "mintLoot",
        [[applicant.address], [minting]]
      );

      await expect(submitAndProcessProposal(baal, mintLootAction, 1))
        .to.emit(baal, "ProcessProposal")
        .withArgs(1, true, false);

      expect(await lootToken.balanceOf(applicant.address)).to.equal(minting);
    });

    it("happy case - burn loot via proposal", async function () {
      const burning = 100;

      expect(await lootToken.balanceOf(summoner.address)).to.equal(loot);

      const burnLootAction = await baal.interface.encodeFunctionData(
        "burnLoot",
        [[summoner.address], [burning]]
      );

      await expect(submitAndProcessProposal(baal, burnLootAction, 1))
        .to.emit(baal, "ProcessProposal")
        .withArgs(1, true, false);

      expect(await lootToken.balanceOf(summoner.address)).to.equal(
        loot - burning
      );
    });

    // setting and unsetting shamans covered

    // TODO set / unset tokens via proposal
  });

  describe("ragequit", function () {
    it("happy case - full ragequit", async function () {
      const lootBefore = await lootToken.balanceOf(summoner.address);
      const summonerWethBefore = await weth.balanceOf(summoner.address);
      await weth.transfer(gnosisSafe.address, 100);
      await baal.ragequit(summoner.address, shares, loot, [weth.address]);
      const sharesAfter = await sharesToken.balanceOf(summoner.address);
      const lootAfter = await lootToken.balanceOf(summoner.address);
      const summonerWethAfter = await weth.balanceOf(summoner.address);
      const safeWethAfter = await weth.balanceOf(gnosisSafe.address);
      expect(lootAfter).to.equal(lootBefore.sub(loot));
      expect(sharesAfter).to.equal(0);
      expect(summonerWethAfter).to.equal(summonerWethBefore);
      expect(safeWethAfter).to.equal(0);
    });

    it("happy case - partial ragequit", async function () {
      const lootBefore = await lootToken.balanceOf(summoner.address);
      const lootToBurn = 250;
      const sharesToBurn = 50;
      const summonerWethBefore = await weth.balanceOf(summoner.address);
      await weth.transfer(gnosisSafe.address, 100);
      await baal.ragequit(summoner.address, sharesToBurn, lootToBurn, [
        weth.address,
      ]);
      const sharesAfter = await sharesToken.balanceOf(summoner.address);
      const lootAfter = await lootToken.balanceOf(summoner.address);
      const summonerWethAfter = await weth.balanceOf(summoner.address);
      const safeWethAfter = await weth.balanceOf(gnosisSafe.address);
      expect(lootAfter).to.equal(lootBefore.sub(lootToBurn));
      expect(sharesAfter).to.equal(50);
      expect(summonerWethAfter).to.equal(summonerWethBefore.sub(50));
      expect(safeWethAfter).to.equal(50);
    });

    it("happy case - full ragequit to different address", async function () {
      const lootBefore = await lootToken.balanceOf(summoner.address);
      const summonerWethBefore = await weth.balanceOf(summoner.address);
      await weth.transfer(gnosisSafe.address, 100);
      await baal.ragequit(applicant.address, shares, loot, [weth.address]); // ragequit to applicant
      const sharesAfter = await sharesToken.balanceOf(summoner.address);
      const lootAfter = await lootToken.balanceOf(summoner.address);
      const summonerWethAfter = await weth.balanceOf(summoner.address);
      const safeWethAfter = await weth.balanceOf(gnosisSafe.address);
      const applicantWethAfter = await weth.balanceOf(applicant.address);
      expect(lootAfter).to.equal(lootBefore.sub(loot));
      expect(sharesAfter).to.equal(0);
      expect(summonerWethAfter).to.equal(summonerWethBefore.sub(100));
      expect(safeWethAfter).to.equal(0);
      expect(applicantWethAfter).to.equal(100);
    });

    it("happy case - full ragequit - two tokens", async function () {
      // expect: receive 50% of weth and weth2 from DAO

      const summonerWethBefore = await weth.balanceOf(summoner.address);
      const summonerWeth2Before = await weth2.balanceOf(summoner.address);

      await weth.transfer(gnosisSafe.address, 100);
      await weth2.transfer(gnosisSafe.address, 200);

      const summonerWethAfterTrans = await weth.balanceOf(summoner.address);

      const safeBalance = await weth.balanceOf(gnosisSafe.address);

      const sharesBefore = await sharesToken.balanceOf(summoner.address);
      const lootBefore = await lootToken.balanceOf(summoner.address);

      const orderedTokens = [weth2.address, weth.address].sort((a, b) => {
        return parseInt(a.slice(2), 16) - parseInt(b.slice(2), 16);
      });

      await baal.ragequit(summoner.address, shares, loot - 300, orderedTokens);
      const sharesAfter = await sharesToken.balanceOf(summoner.address);
      const lootAfter = await lootToken.balanceOf(summoner.address);
      const summonerWethAfter = await weth.balanceOf(summoner.address);
      const summonerWeth2After = await weth2.balanceOf(summoner.address);
      const safeWethAfter = await weth.balanceOf(gnosisSafe.address);

      const safeWeth2After = await weth2.balanceOf(gnosisSafe.address);
      expect(lootAfter).to.equal(300); // rq 200
      expect(sharesAfter).to.equal(0);
      expect(summonerWethAfter).to.equal(summonerWethBefore.sub(50)); // minus 100, plus 50
      expect(summonerWeth2After).to.equal(summonerWeth2Before.sub(100)); // minus 200, plus 100
      expect(safeWethAfter).to.equal(50);
      expect(safeWeth2After).to.equal(100);
    });
  });

  describe("ragequit", function () {
    it("collects tokens not on the list", async function () {
      // note - skips having shaman add LOOT to guildTokens
      // transfer 300 loot to DAO (summoner has 100 shares + 500 loot, so that's 50% of total)
      // transfer 100 weth to DAO
      // ragequit 100% of remaining shares & loot
      // expect: receive 50% of weth / loot from DAO
      const summonerWethBefore = await weth.balanceOf(summoner.address);
      await weth.transfer(gnosisSafe.address, 100);
      await lootToken.transfer(gnosisSafe.address, 300);
      const tokens = [lootToken.address, weth.address].sort((a, b) => {
        return parseInt(a.slice(2), 16) - parseInt(b.slice(2), 16);
      });
      await baal.ragequit(summoner.address, shares, loot - 300, tokens);
      const sharesAfter = await sharesToken.balanceOf(summoner.address);
      const lootAfter = await lootToken.balanceOf(summoner.address);
      const safeLootAfter = await lootToken.balanceOf(gnosisSafe.address);
      const summonerWethAfter = await weth.balanceOf(summoner.address);
      const safeWethAfter = await weth.balanceOf(gnosisSafe.address);
      expect(lootAfter).to.equal(150); // burn 200, receive 150
      expect(sharesAfter).to.equal(0);
      expect(summonerWethAfter).to.equal(summonerWethBefore.sub(50)); // minus 100, plus 50
      expect(safeWethAfter).to.equal(50);
      expect(safeLootAfter).to.equal(150);
    });

    it("require fail - enforces ascending order", async function () {
      await weth.transfer(gnosisSafe.address, 100);
      await lootToken.transfer(baal.address, 300);
      const tokens = [lootToken.address, weth.address]
        .sort((a, b) => {
          return parseInt(a.slice(2), 16) - parseInt(b.slice(2), 16);
        })
        .reverse();
      await expect(
        baal.ragequit(summoner.address, shares, loot - 300, tokens)
      ).to.be.revertedWith(revertMessages.ragequitUnordered);
    });

    it("require fail - prevents actual duplicate", async function () {
      await weth.transfer(gnosisSafe.address, 100);
      await expect(
        baal.ragequit(summoner.address, shares, loot - 300, [
          weth.address,
          weth.address,
        ])
      ).to.be.revertedWith(revertMessages.ragequitUnordered);
    });
  });

  describe("getCurrentVotes", function () {
    it("happy case - account with votes", async function () {
      const currentVotes = await baal.getCurrentVotes(summoner.address);
      const nCheckpoints = await sharesToken.numCheckpoints(summoner.address);
      const checkpoints = await sharesToken.checkpoints(
        summoner.address,
        nCheckpoints.sub(1)
      );
      const votes = checkpoints.votes;
      expect(currentVotes).to.equal(votes);
    });

    it("happy case - account without votes", async function () {
      const currentVotes = await baal.getCurrentVotes(shaman.address);
      expect(currentVotes).to.equal(0);
    });
  });

  describe("getPriorVotes", function () {
    beforeEach(async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
    });

    it("happy case - yes vote", async function () {
      const blockT = await blockTime();
      await baal.submitVote(1, yes);
      const priorVote = await baal.getPriorVotes(summoner.address, blockT);
      const nCheckpoints = await sharesToken.numCheckpoints(summoner.address);
      const votes = (
        await sharesToken.checkpoints(summoner.address, nCheckpoints.sub(1))
      ).votes;
      expect(priorVote).to.equal(votes);
    });

    it("happy case - no vote", async function () {
      const blockT = await blockTime();
      await baal.submitVote(1, no);
      const priorVote = await baal.getPriorVotes(summoner.address, blockT);
      const nCheckpoints = await sharesToken.numCheckpoints(summoner.address);
      const votes = (
        await sharesToken.checkpoints(summoner.address, nCheckpoints.sub(1))
      ).votes;
      expect(priorVote).to.equal(votes);
    });

    it("require fail - timestamp not determined", async function () {
      const blockT = await blockTime();
      await expect(
        baal.getPriorVotes(summoner.address, blockT)
      ).to.be.revertedWith("!determined");
    });
  });
});

describe("Baal contract - offering required", function () {
  let customConfig = {
    ...deploymentConfig,
    PROPOSAL_OFFERING: 69,
    SPONSOR_THRESHOLD: 1,
  };

  let baal: Baal;
  let shamanBaal: Baal;
  let weth: TestErc20;
  let multisend: MultiSend;
  let poster: Poster;

  let baalSingleton: Baal;
  let baalSummoner: BaalSummoner;

  let BaalFactory: ContractFactory;
  let Poster: ContractFactory;

  let lootSingleton: Loot;
  let LootFactory: ContractFactory;
  let lootToken: Loot;

  let sharesSingleton: Shares;
  let SharesFactory: ContractFactory;
  let sharesToken: Shares;

  let gnosisSafeSingleton: GnosisSafe;

  let applicant: SignerWithAddress;
  let summoner: SignerWithAddress;
  let shaman: SignerWithAddress;

  let moduleProxyFactory: ModuleProxyFactory;

  let proposal: { [key: string]: any };

  let encodedInitParams: any;

  const loot = 500;
  const shares = 100;
  const sharesPaused = false;
  const lootPaused = false;

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
    const MultisendContract = await ethers.getContractFactory("MultiSend");
    const GnosisSafe = await ethers.getContractFactory("GnosisSafe");
    const BaalSummoner = await ethers.getContractFactory("BaalSummoner");
    const GnosisSafeProxyFactory = await ethers.getContractFactory(
      "GnosisSafeProxyFactory"
    );
    const ModuleProxyFactory = await ethers.getContractFactory(
      "ModuleProxyFactory"
    );
    const CompatibilityFallbackHandler = await ethers.getContractFactory(
      "CompatibilityFallbackHandler"
    );

    [summoner, applicant, shaman] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("TestERC20");
    weth = (await ERC20.deploy("WETH", "WETH", 10000000)) as TestErc20;

    multisend = (await MultisendContract.deploy()) as MultiSend;
    gnosisSafeSingleton = (await GnosisSafe.deploy()) as GnosisSafe;
    const handler =
      (await CompatibilityFallbackHandler.deploy()) as CompatibilityFallbackHandler;

    const proxy = await GnosisSafeProxyFactory.deploy();
    moduleProxyFactory =
      (await ModuleProxyFactory.deploy()) as ModuleProxyFactory;

    baalSummoner = (await BaalSummoner.deploy(
      baalSingleton.address,
      gnosisSafeSingleton.address,
      handler.address,
      multisend.address,
      proxy.address,
      moduleProxyFactory.address
    )) as BaalSummoner;

    const encodedInitParams = await getBaalParams(
      baalSingleton,
      multisend,
      lootSingleton,
      sharesSingleton,
      poster,
      customConfig,
      [metadataConfig.CONTENT, metadataConfig.TAG],
      [sharesPaused, lootPaused],
      [[shaman.address], [7]],
      [[summoner.address], [shares]],
      [[summoner.address], [loot]]
    );

    const tx = await baalSummoner.summonBaalAndSafe(
      encodedInitParams.initParams,
      encodedInitParams.initalizationActions,
      101
    );
    const addresses = await getNewBaalAddresses(tx);

    baal = BaalFactory.attach(addresses.baal) as Baal;
    shamanBaal = await baal.connect(shaman);
    const lootTokenAddress = await baal.lootToken();

    sharesToken = SharesFactory.attach(addresses.shares) as Shares;
    lootToken = LootFactory.attach(lootTokenAddress) as Loot;

    const selfTransferAction = encodeMultiAction(
      multisend,
      ["0x"],
      [baal.address],
      [BigNumber.from(0)],
      [0]
    );

    proposal = {
      flag: 0,
      account: summoner.address,
      data: selfTransferAction,
      details: "all hail baal",
      expiration: 0,
      baalGas: 0,
    };
  });

  describe("submitProposal", function () {
    it("happy case - offering is accepted, not self-sponsored", async function () {
      // note - this also tests that the proposal is NOT sponsored
      const countBefore = await baal.proposalCount();

      console.log({ proposal });

      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details),
        { value: 69 }
      );

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);

      const proposalData = await baal.proposals(1);
      expect(proposalData.id).to.equal(1);
      expect(proposalData.votingStarts).to.equal(0);
    });

    it("happy case - sponsors can submit without offering, auto-sponsors", async function () {
      const countBefore = await baal.proposalCount();

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      const now = await blockTime();

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);
      const proposalData = await baal.proposals(1);
      expect(proposalData.id).to.equal(1);
      expect(proposalData.votingStarts).to.equal(now);
    });

    it("edge case - sponsors can submit without offering at threshold", async function () {
      const countBefore = await baal.proposalCount();
      await sharesToken.transfer(shaman.address, 1); // transfer 1 share to shaman, putting them at threshold (1)

      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      const now = await blockTime();

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);
      const proposalData = await baal.proposals(1);
      expect(proposalData.id).to.equal(1);
      expect(proposalData.votingStarts).to.equal(now);
    });

    it("require fail - no offering offered", async function () {
      await expect(
        shamanBaal.submitProposal(
          proposal.data,
          proposal.expiration,
          proposal.baalGas,
          ethers.utils.id(proposal.details)
        )
      ).to.be.revertedWith(revertMessages.submitProposalOffering);
    });
  });
});


describe.only("Baal contract - summon baal with current safe", function () {
  let customConfig = {
    ...deploymentConfig,
    PROPOSAL_OFFERING: 69,
    SPONSOR_THRESHOLD: 1,
  };

  let baal: Baal;
  let shamanBaal: Baal;
  let weth: TestErc20;
  let multisend: MultiSend;
  let poster: Poster;

  let baalSingleton: Baal;
  let baalSummoner: BaalSummoner;

  let BaalFactory: ContractFactory;
  let Poster: ContractFactory;

  let lootSingleton: Loot;
  let LootFactory: ContractFactory;
  let lootToken: Loot;

  let sharesSingleton: Shares;
  let SharesFactory: ContractFactory;
  let sharesToken: Shares;

  let gnosisSafeSingleton: GnosisSafe;

  let applicant: SignerWithAddress;
  let summoner: SignerWithAddress;
  let shaman: SignerWithAddress;

  let moduleProxyFactory: ModuleProxyFactory;

  let proposal: { [key: string]: any };

  let encodedInitParams: any;

  const loot = 500;
  const shares = 100;
  const sharesPaused = false;
  const lootPaused = false;

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
    const MultisendContract = await ethers.getContractFactory("MultiSend");
    const GnosisSafe = await ethers.getContractFactory("GnosisSafe");
    const BaalSummoner = await ethers.getContractFactory("BaalSummoner");
    const GnosisSafeProxyFactory = await ethers.getContractFactory(
      "GnosisSafeProxyFactory"
    );
    const ModuleProxyFactory = await ethers.getContractFactory(
      "ModuleProxyFactory"
    );
    const CompatibilityFallbackHandler = await ethers.getContractFactory(
      "CompatibilityFallbackHandler"
    );

    [summoner, applicant, shaman] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("TestERC20");
    weth = (await ERC20.deploy("WETH", "WETH", 10000000)) as TestErc20;

    multisend = (await MultisendContract.deploy()) as MultiSend;
    gnosisSafeSingleton = (await GnosisSafe.deploy()) as GnosisSafe;
    const handler =
      (await CompatibilityFallbackHandler.deploy()) as CompatibilityFallbackHandler;

    const proxy = await GnosisSafeProxyFactory.deploy();
    moduleProxyFactory =
      (await ModuleProxyFactory.deploy()) as ModuleProxyFactory;

    baalSummoner = (await BaalSummoner.deploy(
      baalSingleton.address,
      gnosisSafeSingleton.address,
      handler.address,
      multisend.address,
      proxy.address,
      moduleProxyFactory.address
    )) as BaalSummoner;

    const encodedInitParams = await getBaalParams(
      baalSingleton,
      multisend,
      lootSingleton,
      sharesSingleton,
      poster,
      customConfig,
      [metadataConfig.CONTENT, metadataConfig.TAG],
      [sharesPaused, lootPaused],
      [[shaman.address], [7]],
      [[summoner.address], [shares]],
      [[summoner.address], [loot]],
      gnosisSafeSingleton.address
    );

    const tx = await baalSummoner.summonBaal(
      encodedInitParams.initParams,
      encodedInitParams.initalizationActions,
      101
    );
    const addresses = await getNewBaalAddresses(tx);
    console.log('addresses', addresses);
    

    baal = BaalFactory.attach(addresses.baal) as Baal;
    shamanBaal = await baal.connect(shaman);
    const lootTokenAddress = await baal.lootToken();

    sharesToken = SharesFactory.attach(addresses.shares) as Shares;
    lootToken = LootFactory.attach(lootTokenAddress) as Loot;

    const selfTransferAction = encodeMultiAction(
      multisend,
      ["0x"],
      [baal.address],
      [BigNumber.from(0)],
      [0]
    );

    proposal = {
      flag: 0,
      account: summoner.address,
      data: selfTransferAction,
      details: "all hail baal",
      expiration: 0,
      baalGas: 0,
    };
  });

  describe("submitProposal", function () {
    it("happy case - offering is accepted, not self-sponsored", async function () {
      // note - this also tests that the proposal is NOT sponsored
      const countBefore = await baal.proposalCount();

      console.log({ proposal });

      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details),
        { value: 69 }
      );

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);

      const proposalData = await baal.proposals(1);
      expect(proposalData.id).to.equal(1);
      expect(proposalData.votingStarts).to.equal(0);
    });

    it("happy case - sponsors can submit without offering, auto-sponsors", async function () {
      const countBefore = await baal.proposalCount();

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      const now = await blockTime();

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);
      const proposalData = await baal.proposals(1);
      expect(proposalData.id).to.equal(1);
      expect(proposalData.votingStarts).to.equal(now);
    });

    it("edge case - sponsors can submit without offering at threshold", async function () {
      const countBefore = await baal.proposalCount();
      await sharesToken.transfer(shaman.address, 1); // transfer 1 share to shaman, putting them at threshold (1)

      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        proposal.baalGas,
        ethers.utils.id(proposal.details)
      );
      const now = await blockTime();

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);
      const proposalData = await baal.proposals(1);
      expect(proposalData.id).to.equal(1);
      expect(proposalData.votingStarts).to.equal(now);
    });

    it("require fail - no offering offered", async function () {
      await expect(
        shamanBaal.submitProposal(
          proposal.data,
          proposal.expiration,
          proposal.baalGas,
          ethers.utils.id(proposal.details)
        )
      ).to.be.revertedWith(revertMessages.submitProposalOffering);
    });
  });
});