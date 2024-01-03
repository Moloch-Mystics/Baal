import * as fs from "fs";
import { ethers } from "ethers";
import { task } from "hardhat/config";

import { BigNumber } from "@ethersproject/bignumber";
import { encodeMultiSend, MetaTransaction } from "@gnosis.pm/safe-contracts";

import { deployments as currentDeployments } from '../src/addresses/deployed';
import { getSetupAddresses } from '../src/addresses/setup';


type SupportedNetwork = keyof typeof currentDeployments[0]['v103'];

const DEBUG = true;

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

task("baal:delegate", "Delegate shares")
  .addParam("dao", "Dao address")
  .addParam("to", "delegate to")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = Baal.attach(taskArgs.dao);
    const Shares = await hre.ethers.getContractFactory("SharesERC20");
    const shares = Shares.attach(baal.address);
    const delegateVotes = await shares.delegate(taskArgs.to);
    console.log("Delegate votes txhash:", delegateVotes.hash);
  });

task("baal:ragequit", "Ragequit shares and/or loot")
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
    const baal = Baal.attach(taskArgs.dao);
    const tokens = JSON.parse(taskArgs.tokens);
    const ragequitAction = await baal.ragequit(
      taskArgs.to,
      taskArgs.shares,
      taskArgs.loot,
      tokens
    );
    console.log("Ragequit txhash:", ragequitAction.hash);
  });

task("baal:tribute-prop", "Approve token and make a tribute proposal")
  .addParam("dao", "Dao address")
  .addParam("minion", "Tribute Minion address")
  .addParam("token", "Tribute token address")
  .addParam("amount", "Tribute token amount")
  .addParam("shares", "Tribute shares requested")
  .addParam("loot", "Tribute loot requested")
  .addParam("baalGas", "Tribute baal gas date. 0 for none")
  .addParam("expiration", "Tribute expiration date. 0 for ignore")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = Baal.attach(taskArgs.dao);
    const Token = await hre.ethers.getContractFactory("TestERC20");
    const token = Token.attach(taskArgs.token);
    const Minion = await hre.ethers.getContractFactory("TributeMinion");
    const minion = Minion.attach(taskArgs.minion);
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
      taskArgs.baalGas,
      "tribute from cli"
    );
    console.log("Tribute proposal submitted txhash:", tributeProposal.hash);
  });

task("baal:cancel-prop", "Cancel a proposal")
  .addParam("dao", "Dao address")
  .addParam("id", "Proposal ID")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = Baal.attach(taskArgs.dao);
    // TODO: pull event data from etherscan
    const cancelProposal = await baal.cancelProposal(taskArgs.id);
    console.log("Proposal processed txhash:", cancelProposal.hash);
  });

task("baal:process-prop", "Process a proposal")
  .addParam("dao", "Dao address")
  .addParam("id", "Proposal ID")
  .addParam("data", "the data, need to get this from the submit events")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = Baal.attach(taskArgs.dao);
    // TODO: pull event data from etherscan
    const processProposal = await baal.processProposal(
      taskArgs.id,
      taskArgs.data
    );
    console.log("Proposal processed txhash:", processProposal.hash);
  });

task("baal:vote-prop", "Vote on a proposal")
  .addParam("dao", "Dao address")
  .addParam("id", "Proposal ID")
  .addParam("approve", "true is yes and false is no")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = Baal.attach(taskArgs.dao);
    const submitVote = await baal.submitVote(
      taskArgs.id,
      taskArgs.approve === "true"
    );
    console.log("Proposal voted on txhash:", submitVote.hash);
  });

task("baal:sponsor-prop", "Status of a proposal")
  .addParam("dao", "Dao address")
  .addParam("id", "Proposal ID")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = Baal.attach(taskArgs.dao);
    const proposal = await baal.sponsorProposal(taskArgs.id);
    console.log("Proposal sponsored txhash:", proposal.hash);
  });

task("baal:status-prop", "Status of a proposal")
  .addParam("dao", "Dao address")
  .addParam("id", "Proposal ID")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = Baal.attach(taskArgs.dao);
    const proposal = await baal.proposals(taskArgs.id);
    console.log("Proposal status:", proposal);
  });

task("baal:getlatest-prop", "Current Proposal info")
  .addParam("dao", "Dao address")
  .setAction(async (taskArgs, hre) => {
    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = Baal.attach(taskArgs.dao);
    const count = await baal.functions.proposalCount();
    const lastSponsored = await baal.latestSponsoredProposalId();
    console.log("the current proposal count is:", count);
    console.log("the last proposal sponsored is:", lastSponsored);
  });

