import "@nomiclabs/hardhat-ethers";
import { task, HardhatUserConfig } from "hardhat/config";
import * as fs from "fs";

import { BaalSummoner } from "../src/types/BaalSummoner";
import { Baal } from "../src/types/Baal";
import { MultiSend } from "../src/types/MultiSend";
import { Loot } from "../src/types/Loot";
import { Shares } from "../src/types/Shares";
import { Poster } from "../src/types/Poster";
// import { decodeMultiAction, encodeMultiAction, hashOperation } from './src/util'
import { encodeMultiSend, MetaTransaction } from "@gnosis.pm/safe-contracts";

import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { TestErc20 } from "../src/types/TestErc20";
import { TributeMinion } from "../src/types/TributeMinion";

const _addresses = {
  gnosisSingleton: "0xd9db270c1b5e3bd161e8c8503c55ceabee709552",
  gnosisFallbackLibrary: "0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4",
  gnosisMultisendLibrary: "0xa238cbeb142c10ef7ad8442c6d1f9e89e07e7761",
  poster: "0x000000000000cd17345801aa8147b8D3950260FF",
  posterKovan: "0x37A2080f275E26fFEfB6E68F3005826368156C5C",
};

const DEBUG = false;

task(
  "generate",
  "Create a mnemonic for builder deploys",
  async (_, { ethers }) => {
    const bip39 = require("bip39");
    const hdkey = require("ethereumjs-wallet/hdkey");
    const mnemonic = bip39.generateMnemonic();
    if (DEBUG) console.log("mnemonic", mnemonic);
    const seed = await bip39.mnemonicToSeed(mnemonic);
    if (DEBUG) console.log("seed", seed);
    const hdwallet = hdkey.fromMasterSeed(seed);
    const wallet_hdpath = "m/44'/60'/0'/0/";
    const account_index = 0;
    let fullPath = wallet_hdpath + account_index;
    if (DEBUG) console.log("fullPath", fullPath);
    const wallet = hdwallet.derivePath(fullPath).getWallet();
    const privateKey = "0x" + wallet._privKey.toString("hex");
    if (DEBUG) console.log("privateKey", privateKey);
    var EthUtil = require("ethereumjs-util");
    const address =
      "0x" + EthUtil.privateToAddress(wallet._privKey).toString("hex");
    console.log(
      "🔐 Account Generated as " +
        address +
        " and set as mnemonic in packages/hardhat"
    );
    console.log(
      "💬 Use 'yarn run account' to get more information about the deployment account."
    );

    fs.writeFileSync("../" + address + ".txt", mnemonic.toString());
    fs.writeFileSync("../mnemonic.txt", mnemonic.toString());
  }
);

/* DAO tasks */
/* TODO: DAO amin tasks */

task("delegate", "Delegate shares")
  .addParam("dao", "Dao address")
  .addParam("to", "delegate to")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = (await Baal.attach(taskArgs.dao)) as Baal;
    const delegateVotes = await baal.delegate(taskArgs.to);
    console.log("Delegate votes txhash:", delegateVotes.hash);
  });

task("ragequit", "Ragequit shares and/or loot")
  .addParam("dao", "Dao address")
  .addParam("to", "RQ to")
  .addParam("shares", "number of shares")
  .addParam("loot", "number of loot")
  .addParam(
    "tokens",
    'the token addresses (array) (escape quotes) (no spaces) ex [\\"0x123...\\"]'
  )
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = (await Baal.attach(taskArgs.dao)) as Baal;
    const tokens = JSON.parse(taskArgs.tokens);
    const ragequitAction = await baal.ragequit(
      taskArgs.to,
      taskArgs.shares,
      taskArgs.loot,
      tokens
    );
    console.log("Ragequit txhash:", ragequitAction.hash);
  });

