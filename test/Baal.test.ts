import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import { use, expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { Baal } from "../src/types/Baal";
import { TestErc20 } from "../src/types/TestErc20";
import { RageQuitBank } from "../src/types/RageQuitBank";
import { MultiSend } from "../src/types/MultiSend";
import { encodeMultiAction } from "../src/util";
import { BigNumber } from "@ethersproject/bignumber";
import { buildContractCall } from "@gnosis.pm/safe-contracts";

use(solidity);

// chai
//   .use(require('chai-as-promised'))
//   .should();

const revertMessages = {
  molochAlreadyInitialized: "Initializable: contract is already initialized",
  molochConstructorSharesCannotBe0: "shares cannot be 0",
  molochConstructorVotingPeriodCannotBe0: "votingPeriod cannot be 0",
  submitProposalOffering: "Baal requires an offering",
  submitProposalVotingPeriod: "!votingPeriod",
  submitProposalArrays: "!array parity",
  submitProposalArrayMax: "array max",
  submitProposalFlag: "!flag",
  submitVoteTimeEnded: "ended",
  submitVoteVoted: "voted",
  submitVoteMember: "!member",
  submitVoteWithSigTimeEnded: "ended",
  submitVoteWithSigVoted: "voted",
  submitVoteWithSigMember: "!member",
  sponsorProposalMember: "!member",
  sponsorProposalExists: "!exist",
  sponsorProposalSponsored: "sponsored",
  proposalMisnumbered: "!exist",
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

async function moveForwardPeriods(periods: number) {
  const goToTime = deploymentConfig.VOTING_PERIOD_IN_SECONDS * periods;
  await ethers.provider.send("evm_increaseTime", [goToTime]);
  return true;
}

const deploymentConfig = {
  GRACE_PERIOD_IN_SECONDS: 43200,
  VOTING_PERIOD_IN_SECONDS: 432000,
  PROPOSAL_OFFERING: 0,
  TOKEN_NAME: "wrapped ETH",
  TOKEN_SYMBOL: "WETH",
};

const getBaalParams = async function(
  baal: Baal, 
  multisend: MultiSend, 
  config: { 
    PROPOSAL_OFFERING: any; 
    GRACE_PERIOD_IN_SECONDS: any; 
    VOTING_PERIOD_IN_SECONDS: any; 
    TOKEN_NAME: any; 
    TOKEN_SYMBOL: any; 
  }, 
  lootPaused: boolean, sharesPaused: boolean, 
  tokens: [string[]],
  shamans: [string[], boolean],
  shares: [string[], number[]], 
  loots: [string[], number[]]
) {
  const abiCoder = ethers.utils.defaultAbiCoder;

  const periods = abiCoder.encode(
    ["uint32", "uint32", "uint256", "bool", "bool"],
    [
      config.VOTING_PERIOD_IN_SECONDS,
      config.GRACE_PERIOD_IN_SECONDS,
      config.PROPOSAL_OFFERING,
      lootPaused,
      sharesPaused,
    ]
  );

  const setPeriods = await baal.interface.encodeFunctionData("setPeriods", [periods]);
  const setGuildTokens = await baal.interface.encodeFunctionData("setGuildTokens", tokens);
  const setShaman = await baal.interface.encodeFunctionData("setShamans", shamans);
  const mintShares = await baal.interface.encodeFunctionData("mintShares", shares);
  const mintLoot = await baal.interface.encodeFunctionData("mintLoot", loots);
  // const delegateSummoners = await baal.interface.encodeFunctionData('delegateSummoners', [[summoner.address], [summoner.address]])

  const initalizationActions = encodeMultiAction(
    multisend,
    [setPeriods, setGuildTokens, setShaman, mintShares, mintLoot],
    [baal.address, baal.address, baal.address, baal.address, baal.address],
    [
      BigNumber.from(0),
      BigNumber.from(0),
      BigNumber.from(0),
      BigNumber.from(0),
      BigNumber.from(0),
    ],
    [0, 0, 0, 0, 0]
  );

  return abiCoder.encode(
    ["string", "string", "address", "bytes"],
    [
      config.TOKEN_NAME,
      config.TOKEN_SYMBOL,
      multisend.address,
      initalizationActions,
    ]
  );
}

describe("Baal contract", function () {
  let baal: Baal;
  let shamanBaal: Baal;
  let weth: TestErc20;
  let multisend: MultiSend;

  let applicant: SignerWithAddress;
  let summoner: SignerWithAddress;
  let shaman: SignerWithAddress;

  let proposal: { [key: string]: any };

  let encodedInitParams: any;

  const loot = 500;
  const shares = 100;
  const sharesPaused = false;
  const lootPaused = false;

  const yes = true;
  const no = false;

  beforeEach(async function () {
    const BaalContract = await ethers.getContractFactory("Baal");
    const MultisendContract = await ethers.getContractFactory("MultiSend");
    [summoner, applicant, shaman] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("TestERC20");
    weth = (await ERC20.deploy("WETH", "WETH", 10000000)) as TestErc20;

    multisend = (await MultisendContract.deploy()) as MultiSend;

    baal = (await BaalContract.deploy()) as Baal;
    shamanBaal = baal.connect(shaman); // needed to send txns to baal as the shaman
    
    encodedInitParams = await getBaalParams(
      baal, 
      multisend, 
      deploymentConfig,
      false, false, 
      [[weth.address]], 
      [[shaman.address], true], 
      [[summoner.address], [shares]], 
      [[summoner.address], [loot]]
    )

    await baal.setUp(encodedInitParams);

    const selfTransferAction = encodeMultiAction(
      multisend,
      ["0x"],
      [baal.address],
      [BigNumber.from(0)],
      [0]
    );

    proposal = {
      flag: 0,
      votingPeriod: 175000,
      account: summoner.address,
      data: selfTransferAction,
      details: "all hail baal",
      expiration: 0,
      revertOnFailure: true,
    };
  });

  describe("constructor", function () {
    it("verify deployment parameters", async function () {
      const decimals = await baal.decimals();
      expect(decimals).to.equal(18);

      const gracePeriod = await baal.gracePeriod();
      expect(gracePeriod).to.equal(deploymentConfig.GRACE_PERIOD_IN_SECONDS);

      const votingPeriod = await baal.votingPeriod();
      expect(votingPeriod).to.equal(
        deploymentConfig.VOTING_PERIOD_IN_SECONDS
      );

      const proposalOffering = await baal.proposalOffering();
      expect(proposalOffering).to.equal(deploymentConfig.PROPOSAL_OFFERING);

      const name = await baal.name();
      expect(name).to.equal(deploymentConfig.TOKEN_NAME);

      const symbol = await baal.symbol();
      expect(symbol).to.equal(deploymentConfig.TOKEN_SYMBOL);

      const lootPaused = await baal.lootPaused();
      expect(lootPaused).to.be.false;

      const sharesPaused = await baal.sharesPaused();
      expect(sharesPaused).to.be.false;

      const shamans = await baal.shamans(shaman.address);
      expect(shamans).to.be.true;

      const guildTokens = await baal.getGuildTokens();
      expect(guildTokens[0]).to.equal(weth.address);

      const summonerData = await baal.members(summoner.address);
      expect(summonerData.loot).to.equal(500);
      expect(summonerData.highestIndexYesVote).to.equal(0);

      expect(await baal.balanceOf(summoner.address)).to.equal(100);

      const totalLoot = await baal.totalLoot();
      expect(totalLoot).to.equal(500);
    });

    it("require fail - initializer (setup) cant be called twice", async function() {
      expect(
        baal.setUp(encodedInitParams)
      ).to.be.revertedWith(revertMessages.molochAlreadyInitialized);
    })
  });

  describe("shaman actions", function () {
    it("mint shares", async function() {
      await shamanBaal.mintShares([summoner.address], [69]);
      expect(await shamanBaal.balanceOf(summoner.address)).to.equal(169);
    })

    it("burn shares", async function() {
      await shamanBaal.burnShares([summoner.address], [69]);
      expect(await shamanBaal.balanceOf(summoner.address)).to.equal(31);
    })

    it("mint loot", async function() {
      await shamanBaal.mintLoot([summoner.address], [69]);
      const summonerData = await baal.members(summoner.address);
      expect(summonerData.loot).to.equal(569);
    })

    it("burn loot", async function() {
      await shamanBaal.burnLoot([summoner.address], [69]);
      const summonerData = await baal.members(summoner.address);
      expect(summonerData.loot).to.equal(431);
    })
  })

  describe("submitProposal", function () {
    it("happy case", async function () {
      // note - this also tests that members can submit proposals without offering tribute
      // note - this also tests that member proposals are self-sponsored (bc votingStarts != 0)
      const countBefore = await baal.proposalCount();

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );

      const now = await blockTime()

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);

      const proposalData = await baal.proposals(1);
      expect(proposalData.id).to.equal(1)
      expect(proposalData.votingStarts).to.equal(now)
      expect(proposalData.votingEnds).to.equal(now + deploymentConfig.VOTING_PERIOD_IN_SECONDS)
      expect(proposalData.yesVotes).to.equal(0)
      expect(proposalData.noVotes).to.equal(0)
      expect(proposalData.actionFailed).to.equal(false)
      expect(proposalData.expiration).to.equal(proposal.expiration)
      expect(proposalData.details).to.equal(ethers.utils.id(proposal.details))
      // TODO test data hash is accurate 
    });
  });

  describe("sponsorProposal", function () {
    it("happy case", async function () {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );

      const proposalData = await baal.proposals(1);
      expect(proposalData.votingStarts).to.equal(0)
      
      await baal.sponsorProposal(1)
      const now = await blockTime()
      const proposalDataSponsored = await baal.proposals(1);
      expect(proposalDataSponsored.votingStarts).to.equal(now)
      expect(proposalDataSponsored.votingEnds).to.equal(now + deploymentConfig.VOTING_PERIOD_IN_SECONDS)
    });

    it("require fail - not member", async function() {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );

      expect(
        shamanBaal.sponsorProposal(1)
      ).to.be.revertedWith(revertMessages.sponsorProposalMember)
    })

    it("require fail - proposal doesnt exist", async function() {
      expect(
        baal.sponsorProposal(1)
      ).to.be.revertedWith(revertMessages.sponsorProposalExists)
    })

    it("require fail - already sponsored", async function() {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );

      const proposalData = await baal.proposals(1);
      expect(proposalData.votingStarts).to.equal(0)
      await baal.sponsorProposal(1)
      expect(
        baal.sponsorProposal(1)
      ).to.be.revertedWith(revertMessages.sponsorProposalSponsored)
    })
  });

  describe("submitVote", function () {
    beforeEach(async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
    });

    it("happy case - yes vote", async function () {
      await baal.submitVote(1, yes);
      const prop = await baal.proposals(1);
      const nCheckpoints = await baal.numCheckpoints(summoner.address);
      const votes = (
        await baal.checkpoints(summoner.address, nCheckpoints.sub(1))
      ).votes;
      const priorVotes = await baal.getPriorVotes(
        summoner.address,
        prop.votingStarts
      );
      expect(priorVotes).to.equal(votes)
      expect(prop.yesVotes).to.equal(votes);

      const summonerData = await baal.members(summoner.address);
      expect(summonerData.highestIndexYesVote).to.equal(1);
    });

    it("happy case - no vote", async function () {
      await baal.submitVote(1, no);
      const prop = await baal.proposals(1);
      const nCheckpoints = await baal.numCheckpoints(summoner.address);
      const votes = (
        await baal.checkpoints(summoner.address, nCheckpoints.sub(1))
      ).votes;
      expect(prop.noVotes).to.equal(votes);

      const summonerData = await baal.members(summoner.address);
      expect(summonerData.highestIndexYesVote).to.equal(0);
    });

    it("require fail - voting period has ended", async function () {
      await moveForwardPeriods(2);
      expect(baal.submitVote(1, no)).to.be.revertedWith(
        revertMessages.submitVoteTimeEnded
      );
    });

    it("require fail - already voted", async function () {
      await baal.submitVote(1, yes);
      expect(baal.submitVote(1, yes)).to.be.revertedWith(
        revertMessages.submitVoteVoted
      );
    });

    it("require fail - not a member", async function () {
      expect(shamanBaal.submitVote(1, yes)).to.be.revertedWith(
        revertMessages.submitVoteMember
      );
    });
  });

  describe.only("processProposal", function () {
    it("happy case yes wins", async function () {
      const beforeProcessed = await baal.proposals(1);
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.revertOnFailure, proposal.data);
      const afterProcessed = await baal.proposals(1);
      expect(afterProcessed).to.deep.equal(beforeProcessed);
      /* TODO test that execution happened*/
      expect(await baal.proposalsPassed(1)).to.equal(true);
    });

    it("happy case no wins", async function () {
      const beforeProcessed = await baal.proposals(1);
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, no);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.revertOnFailure, proposal.data);
      const afterProcessed = await baal.proposals(1);
      expect(afterProcessed).to.deep.equal(beforeProcessed);
      /* TODO test that execution was skipped*/
      expect(await baal.proposalsPassed(1)).to.equal(false);
    });

    it("require fail - proposal does not exist", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      expect(
        baal.processProposal(2, proposal.revertOnFailure, proposal.data)
      ).to.be.revertedWith("!exist");
    });

    it("require fail - prev proposal not processed", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(2, yes);
      await moveForwardPeriods(2);
      expect(
        baal.processProposal(2, proposal.revertOnFailure, proposal.data)
      ).to.be.revertedWith("prev!processed");
    });

    it("require fail - proposal data mismatch on processing", async function () {
      const beforeProcessed = await baal.proposals(1);
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
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
      expect(
        baal.processProposal(1, proposal.revertOnFailure, badSelfTransferAction)
      ).to.be.revertedWith("incorrect calldata");
    });
  });

  describe("ragequit", function () {
    beforeEach(async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
    });

    it("happy case - full ragequit", async function () {
      const lootBefore = (await baal.members(summoner.address)).loot;
      await baal.ragequit(summoner.address, loot, shares);
      const lootAfter = (await baal.members(summoner.address)).loot;
      expect(lootAfter).to.equal(lootBefore.sub(loot));
    });

    it("happy case - partial ragequit", async function () {
      const lootBefore = (await baal.members(summoner.address)).loot;
      const lootToBurn = 200;
      const sharesToBurn = 70;
      await baal.ragequit(summoner.address, lootToBurn, sharesToBurn);
      const lootAfter = (await baal.members(summoner.address)).loot;
      expect(lootAfter).to.equal(lootBefore.sub(lootToBurn));
    });

    it("require fail - proposal voting has not ended", async function () {
      const lootBefore = (await baal.members(summoner.address)).loot;
      await baal.submitVote(1, yes);
      expect(baal.ragequit(summoner.address, loot, shares)).to.be.revertedWith(
        "processed"
      );
    });
  });

  describe("getCurrentVotes", function () {
    it("happy case - account with votes", async function () {
      const currentVotes = await baal.getCurrentVotes(summoner.address);
      const nCheckpoints = await baal.numCheckpoints(summoner.address);
      const checkpoints = await baal.checkpoints(
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
        ethers.utils.id(proposal.details)
      );
    });

    it("happy case - yes vote", async function () {
      const blockT = await blockTime();
      await baal.submitVote(1, yes);
      const priorVote = await baal.getPriorVotes(summoner.address, blockT);
      const nCheckpoints = await baal.numCheckpoints(summoner.address);
      const votes = (
        await baal.checkpoints(summoner.address, nCheckpoints.sub(1))
      ).votes;
      expect(priorVote).to.equal(votes);
    });

    it("happy case - no vote", async function () {
      const blockT = await blockTime();
      await baal.submitVote(1, no);
      const priorVote = await baal.getPriorVotes(summoner.address, blockT);
      const nCheckpoints = await baal.numCheckpoints(summoner.address);
      const votes = (
        await baal.checkpoints(summoner.address, nCheckpoints.sub(1))
      ).votes;
      expect(priorVote).to.equal(votes);
    });

    it("require fail - timestamp not determined", async function () {
      const blockT = await blockTime();
      expect(baal.getPriorVotes(summoner.address, blockT)).to.be.revertedWith(
        "!determined"
      );
    });
  });
});