task("baal:member-prop", "Submits a new member proposal")
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
    const { deployments, getChainId, network } = hre;
    const chainId = await getChainId();
    const _addresses = await getSetupAddresses(chainId, network, deployments);

    const encodeMultiAction2 = (
      multisend: any,
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
    const multisend = MultisendContract.attach(
      _addresses.gnosisMultisendLibrary
    );

    const block = await hre.ethers.provider.getBlock("latest");

    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = Baal.attach(taskArgs.dao);
    const countBefore = await baal.proposalCount();
    console.log("countBefore", countBefore);

    const mintLootAction = baal.interface.encodeFunctionData("mintLoot", [
      [taskArgs.applicant],
      [taskArgs.loot],
    ]);
    const mintSharesAction = baal.interface.encodeFunctionData(
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

    const now = block.timestamp;
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


task("baal:shaman-prop", "Submits a new shman proposal")
  .addParam("dao", "Dao address")
  .addParam("shaman", "shaman address")
  .addParam("permissions", "permission number")
  .addParam(
    "expiration",
    "seconds after grace that proposal expires, 0 for none"
  )
  .addOptionalParam("meta", "updated meta data")
  .setAction(async (taskArgs, hre) => {
    const { deployments, getChainId, network } = hre;
    const chainId = await getChainId();
    const _addresses = await getSetupAddresses(chainId, network, deployments);

    const encodeMultiAction2 = (
      multisend: any,
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
    const multisend = MultisendContract.attach(
      _addresses.gnosisMultisendLibrary
    );

    const block = await hre.ethers.provider.getBlock("latest");

    const Baal = await hre.ethers.getContractFactory("Baal");
    const baal = Baal.attach(taskArgs.dao);
    const countBefore = await baal.proposalCount();
    console.log("countBefore", countBefore);

    const addShamanAction = baal.interface.encodeFunctionData("setShamans", [
      [taskArgs.shaman],
      [taskArgs.permissions],
    ]);

    const metadataConfig = {
      CONTENT: taskArgs.meta || '{"name":"test shaman proposal"}',
      TAG: "daohaus.proposal.metadata",
    };

    const now = await block.timestamp;
    const voting = await baal.votingPeriod();
    const grace = await baal.gracePeriod();

    const encodedAction = encodeMultiAction2(
      multisend,
      [addShamanAction],
      [baal.address],
      [BigNumber.from(0)],
      [0, 0, 0]
    );

    console.log("********encoded data*********");
    console.log(encodedAction);
    console.log("*****************************");
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

/* example:
npx hardhat summon --factory 0xe2F42d9fd5C1a590F6c3d6b2A27802C0da93FEb7 
--summoners [\"0xadc...\"] 
--shares [\"10000000000000000000\"] --loot [\"10000000000000000000\"] 
--sharespaused false --lootpaused false 
--shaman 0xadc... --name gB447  --network goerli
*/
task("baal:summon", "Summons a new DAO")
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
  .addOptionalParam("withsidecar", "add a vault (factory address)")
  .setAction(async (taskArgs, hre) => {
    const { deployments, getChainId, network } = hre;
    const chainId = await getChainId();
    const _addresses = await getSetupAddresses(chainId, network, deployments);

    const zeroAddress = ethers.constants.AddressZero;
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
      baal: any,
      poster: any,
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
          ["string", "string", "address", "address", "address", "address","string","string"],
          [
            config.TOKEN_NAME,
            config.TOKEN_SYMBOL,
            zeroAddress,
            zeroAddress,
            zeroAddress,
            zeroAddress,
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
    const contract = baalSummoner.attach(taskArgs.factory);

    const baalTemplateAddr = await contract.template();
    console.log("baalTemplateAddr", baalTemplateAddr);

    const posterFactory = await hre.ethers.getContractFactory("Poster");
    const posterAddress = _addresses.poster;
    console.log("posterAddress", posterAddress);

    const poster = posterFactory.attach(posterAddress);
    console.log("**********************");

    const Baal = await hre.ethers.getContractFactory("Baal");
    const baalSingleton = Baal.attach(baalTemplateAddr);
    const MultisendContract = await hre.ethers.getContractFactory("MultiSend");
    const multisend = MultisendContract.attach(
      _addresses.gnosisMultisendLibrary
    );

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
    let tx;
    if(taskArgs.withsidecar){
      const baalVaultSummoner = await hre.ethers.getContractFactory("BaalAndVaultSummoner");
      const contractVault = baalVaultSummoner.attach(taskArgs.withsidecar);
      console.log("summon ball and vault from tasks");

      tx = await contractVault.summonBaalAndVault(
        encodedInitParams.initParams,
        encodedInitParams.initalizationActions,
        randomSeed,
        hre.ethers.utils.formatBytes32String("daohausCLI"),
        "test cli vault"
      );
    } else {
      console.log("summon ball from tasks");
      
      tx = await contract.summonBaalFromReferrer(
        encodedInitParams.initParams,
        encodedInitParams.initalizationActions,
        randomSeed,
        hre.ethers.utils.formatBytes32String("daohausCLI")
      );
    }

    console.log(taskArgs);
    console.log("tx:", tx.hash);
    const deployers = await hre.ethers.getSigners();
    const address = await deployers[0].getAddress();
    const balance = await deployers[0].getBalance();
    console.log("Account address:", address);
    console.log("Account balance:", hre.ethers.utils.formatEther(balance));
  });


  /* example:
npx hardhat summonAdvToken --factory 0x68aA3E7389AC60563dE2fBdCCa06Df79e011043A 
--summoners [\"0xCED608Aa29bB92185D9b6340Adcbfa263DAe075b\",\"0x83ab8e31df35aa3281d630529c6f4bf5ac7f7abf\"] 
--shares [\"10000000000000000000\", \"10000000000000000000\"] --loot [\"10000000000000000000\"] 
--sharespaused false --lootpaused false 
--name gB447  --lootname gb447L007 --network goerli
*/
task("baal:summon-advToken", "Summons a new DAO from Higher order factory")
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
.addParam("name", "share token symbol")
.addParam("lootname", "loot token symbol")
.addOptionalParam("meta", "updated meta data")
.setAction(async (taskArgs, hre) => {
  const { deployments, getChainId, network } = hre;
  const chainId = await getChainId();
  const _addresses = {
    ...await getSetupAddresses(chainId, network, deployments),
    baalDefaultSingleton: network.name === 'hardhat'
      ? (await deployments.get('Baal'))?.address
      : currentDeployments[0]['v103'][network.name as SupportedNetwork]?.addresses?.baalSingleton
  }
  const zeroAddress = ethers.constants.AddressZero;
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
    baal: any,
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
      LOOT_TOKEN_NAME: any;
      LOOT_TOKEN_SYMBOL: any;
      LOOT_TOKEN_TRANSFERABLE: any;
      TOKEN_TRANSFERABLE: any;
    }
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

    const metadataConfig = {
      CONTENT: taskArgs.meta || '{"name":"test proposal"}',
      TAG: "daohaus.proposal.metadata",
    };

    const setGovernanceConfig = await baal.interface.encodeFunctionData(
      "setGovernanceConfig",
      [governanceConfig]
    );

    const postMetaData = poster.interface.encodeFunctionData("post", [
      metadataConfig.CONTENT,
      metadataConfig.TAG,
    ]);
    const posterFromBaal = await baal.interface.encodeFunctionData(
      "executeAsBaal",
      [poster.address, 0, postMetaData]
    );

    const initalizationActions = [
      setGovernanceConfig,
      posterFromBaal
    ];


    return {
      initParams: abiCoder.encode(
        ["string", "string", "string", "string", "bool", "bool"],
        [
          config.TOKEN_NAME,
          config.TOKEN_SYMBOL,
          config.LOOT_TOKEN_NAME,
          config.LOOT_TOKEN_SYMBOL,
          config.LOOT_TOKEN_TRANSFERABLE,
          config.TOKEN_TRANSFERABLE,
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
    LOOT_TOKEN_NAME: "Baal CUST Loot",
    LOOT_TOKEN_SYMBOL: taskArgs.lootname,
    LOOT_TOKEN_TRANSFERABLE: taskArgs.lootpaused,
    TOKEN_TRANSFERABLE: taskArgs.sharespaused,
  };
  

  const baalSummoner = await hre.ethers.getContractFactory("BaalAdvTokenSummoner");
  const contract = baalSummoner.attach(taskArgs.factory);

  const posterFactory = await hre.ethers.getContractFactory("Poster");
  const posterAddress = _addresses.poster;
  console.log("posterAddress", posterAddress);

  const poster = posterFactory.attach(posterAddress);
  console.log("**********************");

  const Baal = await hre.ethers.getContractFactory("Baal");
  const baalSingleton = Baal.attach(_addresses.baalDefaultSingleton);
  const MultisendContract = await hre.ethers.getContractFactory("MultiSend");
  const multisend = MultisendContract.attach(
    _addresses.gnosisMultisendLibrary
  );

  encodedInitParams = await getBaalParams(
    baalSingleton,
    deploymentConfig
  );

  const randomSeed = Math.floor(Math.random() * 10000000);
  let tx;
  
  console.log("summon ball from tasks", encodedInitParams);
  
  tx = await contract.summonBaalFromReferrer(
    zeroAddress,
    zeroAddress,
    randomSeed,
    abiCoder.encode(
      ["address[]", "uint256[]", "uint256[]"],
      [
        summonerArr,
        sharesArr,
        lootArr
      ]
    ),
    encodedInitParams.initParams,
    encodedInitParams.initalizationActions
      );
  
  console.log(taskArgs);
  // console.log("tx:", tx?.hash);
  const deployers = await hre.ethers.getSigners();
  const address = await deployers[0].getAddress();
  const balance = await deployers[0].getBalance();
  console.log("Account address:", address);
  console.log("Account balance:", hre.ethers.utils.formatEther(balance));
});