task("tributeprop", "Approve token and make a tribute proposal")
  .addParam("dao", "Dao address")
  .addParam("minion", "Tribute Minion address")
  .addParam("token", "Tribute token address")
  .addParam("amount", "Tribute token amount")
  .addParam("shares", "Tribute shares requested")
  .addParam("loot", "Tribute loot requested")
  .addParam("expiration", "Tribute expiration date. 0 for none")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = (await Baal.attach(taskArgs.dao)) as Baal;
    const Token = await hre.ethers.getContractFactory("TestERC20");
    const token = (await Token.attach(taskArgs.token)) as TestErc20;
    const Minion = await hre.ethers.getContractFactory("TributeMinion");
    const minion = (await Minion.attach(taskArgs.minion)) as TributeMinion;
    const countBefore = await baal.proposalCount();
    console.log("countBefore", countBefore);
    const deployers = await hre.ethers.getSigners();
    const address = await deployers[0].getAddress();
    // approve
    const approve = await token.approve(taskArgs.minion, taskArgs.amount);
    const encoded = await minion.encodeTributeProposal(
      taskArgs.dao,
      taskArgs.shares,
      taskArgs.loot,
      address,
      countBefore + 1,
      taskArgs.minion
    );
    console.log("*****encoded proposal******");
    console.log(encoded);
    console.log("***************************");

    const tributeProposal = await minion.submitTributeProposal(
      taskArgs.dao,
      taskArgs.token,
      taskArgs.amount,
      taskArgs.shares,
      taskArgs.loot,
      taskArgs.expiration,
      "tribute from cli"
    );
    console.log("Tribute proposal submitted txhash:", tributeProposal.hash);
  });

task("cancelprop", "Cancel a proposal")
  .addParam("dao", "Dao address")
  .addParam("id", "Proposal ID")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = (await Baal.attach(taskArgs.dao)) as Baal;
    // TODO: pull event data from etherscan
    const cancelProposal = await baal.cancelProposal(taskArgs.id);
    console.log("Proposal processed txhash:", cancelProposal.hash);
  });

task("processprop", "Process a proposal")
  .addParam("dao", "Dao address")
  .addParam("id", "Proposal ID")
  .addParam("data", "the data, need to get this from the submit events")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = (await Baal.attach(taskArgs.dao)) as Baal;
    // TODO: pull event data from etherscan
    const processProposal = await baal.processProposal(
      taskArgs.id,
      taskArgs.data
    );
    console.log("Proposal processed txhash:", processProposal.hash);
  });

task("voteprop", "Vote on a proposal")
  .addParam("dao", "Dao address")
  .addParam("id", "Proposal ID")
  .addParam("approve", "true is yes and false is no")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = (await Baal.attach(taskArgs.dao)) as Baal;
    const submitVote = await baal.submitVote(
      taskArgs.id,
      taskArgs.approve === "true"
    );
    console.log("Proposal voted on txhash:", submitVote.hash);
  });

task("sponsorprop", "Status of a proposal")
  .addParam("dao", "Dao address")
  .addParam("id", "Proposal ID")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = (await Baal.attach(taskArgs.dao)) as Baal;
    const proposal = await baal.sponsorProposal(taskArgs.id);
    console.log("Proposal sponsored txhash:", proposal.hash);
  });

task("statusprop", "Status of a proposal")
  .addParam("dao", "Dao address")
  .addParam("id", "Proposal ID")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = (await Baal.attach(taskArgs.dao)) as Baal;
    const proposal = await baal.proposals(taskArgs.id);
    console.log("Proposal status:", proposal);
  });
task("infoprops", "Current Proposal info")
  .addParam("dao", "Dao address")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = (await Baal.attach(taskArgs.dao)) as Baal;
    const count = await baal.proposalCount();
    const lastSponsored = await baal.latestSponsoredProposalId();
    console.log("the current proposal count is:", count);
    console.log("the last proposal sponsored is:", lastSponsored);
  });