describe("Baal contract - tribute required", function () {
  let customConfig = { ...deploymentConfig, PROPOSAL_OFFERING: 69 }

  let baal: Baal;
  let shamanBaal: Baal;
  let weth: TestErc20;
  let multisend: MultiSend;

  let applicant: SignerWithAddress;
  let summoner: SignerWithAddress;
  let shaman: SignerWithAddress;

  let proposal: { [key: string]: any };

  let encodedInitParams: any;

  const loot = 500;
  const shares = 100;
  const sharesPaused = false;
  const lootPaused = false;

  beforeEach(async function () {
    const BaalContract = await ethers.getContractFactory("Baal");
    const MultisendContract = await ethers.getContractFactory("MultiSend");
    [summoner, applicant, shaman] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("TestERC20");
    weth = (await ERC20.deploy("WETH", "WETH", 10000000)) as TestErc20;

    multisend = (await MultisendContract.deploy()) as MultiSend;

    baal = (await BaalContract.deploy()) as Baal;
    shamanBaal = baal.connect(shaman); // needed to send txns to baal as the shaman

    const encodedInitParams = await getBaalParams(
      baal, 
      multisend, 
      customConfig, 
      false, false, 
      [[weth.address]], 
      [[shaman.address], true], 
      [[summoner.address], [shares]], 
      [[summoner.address], [loot]]
    )

    await baal.setUp(encodedInitParams);

    const selfTransferAction = encodeMultiAction(
      multisend,
      ["0x"],
      [baal.address],
      [BigNumber.from(0)],
      [0]
    );

    proposal = {
      flag: 0,
      votingPeriod: 175000,
      account: summoner.address,
      data: selfTransferAction,
      details: "all hail baal",
      expiration: 0,
      revertOnFailure: true,
    };
  });

  describe("submitProposal", function () {
    it("happy case - tribute is accepted, not self-sponsored", async function() {
      // note - this also tests that the proposal is NOT sponsored
      const countBefore = await baal.proposalCount();

      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details),
        { value: 69 }
      );

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);

      const proposalData = await baal.proposals(1);
      expect(proposalData.id).to.equal(1)
      expect(proposalData.votingStarts).to.equal(0)
    })

    it("happy case - member can submit without tribute", async function() {
      const countBefore = await baal.proposalCount();

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore + 1);
    })

    it("require fail - no tribute offered", async function() {
      expect(
        shamanBaal.submitProposal(
          proposal.data,
          proposal.expiration,
          ethers.utils.id(proposal.details)
        )
      ).to.be.revertedWith(revertMessages.submitProposalOffering);
    })
  })
})