task("memberprop", "Submits a new member proposal")
  .addParam("dao", "Dao address")
  .addParam("applicant", "applicant address")
  .addParam("shares", "number shares")
  .addParam("loot", "number loot")
  .addParam(
    "expiration",
    "seconds after grace that proposal expires, 0 for none"
  )
  .addOptionalParam("meta", "updated meta data")
  .setAction(async (taskArgs, hre) => {
    const encodeMultiAction2 = (
      multisend: MultiSend,
      actions: string[],
      tos: string[],
      values: BigNumber[],
      operations: number[]
    ) => {
      let metatransactions: MetaTransaction[] = [];
      for (let index = 0; index < actions.length; index++) {
        metatransactions.push({
          to: tos[index],
          value: values[index],
          data: actions[index],
          operation: operations[index],
        });
      }
      const encodedMetatransactions = encodeMultiSend(metatransactions);
      const multi_action = multisend.interface.encodeFunctionData("multiSend", [
        encodedMetatransactions,
      ]);
      return multi_action;
    };

    const MultisendContract = await hre.ethers.getContractFactory("MultiSend");
    const multisend = (await MultisendContract.attach(
      _addresses.gnosisMultisendLibrary
    )) as MultiSend;

    const block = await hre.ethers.provider.getBlock("latest");

    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = (await Baal.attach(taskArgs.dao)) as Baal;
    const countBefore = await baal.proposalCount();
    console.log("countBefore", countBefore);

    const mintLootAction = await baal.interface.encodeFunctionData("mintLoot", [
      [taskArgs.applicant],
      [taskArgs.loot],
    ]);
    const mintSharesAction = await baal.interface.encodeFunctionData(
      "mintShares",
      [[taskArgs.applicant], [taskArgs.shares]]
    );
    const metadataConfig = {
      CONTENT: taskArgs.meta || '{"name":"test proposal"}',
      TAG: "daohaus.proposal.metadata",
    };
    // const posterFactory = await hre.ethers.getContractFactory("Poster");
    // const poster = (await posterFactory.attach(_addresses.poster)) as Poster;
    // const postMetaData = await poster.interface.encodeFunctionData("post", [
    //   metadataConfig.CONTENT,
    //   metadataConfig.TAG,
    // ]);
    // const posterFromBaal = await baal.interface.encodeFunctionData(
    //   "executeAsBaal",
    //   [poster.address, 0, postMetaData]
    // );

    const now = await block.timestamp;
    const voting = await baal.votingPeriod();
    const grace = await baal.gracePeriod();

    const encodedAction = encodeMultiAction2(
      multisend,
      [mintLootAction, mintSharesAction],
      [baal.address, baal.address],
      [BigNumber.from(0), BigNumber.from(0)],
      [0, 0, 0]
    );

    console.log("********encoded data*********");
    console.log(encodedAction);
    console.log("*****************************");
    // TODO: poster should happen here probably, if in encodeAction it will run after processing
    const submit = await baal.submitProposal(
      encodedAction,
      parseInt(taskArgs.expiration)
        ? now + voting + grace + parseInt(taskArgs.expiration)
        : 0,
      0,
      metadataConfig.CONTENT // hre.ethers.utils.id("all hail baal")
    );
    console.log("tx:", submit.hash);
  });

task("summon", "Summons a new DAO")
  .addParam("factory", "Dao factory address")
  .addParam(
    "summoners",
    'the summoner addresses (array) (escape quotes) (no spaces) ex [\\"0x123...\\"]'
  )
  .addParam(
    "shares",
    "numnber of initial shares for summoners (string array, escape quotes)"
  )
  .addParam(
    "loot",
    "numnber of initial loot for summoners (string array, escape quotes)"
  )
  .addParam("sharespaused", "are shares transferable")
  .addParam("lootpaused", "is loot transferable")
  .addParam("shaman", "any initial shamans")
  .addParam("name", "share token symbol")
  .addOptionalParam("meta", "updated meta data")
  .setAction(async (taskArgs, hre) => {
    const network = await hre.ethers.provider.getNetwork();
    const chainId = network.chainId;
    const metadataConfig = {
      CONTENT: taskArgs.meta || '{"name":"test"}',
      TAG: "daohaus.summoner.daoProfile",
    };
    let summonerArr;
    let lootArr;
    let sharesArr;

    try {
      summonerArr = JSON.parse(taskArgs.summoners);
      lootArr = JSON.parse(taskArgs.loot);
      sharesArr = JSON.parse(taskArgs.shares);
    } catch (err) {
      throw "loot shares and summoners should be arrays";
    }
    if (
      !Array.isArray(summonerArr) ||
      !Array.isArray(lootArr) ||
      !Array.isArray(sharesArr)
    ) {
      throw "loot shares and summoners should be linked arrays";
    }
    if (
      summonerArr.length !== lootArr.length ||
      lootArr.length !== sharesArr.length
    ) {
      throw "arrays must be of the same length";
    }

    const abiCoder = hre.ethers.utils.defaultAbiCoder;
    const getBaalParams = async function (
      baal: Baal,
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
      const mintLoot = await baal.interface.encodeFunctionData(
        "mintLoot",
        loots
      );
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

      // const initalizationActionsMulti = encodeMultiAction(
      //   multisend,
      //   [setAdminConfig, setGovernanceConfig, setGuildTokens, setShaman, mintShares, mintLoot],
      //   [baal.address, baal.address, baal.address, baal.address, baal.address, baal.address],
      //   [BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0)],
      //   [0, 0, 0, 0, 0, 0]
      // )
      return {
        initParams: abiCoder.encode(
          ["string", "string"],
          [
            config.TOKEN_NAME,
            config.TOKEN_SYMBOL
          ]
        ),
        initalizationActions,
      };
    };

    let encodedInitParams: {
      initParams: string;
      initalizationActions: string[];
    };

    const deploymentConfig = {
      GRACE_PERIOD_IN_SECONDS: 300,
      VOTING_PERIOD_IN_SECONDS: 200,
      PROPOSAL_OFFERING: 0,
      SPONSOR_THRESHOLD: 1,
      MIN_RETENTION_PERCENT: 0,
      MIN_STAKING_PERCENT: 0,
      QUORUM_PERCENT: 0,
      TOKEN_NAME: "Baal Shares",
      TOKEN_SYMBOL: taskArgs.name,
    };

    const baalSummoner = await hre.ethers.getContractFactory("BaalSummoner");
    const contract = await baalSummoner.attach(taskArgs.factory);

    const baalTemplateAddr = await contract.template();
    console.log("baalTemplateAddr", baalTemplateAddr);

    const posterFactory = await hre.ethers.getContractFactory("Poster");
    const posterAddress =
      network.name == "kovan" ? _addresses.posterKovan : _addresses.poster;
    console.log("posterAddress", posterAddress);

    const poster = (await posterFactory.attach(posterAddress)) as Poster;
    console.log("**********************");

    const Baal = await hre.ethers.getContractFactory("Baal");
    const baalSingleton = (await Baal.attach(baalTemplateAddr)) as Baal;
    const MultisendContract = await hre.ethers.getContractFactory("MultiSend");
    const multisend = (await MultisendContract.attach(
      _addresses.gnosisMultisendLibrary
    )) as MultiSend;

    encodedInitParams = await getBaalParams(
      baalSingleton,
      poster,
      deploymentConfig,
      [metadataConfig.CONTENT, metadataConfig.TAG],
      [taskArgs.sharesPaused, taskArgs.lootPaused],
      [[taskArgs.shaman], [7]],
      [summonerArr, sharesArr],
      [summonerArr, lootArr]
    );

    const randomSeed = Math.floor(Math.random() * 10000000);

    const tx = await contract.summonBaalAndSafe(
      encodedInitParams.initParams,
      encodedInitParams.initalizationActions,
      randomSeed
    );

    console.log(taskArgs);
    console.log("tx:", tx.hash);
    const deployers = await hre.ethers.getSigners();
    const address = await deployers[0].getAddress();
    const balance = await deployers[0].getBalance();
    console.log("Account address:", address);
    console.log("Account balance:", hre.ethers.utils.formatEther(balance));
  });
