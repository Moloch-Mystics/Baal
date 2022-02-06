import { ethers } from 'hardhat'
import { solidity } from 'ethereum-waffle'
import { use, expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { Baal } from '../src/types/Baal'
import { TestErc20 } from '../src/types/TestErc20'
import { Loot } from '../src/types/Loot'
import { encodeMultiAction, hashOperation } from '../src/util'
import { BigNumber, BigNumberish } from '@ethersproject/bignumber'
import { buildContractCall } from '@gnosis.pm/safe-contracts'
import { MultiSend } from '../src/types/MultiSend'
import { ContractFactory, utils } from 'ethers'
import { ConfigExtender } from 'hardhat/types'
import { Test } from 'mocha'
import signVote from '../src/signVote'

use(solidity)

// chai
//   .use(require('chai-as-promised'))
//   .should();

const revertMessages = {
  molochAlreadyInitialized: 'Initializable: contract is already initialized',
  molochSetupSharesNoShares: 'shares != 0',
  submitProposalExpired: 'expired',
  submitProposalOffering: 'Baal requires an offering',
  submitProposalVotingPeriod: '!votingPeriod',
  sponsorProposalExpired: 'expired',
  sponsorProposalSponsor: '!sponsor',
  sponsorProposalNotSubmitted: '!submitted',
  submitVoteNotSponsored: '!sponsored',
  submitVoteNotVoting: '!voting',
  submitVoteVoted: 'voted',
  submitVoteMember: '!member',
  submitVoteWithSigTimeEnded: 'ended',
  submitVoteWithSigVoted: 'voted',
  submitVoteWithSigMember: '!member',
  processProposalNotReady: '!ready',
  advancedRagequitUnordered: '!order',
  unsetGuildTokensOutOfBound: 'reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)',
  unsetGuildTokensDescending: '!descending',
  sharesTransferPaused: '!transferable',
  sharesInsufficientBalance: 'reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)',
  sharesInsufficientApproval: 'reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)',
  lootTransferPaused: '!transferable',
  lootInsufficientBalance: "reverted with reason string 'ERC20: transfer amount exceeds balance'",
  lootInsufficientApproval: 'ERC20: transfer amount exceeds allowance',
  mintSharesArrayParity: '!array parity',
  burnSharesArrayParity: '!array parity',
  burnSharesInsufficientShares: 'reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)',
  mintLootArrayParity: '!array parity',
  burnLootArrayParity: '!array parity',
  burnLootInsufficientShares: "reverted with reason string 'ERC20: burn amount exceeds balance'",
  cancelProposalNotVoting: '!voting',
  cancelProposalNotCancellable: '!cancellable',
  baalOrAdmin: '!baal & !admin',
  baalOrManager: '!baal & !manager',
  baalOrGovernor: '!baal & !governor'
}

const STATES = {
  UNBORN: 0,
  SUBMITTED: 1,
  VOTING: 2,
  CANCELLED: 3,
  GRACE: 4,
  READY: 5,
  PROCESSED: 6,
  DEEFEATED: 7
}

const zeroAddress = '0x0000000000000000000000000000000000000000'

async function blockTime() {
  const block = await ethers.provider.getBlock('latest')
  return block.timestamp
}

async function blockNumber() {
  const block = await ethers.provider.getBlock('latest')
  return block.number
}

async function moveForwardPeriods(periods: number, extra?: number) {
  const goToTime = (await blockTime()) + (deploymentConfig.VOTING_PERIOD_IN_SECONDS * periods) + (extra ? extra : 0)
  await ethers.provider.send("evm_mine", [goToTime])
  return true
}

const deploymentConfig = {
  GRACE_PERIOD_IN_SECONDS: 43200,
  VOTING_PERIOD_IN_SECONDS: 432000,
  PROPOSAL_OFFERING: 0,
  SPONSOR_THRESHOLD: 1,
  MIN_RETENTION_PERCENT: 0,
  MIN_STAKING_PERCENT: 0,
  QUORUM_PERCENT: 0,
  TOKEN_NAME: 'Baal Shares',
  TOKEN_SYMBOL: 'BAAL',
}

const abiCoder = ethers.utils.defaultAbiCoder

const getBaalParams = async function (
  baal: Baal,
  multisend: MultiSend,
  lootSingleton: Loot,
  config: {
    PROPOSAL_OFFERING: any
    GRACE_PERIOD_IN_SECONDS: any
    VOTING_PERIOD_IN_SECONDS: any
    QUORUM_PERCENT: any
    SPONSOR_THRESHOLD: any
    MIN_RETENTION_PERCENT: any
    MIN_STAKING_PERCENT: any
    TOKEN_NAME: any
    TOKEN_SYMBOL: any
    
  },
  adminConfig: [boolean, boolean],
  tokens: [string[]],
  shamans: [string[], number[]],
  shares: [string[], number[]],
  loots: [string[], number[]]
) {
  const governanceConfig = abiCoder.encode(
    ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
    [
      config.VOTING_PERIOD_IN_SECONDS, config.GRACE_PERIOD_IN_SECONDS, config.PROPOSAL_OFFERING, config.QUORUM_PERCENT, config.SPONSOR_THRESHOLD,
      config.MIN_RETENTION_PERCENT
    ]
  )

  const setAdminConfig = await baal.interface.encodeFunctionData('setAdminConfig', adminConfig)
  const setGovernanceConfig = await baal.interface.encodeFunctionData('setGovernanceConfig', [governanceConfig])
  const setGuildTokens = await baal.interface.encodeFunctionData('setGuildTokens', tokens)
  const setShaman = await baal.interface.encodeFunctionData('setShamans', shamans)
  const mintShares = await baal.interface.encodeFunctionData('mintShares', shares)
  const mintLoot = await baal.interface.encodeFunctionData('mintLoot', loots)

  const initalizationActions = encodeMultiAction(
    multisend,
    [setAdminConfig, setGovernanceConfig, setGuildTokens, setShaman, mintShares, mintLoot],
    [baal.address, baal.address, baal.address, baal.address, baal.address, baal.address],
    [BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0)],
    [0, 0, 0, 0, 0, 0]
  )

  return abiCoder.encode(
    ['string', 'string', 'address', 'address', 'bytes'],
    [config.TOKEN_NAME, config.TOKEN_SYMBOL, lootSingleton.address, multisend.address, initalizationActions]
  )
}

const verifyProposal = function(prop1: any, prop2: any, overrides?: any) {
  for (let key in prop1) {
    if (Number.isInteger(+key)) {
      continue
    }
    if (overrides && (key in overrides)) {
      // console.log('override', key)
      expect(prop1[key]).to.equal(overrides[key])
    } else {
      // console.log('check', key)
      expect(prop1[key]).to.equal(prop2[key])
    }
  }
}

const setShamanProposal = async function(baal: Baal, multisend: MultiSend, shaman: SignerWithAddress, permission: BigNumberish) {
  const setShaman = await baal.interface.encodeFunctionData('setShamans', [[shaman.address], [permission]])
  const setShamanAction = encodeMultiAction(multisend, [setShaman], [baal.address], [BigNumber.from(0)], [0])
  await baal.submitProposal(setShamanAction, 0, "")
  const proposalId = await baal.proposalCount()
  await baal.submitVote(proposalId, true)
  await moveForwardPeriods(2)
  await baal.processProposal(proposalId, setShamanAction)
  return proposalId
}

describe('Baal contract', function () {
  let baal: Baal
  let lootSingleton: Loot
  let LootFactory: ContractFactory
  let ERC20: ContractFactory
  let lootToken: Loot
  let shamanLootToken: Loot
  let shamanBaal: Baal
  let applicantBaal: Baal
  let weth: TestErc20
  let applicantWeth: TestErc20
  let multisend: MultiSend

  let chainId: number

  // shaman baals, to test permissions
  let s1Baal: Baal
  let s2Baal: Baal
  let s3Baal: Baal
  let s4Baal: Baal
  let s5Baal: Baal
  let s6Baal: Baal

  let applicant: SignerWithAddress
  let summoner: SignerWithAddress
  let shaman: SignerWithAddress
  let s1: SignerWithAddress
  let s2: SignerWithAddress
  let s3: SignerWithAddress
  let s4: SignerWithAddress
  let s5: SignerWithAddress
  let s6: SignerWithAddress

  let proposal: { [key: string]: any }

  let encodedInitParams: any

  const loot = 500
  const shares = 100
  const sharesPaused = false
  const lootPaused = false

  const yes = true
  const no = false

  this.beforeAll(async function () {
    LootFactory = await ethers.getContractFactory('Loot')
    lootSingleton = (await LootFactory.deploy()) as Loot
    const network = await ethers.provider.getNetwork()
    chainId = network.chainId
  })

  beforeEach(async function () {
    const BaalContract = await ethers.getContractFactory('Baal')
    const MultisendContract = await ethers.getContractFactory('MultiSend')
    ;[summoner, applicant, shaman, s1, s2, s3, s4, s5, s6] = await ethers.getSigners()

    ERC20 = await ethers.getContractFactory('TestERC20')
    weth = (await ERC20.deploy('WETH', 'WETH', 10000000)) as TestErc20
    applicantWeth = weth.connect(applicant)

    multisend = (await MultisendContract.deploy()) as MultiSend

    baal = (await BaalContract.deploy()) as Baal
    shamanBaal = baal.connect(shaman) // needed to send txns to baal as the shaman
    applicantBaal = baal.connect(applicant) // needed to send txns to baal as the shaman
    s1Baal = baal.connect(s1)
    s2Baal = baal.connect(s2)
    s3Baal = baal.connect(s3)
    s4Baal = baal.connect(s4)
    s5Baal = baal.connect(s5)
    s6Baal = baal.connect(s6)

    encodedInitParams = await getBaalParams(
      baal,
      multisend,
      lootSingleton,
      deploymentConfig,
      [sharesPaused, lootPaused],
      [[weth.address]],
      [[shaman.address], [7]],
      [[summoner.address], [shares]],
      [[summoner.address], [loot]]
    )

    await baal.setUp(encodedInitParams)

    const lootTokenAddress = await baal.lootToken()

    lootToken = LootFactory.attach(lootTokenAddress) as Loot
    shamanLootToken = lootToken.connect(shaman)

    const selfTransferAction = encodeMultiAction(multisend, ['0x'], [baal.address], [BigNumber.from(0)], [0])

    proposal = {
      flag: 0,
      account: summoner.address,
      data: selfTransferAction,
      details: 'all hail baal',
      expiration: 0,
    }
  })

  describe('constructor', function () {
    it('verify deployment parameters', async function () {
      const now = await blockTime()

      const decimals = await baal.decimals()
      expect(decimals).to.equal(18)

      const gracePeriod = await baal.gracePeriod()
      expect(gracePeriod).to.equal(deploymentConfig.GRACE_PERIOD_IN_SECONDS)

      const votingPeriod = await baal.votingPeriod()
      expect(votingPeriod).to.equal(deploymentConfig.VOTING_PERIOD_IN_SECONDS)

      const proposalOffering = await baal.proposalOffering()
      expect(proposalOffering).to.equal(deploymentConfig.PROPOSAL_OFFERING)

      const name = await baal.name()
      expect(name).to.equal(deploymentConfig.TOKEN_NAME)

      const symbol = await baal.symbol()
      expect(symbol).to.equal(deploymentConfig.TOKEN_SYMBOL)

      const lootPaused = await baal.lootPaused()
      expect(lootPaused).to.be.false

      const sharesPaused = await baal.sharesPaused()
      expect(sharesPaused).to.be.false

      const shamans = await baal.shamans(shaman.address)
      expect(shamans).to.be.equal(7)

      const guildTokens = await baal.getGuildTokens()
      expect(guildTokens[0]).to.equal(weth.address)

      const summonerVotes = await baal.getCurrentVotes(summoner.address)
      expect(summonerVotes).to.equal(100)

      const summonerSelfDelegates = await baal.delegates(summoner.address)
      expect(summonerSelfDelegates).to.equal(summoner.address)

      expect(await baal.balanceOf(summoner.address)).to.equal(100)

      const totalLoot = await baal.totalLoot()
      expect(totalLoot).to.equal(500)
    })

    it('require fail - initializer (setup) cant be called twice', async function () {
      expect(baal.setUp(encodedInitParams)).to.be.revertedWith(revertMessages.molochAlreadyInitialized)
    })
  })

  describe('shaman actions - permission level 7 (full)', function () {
    it('setAdminConfig', async function() {
      await shamanBaal.setAdminConfig(true, true);
      expect(await shamanBaal.sharesPaused()).to.equal(true)
      expect(await shamanBaal.lootPaused()).to.equal(true)
    })

    it('mint shares - recipient has shares', async function () {
      await shamanBaal.mintShares([summoner.address], [69])
      expect(await shamanBaal.balanceOf(summoner.address)).to.equal(169)
      const votes = await baal.getCurrentVotes(summoner.address)
      expect(votes).to.equal(169)
      const totalShares = await baal.totalSupply()
      expect(totalShares).to.equal(169)
    })

    it('mint shares - new recipient', async function () {
      await shamanBaal.mintShares([shaman.address], [69])
      const now = await blockTime()
      expect(await shamanBaal.balanceOf(shaman.address)).to.equal(69)

      const votes = await baal.getCurrentVotes(shaman.address)
      expect(votes).to.equal(69)

      const shamanDelegate = await baal.delegates(shaman.address)
      expect(shamanDelegate).to.equal(shaman.address)
    })

    it('mint shares - recipient has delegate - new shares are also delegated', async function () {
      await baal.delegate(shaman.address)
      const t1 = await blockTime()
      await shamanBaal.mintShares([summoner.address], [69])
      
      expect(await shamanBaal.balanceOf(summoner.address)).to.equal(169)

      const summonerVotes = await baal.getCurrentVotes(summoner.address)
      expect(summonerVotes).to.equal(0)

      const shamanVotes = await baal.getCurrentVotes(shaman.address)
      expect(shamanVotes).to.equal(169)

      const summonerDelegate = await baal.delegates(summoner.address)
      expect(summonerDelegate).to.equal(shaman.address)
    })

    it('mint shares - zero address - no votes', async function () {
      // tests that we don't assign delegates / votes to zero address, even when it receives shares
      await shamanBaal.mintShares([zeroAddress], [69])
      expect(await shamanBaal.balanceOf(zeroAddress)).to.equal(69)
      const votes = await baal.getCurrentVotes(zeroAddress)
      expect(votes).to.equal(0)
      const totalShares = await baal.totalSupply()
      expect(totalShares).to.equal(169)
    })

    it('mint shares - zero mint amount - no votes', async function () {
      await shamanBaal.mintShares([shaman.address], [0])
      const now = await blockTime()
      expect(await shamanBaal.balanceOf(shaman.address)).to.equal(0)
      const votes = await baal.getCurrentVotes(shaman.address)
      expect(votes).to.equal(0)
      const totalShares = await baal.totalSupply()
      expect(totalShares).to.equal(100)

      const shamanVotes = await baal.getCurrentVotes(shaman.address)
      expect(shamanVotes).to.equal(0)

      const shamanDelegate = await baal.delegates(shaman.address)
      expect(shamanDelegate).to.equal(zeroAddress)
    })

    it('mint shares - require fail - array parity', async function () {
      expect(shamanBaal.mintShares([summoner.address], [69, 69])).to.be.revertedWith(revertMessages.mintSharesArrayParity)
    })

    it('burn shares', async function () {
      await shamanBaal.burnShares([summoner.address], [69])
      expect(await shamanBaal.balanceOf(summoner.address)).to.equal(31)
    })

    it('burn shares - require fail - array parity', async function () {
      expect(shamanBaal.burnShares([summoner.address], [69, 69])).to.be.revertedWith(revertMessages.burnSharesArrayParity)
    })

    it('burn shares - require fail - insufficent shares', async function () {
      expect(shamanBaal.burnShares([summoner.address], [101])).to.be.revertedWith(revertMessages.burnSharesInsufficientShares)
    })

    it('mint loot', async function () {
      await shamanBaal.mintLoot([summoner.address], [69])
      expect(await lootToken.balanceOf(summoner.address)).to.equal(569)
      expect(await baal.totalLoot()).to.equal(569)
    })

    it('mint loot - require fail - array parity', async function () {
      expect(shamanBaal.mintLoot([summoner.address], [69, 69])).to.be.revertedWith(revertMessages.burnSharesArrayParity)
    })

    it('burn loot', async function () {
      await shamanBaal.burnLoot([summoner.address], [69])
      expect(await lootToken.balanceOf(summoner.address)).to.equal(431)
      expect(await baal.totalLoot()).to.equal(431)
    })

    it('burn loot - require fail - array parity', async function () {
      expect(shamanBaal.burnLoot([summoner.address], [69, 69])).to.be.revertedWith(revertMessages.burnSharesArrayParity)
    })

    it('burn loot - require fail - insufficent shares', async function () {
      expect(shamanBaal.burnLoot([summoner.address], [501])).to.be.revertedWith(revertMessages.burnLootInsufficientShares)
    })

    it('setGuildTokens', async function () {
      const toke = (await ERC20.deploy('TOKE', 'TOKE', 10000000)) as TestErc20
      await shamanBaal.setGuildTokens([toke.address, toke.address]) // attempt to duplicate
      const guildTokens = await shamanBaal.getGuildTokens()
      expect(guildTokens[0]).to.be.equal(weth.address)
      expect(guildTokens[1]).to.be.equal(toke.address)
      expect(guildTokens.length).to.be.equal(2) // checks no duplicates
      expect(await baal.guildTokensEnabled(weth.address)).to.be.equal(true)
      expect(await baal.guildTokensEnabled(toke.address)).to.be.equal(true)
    })

    it('unsetGuildTokens', async function () {
      await shamanBaal.unsetGuildTokens([0])
      const guildTokensAfter = await shamanBaal.getGuildTokens()
      expect(guildTokensAfter.length).to.be.equal(0)
    })

    it('unsetGuildTokens - remove middle index', async function () {
      await shamanBaal.setGuildTokens([lootToken.address, baal.address]) // add two tokens
      await shamanBaal.unsetGuildTokens([1])
      const guildTokensAfter = await shamanBaal.getGuildTokens()
      expect(guildTokensAfter).to.eql([weth.address, baal.address])
    })

    it('unsetGuildTokens - remove first index', async function () {
      await shamanBaal.setGuildTokens([lootToken.address, baal.address]) // add two tokens
      await shamanBaal.unsetGuildTokens([0])
      const guildTokensAfter = await shamanBaal.getGuildTokens()
      expect(guildTokensAfter).to.eql([baal.address, lootToken.address]) // order switched
    })

    it('unsetGuildTokens - remove last index', async function () {
      await shamanBaal.setGuildTokens([lootToken.address, baal.address]) // add two tokens
      await shamanBaal.unsetGuildTokens([2])
      const guildTokensAfter = await shamanBaal.getGuildTokens()
      expect(guildTokensAfter).to.eql([weth.address, lootToken.address])
    })

    it('unsetGuildTokens - remove two indices - require fail - descending', async function () {
      await shamanBaal.setGuildTokens([lootToken.address, baal.address]) // add two tokens
      expect(shamanBaal.unsetGuildTokens([0, 2])).to.be.revertedWith(revertMessages.unsetGuildTokensDescending)
    })

    it('unsetGuildTokens - remove two indices - descending', async function () {
      await shamanBaal.setGuildTokens([lootToken.address, baal.address]) // add two tokens
      await shamanBaal.unsetGuildTokens([2, 0])
      const guildTokensAfter = await shamanBaal.getGuildTokens()
      expect(guildTokensAfter).to.eql([lootToken.address])
    })

    it('unsetGuildTokens - remove all tokens', async function () {
      await shamanBaal.setGuildTokens([lootToken.address, baal.address]) // add two tokens
      await shamanBaal.unsetGuildTokens([2, 1, 0])
      const guildTokensAfter = await shamanBaal.getGuildTokens()
      expect(guildTokensAfter).to.eql([])
    })

    it('unsetGuildTokens - require fail - out of bounds', async function () {
      await shamanBaal.setGuildTokens([lootToken.address, baal.address]) // add two tokens
      expect(shamanBaal.unsetGuildTokens([3])).to.be.revertedWith(revertMessages.unsetGuildTokensOutOfBound)
    })

    it('setGovernanceConfig', async function() {
      const governanceConfig = abiCoder.encode(
        ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
        [10, 20, 50, 1, 2, 3]
      )

      await shamanBaal.setGovernanceConfig(governanceConfig)
      const voting = await baal.votingPeriod()
      const grace = await baal.gracePeriod()
      const offering = await baal.proposalOffering()
      const quorum = await baal.quorumPercent()
      const sponsorThreshold = await baal.sponsorThreshold()
      const minRetentionPercent = await baal.minRetentionPercent()
      expect(voting).to.be.equal(10)
      expect(grace).to.be.equal(20)
      expect(offering).to.be.equal(50)
      expect(quorum).to.be.equal(1)
      expect(sponsorThreshold).to.be.equal(2)
      expect(minRetentionPercent).to.equal(3)
    })

    it('setGovernanceConfig - doesnt set voting/grace if =0', async function() {
      const governanceConfig = abiCoder.encode(
        ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
        [0, 0, 50, 1, 2, 3]
      )

      await shamanBaal.setGovernanceConfig(governanceConfig)
      const voting = await baal.votingPeriod()
      const grace = await baal.gracePeriod()
      const offering = await baal.proposalOffering()
      const quorum = await baal.quorumPercent()
      const sponsorThreshold = await baal.sponsorThreshold()
      const minRetentionPercent = await baal.minRetentionPercent()
      expect(voting).to.be.equal(deploymentConfig.VOTING_PERIOD_IN_SECONDS)
      expect(grace).to.be.equal(deploymentConfig.GRACE_PERIOD_IN_SECONDS)
      expect(offering).to.be.equal(50)
      expect(quorum).to.be.equal(1)
      expect(sponsorThreshold).to.be.equal(2)
      expect(minRetentionPercent).to.equal(3)
    })

    it('cancelProposal - happy case - as gov shaman', async function() {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await shamanBaal.cancelProposal(1) // cancel as gov shaman
      const state = await baal.state(1)
      expect(state).to.equal(STATES.CANCELLED)
    })

    it('cancelProposal - happy case - as proposal sponsor', async function() {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.cancelProposal(1) // cancel as sponsor
      const state = await baal.state(1)
      expect(state).to.equal(STATES.CANCELLED)
    })

    it('cancelProposal - happy case - after undelegation', async function() {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.transfer(shamanBaal.address, shares) // transfer all shares/votes to shaman
      await applicantBaal.cancelProposal(1) // cancel as rando
      const state = await baal.state(1)
      expect(state).to.equal(STATES.CANCELLED)
    })

    it('cancelProposal - require fail - not cancellable by rando', async function() {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      expect(applicantBaal.cancelProposal(1)).to.be.revertedWith(revertMessages.cancelProposalNotCancellable)
    })

    it('cancelProposal - require fail - !voting (submitted)', async function() {
      await shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      const state = await baal.state(1)
      expect(state).to.equal(STATES.SUBMITTED)
      expect(baal.cancelProposal(1)).to.be.revertedWith(revertMessages.cancelProposalNotVoting)
    })

    it('cancelProposal - require fail - !voting (grace)', async function() {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await moveForwardPeriods(1, 1) // add 1 extra second to push us into grace period
      const state = await baal.state(1)
      expect(state).to.equal(STATES.GRACE)
      expect(baal.cancelProposal(1)).to.be.revertedWith(revertMessages.cancelProposalNotVoting)
    })

    it('cancelProposal - require fail - !voting (defeated)', async function() {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await moveForwardPeriods(2)
      const state = await baal.state(1)
      expect(state).to.equal(STATES.DEEFEATED)
      expect(baal.cancelProposal(1)).to.be.revertedWith(revertMessages.cancelProposalNotVoting)
    })

    it('cancelProposal - require fail - !voting (cancelled)', async function() {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.cancelProposal(1)
      const state = await baal.state(1)
      expect(state).to.equal(STATES.CANCELLED)
      expect(baal.cancelProposal(1)).to.be.revertedWith(revertMessages.cancelProposalNotVoting)
    })

    it('cancelProposal - require fail - !voting (ready)', async function() {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, true)
      await moveForwardPeriods(2)
      const state = await baal.state(1)
      expect(state).to.equal(STATES.READY)
      expect(baal.cancelProposal(1)).to.be.revertedWith(revertMessages.cancelProposalNotVoting)
    })

    it('cancelProposal - require fail - !voting (processed)', async function() {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, true)
      await moveForwardPeriods(2)
      await baal.processProposal(1, proposal.data)
      const state = await baal.state(1)
      expect(state).to.equal(STATES.PROCESSED)
      expect(baal.cancelProposal(1)).to.be.revertedWith(revertMessages.cancelProposalNotVoting)
    })
  })
  
  describe('shaman permissions: 0-6', function() {
    const governanceConfig = abiCoder.encode(
      ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
      [10, 20, 50, 1, 2, 3]
    )

    beforeEach(async function() {
      const shamanAddresses = [shaman.address, s1.address, s2.address, s3.address, s4.address, s5.address, s6.address]
      const permissions = [0, 1, 2, 3, 4, 5, 6]
      const setShaman = await baal.interface.encodeFunctionData('setShamans', [shamanAddresses, permissions])
      const setShamanAction = encodeMultiAction(multisend, [setShaman], [baal.address], [BigNumber.from(0)], [0])
      proposal.data = setShamanAction
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, true)
      await moveForwardPeriods(2)
      await baal.processProposal(1, proposal.data)
      const shamanPermission = await baal.shamans(shaman.address)
      expect(shamanPermission).to.equal(0)
    })

    it('permission = 0 - all actions fail', async function() {
      // admin
      expect(shamanBaal.setAdminConfig(true, true)).to.be.revertedWith(revertMessages.baalOrAdmin)

      // manager
      expect(shamanBaal.mintShares([shaman.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(shamanBaal.burnShares([shaman.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(shamanBaal.mintLoot([shaman.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(shamanBaal.burnLoot([shaman.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(shamanBaal.convertSharesToLoot(shaman.address)).to.be.revertedWith(revertMessages.baalOrManager)
      expect(shamanBaal.setGuildTokens([lootToken.address])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(shamanBaal.unsetGuildTokens([0])).to.be.revertedWith(revertMessages.baalOrManager)

      // governor
      expect(shamanBaal.setGovernanceConfig(governanceConfig)).to.be.revertedWith(revertMessages.baalOrGovernor)

      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      expect(shamanBaal.cancelProposal(2)).to.be.revertedWith(revertMessages.cancelProposalNotCancellable)
    })

    it('permission = 1 - admin actions succeed', async function() {
      // admin - success
      await s1Baal.setAdminConfig(true, true)
      expect(await s1Baal.sharesPaused()).to.equal(true)
      expect(await s1Baal.lootPaused()).to.equal(true)

      // manager - fail
      expect(s1Baal.mintShares([s1.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s1Baal.burnShares([s1.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s1Baal.mintLoot([s1.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s1Baal.burnLoot([s1.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s1Baal.convertSharesToLoot(s1.address)).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s1Baal.setGuildTokens([lootToken.address])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s1Baal.unsetGuildTokens([0])).to.be.revertedWith(revertMessages.baalOrManager)

      // governor - fail
      expect(s1Baal.setGovernanceConfig(governanceConfig)).to.be.revertedWith(revertMessages.baalOrGovernor)

      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      expect(s1Baal.cancelProposal(2)).to.be.revertedWith(revertMessages.cancelProposalNotCancellable)
    })

    it('permission = 2 - manager actions succeed', async function() {
      // admin - fail
      expect(s2Baal.setAdminConfig(true, true)).to.be.revertedWith(revertMessages.baalOrAdmin)

      // manager - success
      await s2Baal.mintShares([s2.address], [69])
      expect(await baal.balanceOf(s2.address)).to.equal(69)
      await s2Baal.burnShares([s2.address], [69])
      expect(await baal.balanceOf(s2.address)).to.equal(0)
      await s2Baal.mintLoot([s2.address], [69])
      expect(await lootToken.balanceOf(s2.address)).to.equal(69)
      await s2Baal.burnLoot([s2.address], [69])
      expect(await lootToken.balanceOf(s2.address)).to.equal(0)
      await s2Baal.convertSharesToLoot(summoner.address)
      expect(await baal.balanceOf(summoner.address)).to.equal(0)
      expect(await lootToken.balanceOf(summoner.address)).to.equal(600)
      await s2Baal.setGuildTokens([lootToken.address])
      expect(await baal.getGuildTokens()).to.eql([weth.address, lootToken.address])
      await s2Baal.unsetGuildTokens([1])
      expect(await baal.getGuildTokens()).to.eql([weth.address])
      
      await s2Baal.mintShares([summoner.address], [100]) // cleanup - mint summoner shares so they can submit/sponsor

      // governor - fail
      expect(s2Baal.setGovernanceConfig(governanceConfig)).to.be.revertedWith(revertMessages.baalOrGovernor)

      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      expect(s2Baal.cancelProposal(2)).to.be.revertedWith(revertMessages.cancelProposalNotCancellable)
    })

    it('permission = 3 - admin + manager actions succeed', async function() {
      // admin - success
      await s3Baal.setAdminConfig(true, true)
      expect(await s3Baal.sharesPaused()).to.equal(true)
      expect(await s3Baal.lootPaused()).to.equal(true)

      // manager - success
      await s3Baal.mintShares([s3.address], [69])
      expect(await baal.balanceOf(s3.address)).to.equal(69)
      await s3Baal.burnShares([s3.address], [69])
      expect(await baal.balanceOf(s3.address)).to.equal(0)
      await s3Baal.mintLoot([s3.address], [69])
      expect(await lootToken.balanceOf(s3.address)).to.equal(69)
      await s3Baal.burnLoot([s3.address], [69])
      expect(await lootToken.balanceOf(s3.address)).to.equal(0)
      await s3Baal.convertSharesToLoot(summoner.address)
      expect(await baal.balanceOf(summoner.address)).to.equal(0)
      expect(await lootToken.balanceOf(summoner.address)).to.equal(600)
      await s3Baal.setGuildTokens([lootToken.address])
      expect(await baal.getGuildTokens()).to.eql([weth.address, lootToken.address])
      await s3Baal.unsetGuildTokens([1])
      expect(await baal.getGuildTokens()).to.eql([weth.address])
      
      await s3Baal.mintShares([summoner.address], [100]) // cleanup - mint summoner shares so they can submit/sponsor

      // governor - fail
      expect(s3Baal.setGovernanceConfig(governanceConfig)).to.be.revertedWith(revertMessages.baalOrGovernor)

      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      expect(s3Baal.cancelProposal(2)).to.be.revertedWith(revertMessages.cancelProposalNotCancellable)
    })

    it('permission = 4 - governor actions succeed', async function() {
      // admin - fail
      expect(s4Baal.setAdminConfig(true, true)).to.be.revertedWith(revertMessages.baalOrAdmin)

      // manager - fail
      expect(s4Baal.mintShares([s4.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s4Baal.burnShares([s4.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s4Baal.mintLoot([s4.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s4Baal.burnLoot([s4.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s4Baal.convertSharesToLoot(s4.address)).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s4Baal.setGuildTokens([lootToken.address])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s4Baal.unsetGuildTokens([0])).to.be.revertedWith(revertMessages.baalOrManager)

      // governor - succeed
      await s4Baal.setGovernanceConfig(governanceConfig)
      const voting = await baal.votingPeriod()
      const grace = await baal.gracePeriod()
      const offering = await baal.proposalOffering()
      const quorum = await baal.quorumPercent()
      const sponsorThreshold = await baal.sponsorThreshold()
      expect(voting).to.be.equal(10)
      expect(grace).to.be.equal(20)
      expect(offering).to.be.equal(50)
      expect(quorum).to.be.equal(1)
      expect(sponsorThreshold).to.be.equal(2)

      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await s4Baal.cancelProposal(2)
      const state = await baal.state(2)
      expect(state).to.equal(STATES.CANCELLED)
    })

    it('permission = 5 - admin + governor actions succeed', async function() {
      // admin - success
      await s5Baal.setAdminConfig(true, true)
      expect(await s5Baal.sharesPaused()).to.equal(true)
      expect(await s5Baal.lootPaused()).to.equal(true)

      // manager - fail
      expect(s5Baal.mintShares([s5.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s5Baal.burnShares([s5.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s5Baal.mintLoot([s5.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s5Baal.burnLoot([s5.address], [69])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s5Baal.convertSharesToLoot(s5.address)).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s5Baal.setGuildTokens([lootToken.address])).to.be.revertedWith(revertMessages.baalOrManager)
      expect(s5Baal.unsetGuildTokens([0])).to.be.revertedWith(revertMessages.baalOrManager)

      // governor - succeed
      await s5Baal.setGovernanceConfig(governanceConfig)
      const voting = await baal.votingPeriod()
      const grace = await baal.gracePeriod()
      const offering = await baal.proposalOffering()
      const quorum = await baal.quorumPercent()
      const sponsorThreshold = await baal.sponsorThreshold()
      expect(voting).to.be.equal(10)
      expect(grace).to.be.equal(20)
      expect(offering).to.be.equal(50)
      expect(quorum).to.be.equal(1)
      expect(sponsorThreshold).to.be.equal(2)

      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await s5Baal.cancelProposal(2)
      const state = await baal.state(2)
      expect(state).to.equal(STATES.CANCELLED)
    })

    it('permission = 6 - manager + governor actions succeed', async function() {
      // admin - fail
      expect(s6Baal.setAdminConfig(true, true)).to.be.revertedWith(revertMessages.baalOrAdmin)

      // manager - success
      await s6Baal.mintShares([s6.address], [69])
      expect(await baal.balanceOf(s6.address)).to.equal(69)
      await s6Baal.burnShares([s6.address], [69])
      expect(await baal.balanceOf(s6.address)).to.equal(0)
      await s6Baal.mintLoot([s6.address], [69])
      expect(await lootToken.balanceOf(s6.address)).to.equal(69)
      await s6Baal.burnLoot([s6.address], [69])
      expect(await lootToken.balanceOf(s6.address)).to.equal(0)
      await s6Baal.convertSharesToLoot(summoner.address)
      expect(await baal.balanceOf(summoner.address)).to.equal(0)
      expect(await lootToken.balanceOf(summoner.address)).to.equal(600)
      await s6Baal.setGuildTokens([lootToken.address])
      expect(await baal.getGuildTokens()).to.eql([weth.address, lootToken.address])
      await s6Baal.unsetGuildTokens([1])
      expect(await baal.getGuildTokens()).to.eql([weth.address])
      
      await s6Baal.mintShares([summoner.address], [100]) // cleanup - mint summoner shares so they can submit/sponsor

      // governor - succeed
      await s6Baal.setGovernanceConfig(governanceConfig)
      const voting = await baal.votingPeriod()
      const grace = await baal.gracePeriod()
      const offering = await baal.proposalOffering()
      const quorum = await baal.quorumPercent()
      const sponsorThreshold = await baal.sponsorThreshold()
      expect(voting).to.be.equal(10)
      expect(grace).to.be.equal(20)
      expect(offering).to.be.equal(50)
      expect(quorum).to.be.equal(1)
      expect(sponsorThreshold).to.be.equal(2)

      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await s6Baal.cancelProposal(2)
      const state = await baal.state(2)
      expect(state).to.equal(STATES.CANCELLED)
    })
  })

  describe('shaman locks', function() {
    it('lockAdmin', async function() {
      const lockAdmin = await baal.interface.encodeFunctionData('lockAdmin')
      const lockAdminAction = encodeMultiAction(multisend, [lockAdmin], [baal.address], [BigNumber.from(0)], [0])
      proposal.data = lockAdminAction
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, true)
      await moveForwardPeriods(2)
      await baal.processProposal(1, proposal.data)
      expect(await baal.adminLock()).to.equal(true)
    })

    it('lockManager', async function() {
      const lockManager = await baal.interface.encodeFunctionData('lockManager')
      const lockManagerAction = encodeMultiAction(multisend, [lockManager], [baal.address], [BigNumber.from(0)], [0])
      proposal.data = lockManagerAction
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, true)
      await moveForwardPeriods(2)
      await baal.processProposal(1, proposal.data)
      expect(await baal.managerLock()).to.equal(true)
    })

    it('lockGovernor', async function() {
      const lockGovernor = await baal.interface.encodeFunctionData('lockGovernor')
      const lockGovernorAction = encodeMultiAction(multisend, [lockGovernor], [baal.address], [BigNumber.from(0)], [0])
      proposal.data = lockGovernorAction
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, true)
      await moveForwardPeriods(2)
      await baal.processProposal(1, proposal.data)
      expect(await baal.governorLock()).to.equal(true)
    })
  })

  describe('setShamans - adminLock (1, 3, 5, 7)', function() {
    beforeEach(async function (){
      const lockAdmin = await baal.interface.encodeFunctionData('lockAdmin')
      const lockAdminAction = encodeMultiAction(multisend, [lockAdmin], [baal.address], [BigNumber.from(0)], [0])
      proposal.data = lockAdminAction
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, true)
      await moveForwardPeriods(2)
      await baal.processProposal(1, proposal.data)
      expect(await baal.adminLock()).to.equal(true)
    })

    it('setShamans - 0 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 0)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(0)
    })

    it('setShamans - 1 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 1)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 2 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 2)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(2)
    })

    it('setShamans - 3 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 3)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 4 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 4)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(4)
    })

    it('setShamans - 5 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 5)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 6 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 6)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(6)
    })

    it('setShamans - 7 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, summoner, 7) // use summoner bc shaman default = 7
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(summoner.address)).to.equal(0)
    })
  })

  describe('setShamans - managerLock (2, 3, 6, 7)', function() {
    beforeEach(async function (){
      const lockManager = await baal.interface.encodeFunctionData('lockManager')
      const lockManagerAction = encodeMultiAction(multisend, [lockManager], [baal.address], [BigNumber.from(0)], [0])
      proposal.data = lockManagerAction
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, true)
      await moveForwardPeriods(2)
      await baal.processProposal(1, proposal.data)
      expect(await baal.managerLock()).to.equal(true)
    })

    it('setShamans - 0 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 0)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(0)
    })

    it('setShamans - 1 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 1)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(1)
    })

    it('setShamans - 2 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 2)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 3 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 3)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 4 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 4)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(4)
    })

    it('setShamans - 5 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 5)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(5)
    })

    it('setShamans - 6 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 6)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 7 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, summoner, 7) // use summoner bc shaman default = 7
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(summoner.address)).to.equal(0)
    })
  })

  describe('setShamans - governorLock (4, 5, 6, 7)', function() {
    beforeEach(async function (){
      const lockGovernor = await baal.interface.encodeFunctionData('lockGovernor')
      const lockGovernorAction = encodeMultiAction(multisend, [lockGovernor], [baal.address], [BigNumber.from(0)], [0])
      proposal.data = lockGovernorAction
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, true)
      await moveForwardPeriods(2)
      await baal.processProposal(1, proposal.data)
      expect(await baal.governorLock()).to.equal(true)
    })

    it('setShamans - 0 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 0)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(0)
    })

    it('setShamans - 1 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 1)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(1)
    })

    it('setShamans - 2 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 2)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(2)
    })

    it('setShamans - 3 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 3)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(3)
    })

    it('setShamans - 4 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 4)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 5 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 5)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 6 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 6)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 7 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, summoner, 7) // use summoner bc shaman default = 7
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(summoner.address)).to.equal(0)
    })
  })

  describe('setShamans - all locked', function() {
    beforeEach(async function (){
      const lockAdmin = await baal.interface.encodeFunctionData('lockAdmin')
      const lockManager = await baal.interface.encodeFunctionData('lockManager')
      const lockGovernor = await baal.interface.encodeFunctionData('lockGovernor')
      const lockAllAction = encodeMultiAction(multisend, 
        [lockAdmin, lockManager, lockGovernor], 
        [baal.address, baal.address, baal.address], 
        [BigNumber.from(0), BigNumber.from(0), BigNumber.from(0)], 
        [0, 0, 0]
      )
      proposal.data = lockAllAction
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, true)
      await moveForwardPeriods(2)
      await baal.processProposal(1, proposal.data)
      expect(await baal.adminLock()).to.equal(true)
      expect(await baal.managerLock()).to.equal(true)
      expect(await baal.governorLock()).to.equal(true)
    })

    it('setShamans - 0 - success', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 0)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, false]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(0)
    })

    it('setShamans - 1 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 1)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 2 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 2)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 3 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 3)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 4 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 4)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 5 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 5)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 6 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, shaman, 6)
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(shaman.address)).to.equal(7)
    })

    it('setShamans - 7 - fail', async function() {
      const id = await setShamanProposal(baal, multisend, summoner, 7) // use summoner bc shaman default = 7
      const propStatus = await baal.getProposalStatus(id)
      expect(propStatus).to.eql([false, true, true, true]) // [cancelled, processed, passed, actionFailed]
      expect(await baal.shamans(summoner.address)).to.equal(0)
    })
  })

  describe('erc20 shares - approve', function() {
    it('happy case', async function() {
      await baal.approve(shaman.address, 20)
      const allowance = await baal.allowance(summoner.address, shaman.address)
      expect(allowance).to.equal(20)
    })

    it('overwrites previous value', async function() {
      await baal.approve(shaman.address, 20)
      const allowance = await baal.allowance(summoner.address, shaman.address)
      expect(allowance).to.equal(20)

      await baal.approve(shaman.address, 50)
      const allowance2 = await baal.allowance(summoner.address, shaman.address)
      expect(allowance2).to.equal(50)
    })
  })

  describe('erc20 shares - transfer', function() {
    it('transfer to first time recipient - auto self delegates', async function() {
      const beforeTransferTimestamp = await blockTime()
      await baal.transfer(shaman.address, deploymentConfig.SPONSOR_THRESHOLD)
      const afterTransferTimestamp = await blockTime()
      const summonerBalance = await baal.balanceOf(summoner.address)
      const summonerVotes = await baal.getCurrentVotes(summoner.address)
      const shamanBalance = await baal.balanceOf(shaman.address)
      const shamanVotes = await baal.getCurrentVotes(shaman.address)
      expect(summonerBalance).to.equal(99)
      expect(summonerVotes).to.equal(99)
      expect(shamanBalance).to.equal(1)
      expect(shamanVotes).to.equal(1)

      const summonerCheckpoints = await baal.numCheckpoints(summoner.address)
      const shamanCheckpoints = await baal.numCheckpoints(shaman.address)
      const summonerCP0 = await baal.checkpoints(summoner.address, 0)
      const summonerCP1 = await baal.checkpoints(summoner.address, 1)
      const shamanCP0 = await baal.checkpoints(shaman.address, 0)
      const shamanCP1 = await baal.checkpoints(shaman.address, 1)
      expect(summonerCheckpoints).to.equal(2)
      expect(shamanCheckpoints).to.equal(1)
      expect(summonerCP0.votes).to.equal(100)
      expect(summonerCP1.votes).to.equal(99)
      expect(shamanCP0.votes).to.equal(1)
      expect(shamanCP1.fromTimeStamp).to.equal(0) // checkpoint DNE

      const delegate = await baal.delegates(shaman.address)
      expect(delegate).to.equal(shaman.address)
    })

    it('require fails - shares paused', async function () {
      await shamanBaal.setAdminConfig(true, false) // pause shares
      expect(baal.transfer(shaman.address, deploymentConfig.SPONSOR_THRESHOLD)).to.be.revertedWith(revertMessages.sharesTransferPaused)
    })

    it('require fails - insufficient balance', async function () {
      expect(baal.transfer(shaman.address, 101)).to.be.revertedWith(revertMessages.sharesInsufficientBalance)
    })

    it('0 transfer - doesnt update delegates', async function() {
      const beforeTransferTimestamp = await blockTime()
      await baal.transfer(shaman.address, 0)
      const summonerBalance = await baal.balanceOf(summoner.address)
      const summonerVotes = await baal.getCurrentVotes(summoner.address)
      const shamanBalance = await baal.balanceOf(shaman.address)
      const shamanVotes = await baal.getCurrentVotes(shaman.address)
      expect(summonerBalance).to.equal(100)
      expect(summonerVotes).to.equal(100)
      expect(shamanBalance).to.equal(0)
      expect(shamanVotes).to.equal(0)

      const summonerCheckpoints = await baal.numCheckpoints(summoner.address)
      const shamanCheckpoints = await baal.numCheckpoints(shaman.address)
      const summonerCP0 = await baal.checkpoints(summoner.address, 0)
      const shamanCP0 = await baal.checkpoints(shaman.address, 0)
      expect(summonerCheckpoints).to.equal(1)
      expect(shamanCheckpoints).to.equal(0)
      expect(summonerCP0.votes).to.equal(100)
      expect(shamanCP0.fromTimeStamp).to.equal(0) // checkpoint DNE
    })

    it('self transfer - doesnt update delegates', async function() {
      const beforeTransferTimestamp = await blockTime()
      await baal.transfer(summoner.address, 10)
      const summonerBalance = await baal.balanceOf(summoner.address)
      const summonerVotes = await baal.getCurrentVotes(summoner.address)
      expect(summonerBalance).to.equal(100)
      expect(summonerVotes).to.equal(100)

      const summonerCheckpoints = await baal.numCheckpoints(summoner.address)
      const summonerCP0 = await baal.checkpoints(summoner.address, 0)
      expect(summonerCheckpoints).to.equal(1)
      expect(summonerCP0.votes).to.equal(100)
    })

    it('transferring to shareholder w/ delegate assigns votes to delegate', async function() {
      const t1 = await blockTime()
      await baal.transfer(shaman.address, deploymentConfig.SPONSOR_THRESHOLD)
      const t2 = await blockTime()
      await shamanBaal.delegate(applicant.address) // set shaman delegate -> applicant
      const t3 = await blockTime()
      await baal.transfer(shaman.address, deploymentConfig.SPONSOR_THRESHOLD)
      
      const summonerBalance = await baal.balanceOf(summoner.address)
      const summonerVotes = await baal.getCurrentVotes(summoner.address)
      const shamanBalance = await baal.balanceOf(shaman.address)
      const shamanVotes = await baal.getCurrentVotes(shaman.address)
      const applicantVotes = await baal.getCurrentVotes(applicant.address)
      expect(summonerBalance).to.equal(98)
      expect(summonerVotes).to.equal(98)
      expect(shamanBalance).to.equal(2)
      expect(shamanVotes).to.equal(0)
      expect(applicantVotes).to.equal(2)

      const delegate = await baal.delegates(shaman.address)
      expect(delegate).to.equal(applicant.address)

      const summonerCheckpoints = await baal.numCheckpoints(summoner.address)
      const shamanCheckpoints = await baal.numCheckpoints(shaman.address)
      const applicantCheckpoints = await baal.numCheckpoints(applicant.address)
      const summonerCP0 = await baal.checkpoints(summoner.address, 0)
      const summonerCP1 = await baal.checkpoints(summoner.address, 1)
      const summonerCP2 = await baal.checkpoints(summoner.address, 2)
      const shamanCP0 = await baal.checkpoints(shaman.address, 0)
      const shamanCP1 = await baal.checkpoints(shaman.address, 1)
      const applicantCP0 = await baal.checkpoints(applicant.address, 0)
      const applicantCP1 = await baal.checkpoints(applicant.address, 1)
      expect(summonerCheckpoints).to.equal(3)
      expect(shamanCheckpoints).to.equal(2)
      expect(applicantCheckpoints).to.equal(2)
      expect(summonerCP0.votes).to.equal(100)
      expect(summonerCP1.votes).to.equal(99)
      expect(summonerCP2.votes).to.equal(98)
      expect(shamanCP0.votes).to.equal(1)
      expect(shamanCP1.votes).to.equal(0)
      expect(applicantCP0.votes).to.equal(1)
      expect(applicantCP1.votes).to.equal(2)
    })
  })

  describe('erc20 shares - transferFrom', function() {
    it('transfer to first time recipient', async function() {
      const beforeTransferTimestamp = await blockTime()
      await baal.approve(shaman.address, deploymentConfig.SPONSOR_THRESHOLD)

      const allowanceBefore = await baal.allowance(summoner.address, shaman.address)
      expect(allowanceBefore).to.equal(1)

      await shamanBaal.transferFrom(summoner.address, shaman.address, deploymentConfig.SPONSOR_THRESHOLD)

      const allowanceAfter = await baal.allowance(summoner.address, shaman.address)
      expect(allowanceAfter).to.equal(0)

      const afterTransferTimestamp = await blockTime()
      const summonerBalance = await baal.balanceOf(summoner.address)
      const summonerVotes = await baal.getCurrentVotes(summoner.address)
      const shamanBalance = await baal.balanceOf(shaman.address)
      const shamanVotes = await baal.getCurrentVotes(shaman.address)
      expect(summonerBalance).to.equal(99)
      expect(summonerVotes).to.equal(99)
      expect(shamanBalance).to.equal(1)
      expect(shamanVotes).to.equal(1)

      const summonerCheckpoints = await baal.numCheckpoints(summoner.address)
      const shamanCheckpoints = await baal.numCheckpoints(shaman.address)
      const summonerCP0 = await baal.checkpoints(summoner.address, 0)
      const summonerCP1 = await baal.checkpoints(summoner.address, 1)
      const shamanCP0 = await baal.checkpoints(shaman.address, 0)
      const shamanCP1 = await baal.checkpoints(shaman.address, 1)
      expect(summonerCheckpoints).to.equal(2)
      expect(shamanCheckpoints).to.equal(1)
      expect(summonerCP0.votes).to.equal(100)
      expect(summonerCP1.votes).to.equal(99)
      expect(shamanCP0.votes).to.equal(1)
      expect(shamanCP1.fromTimeStamp).to.equal(0) // checkpoint DNE
    })

    it('require fails - shares paused', async function () {
      await shamanBaal.setAdminConfig(true, false) // pause shares
      await baal.approve(shaman.address, deploymentConfig.SPONSOR_THRESHOLD)
      expect(baal.transferFrom(summoner.address, shaman.address, deploymentConfig.SPONSOR_THRESHOLD)).to.be.revertedWith(revertMessages.sharesTransferPaused)
    })

    it('require fails - insufficeint approval', async function () {
      await baal.approve(shaman.address, 1)
      expect(baal.transferFrom(summoner.address, shaman.address, 2)).to.be.revertedWith(revertMessages.sharesInsufficientApproval)
    })
  })

  describe('erc20 loot - approve', function() {
    it('happy case', async function() {
      await lootToken.approve(shaman.address, 20)
      const allowance = await lootToken.allowance(summoner.address, shaman.address)
      expect(allowance).to.equal(20)
    })

    it('overwrites previous value', async function() {
      await lootToken.approve(shaman.address, 20)
      const allowance = await lootToken.allowance(summoner.address, shaman.address)
      expect(allowance).to.equal(20)

      await lootToken.approve(shaman.address, 50)
      const allowance2 = await lootToken.allowance(summoner.address, shaman.address)
      expect(allowance2).to.equal(50)
    })
  })

  describe('erc20 loot - transfer', function() {
    it('sends tokens, not votes', async function() {
      await lootToken.transfer(shaman.address, 500)
      const summonerBalance = await lootToken.balanceOf(summoner.address)
      const summonerVotes = await baal.getCurrentVotes(summoner.address)
      const shamanBalance = await lootToken.balanceOf(shaman.address)
      const shamanVotes = await baal.getCurrentVotes(shaman.address)
      expect(summonerBalance).to.equal(0)
      expect(summonerVotes).to.equal(100)
      expect(shamanBalance).to.equal(500)
      expect(shamanVotes).to.equal(0)
    })

    it('require fails - loot paused', async function () {
      await shamanBaal.setAdminConfig(false, true) // pause loot
      expect(lootToken.transfer(shaman.address, 1)).to.be.revertedWith(revertMessages.lootTransferPaused)
    })

    it('require fails - insufficient balance', async function () {
      expect(lootToken.transfer(shaman.address, 501)).to.be.revertedWith(revertMessages.lootInsufficientBalance)
    })
  })

  describe('erc20 loot - transferFrom', function() {
    it('sends tokens, not votes', async function() {
      await lootToken.approve(shaman.address, 500)
      await shamanLootToken.transferFrom(summoner.address, shaman.address, 500)
      const summonerBalance = await lootToken.balanceOf(summoner.address)
      const summonerVotes = await baal.getCurrentVotes(summoner.address)
      const shamanBalance = await lootToken.balanceOf(shaman.address)
      const shamanVotes = await baal.getCurrentVotes(shaman.address)
      expect(summonerBalance).to.equal(0)
      expect(summonerVotes).to.equal(100)
      expect(shamanBalance).to.equal(500)
      expect(shamanVotes).to.equal(0)
    })

    it('require fails - loot paused', async function () {
      await shamanBaal.setAdminConfig(false, true) // pause loot
      await lootToken.approve(shaman.address, 500)
      expect(shamanLootToken.transferFrom(summoner.address, shaman.address, 500)).to.be.revertedWith(revertMessages.lootTransferPaused)
    })

    it('require fails - insufficient balance', async function () {
      await lootToken.approve(shaman.address, 500)
      expect(shamanLootToken.transferFrom(summoner.address, shaman.address, 501)).to.be.revertedWith(revertMessages.lootInsufficientBalance)
    })

    it('require fails - insufficeint approval', async function () {
      await lootToken.approve(shaman.address, 499)
      expect(shamanLootToken.transferFrom(summoner.address, shaman.address, 500)).to.be.revertedWith(revertMessages.lootInsufficientApproval)
    })
  })

  describe('submitProposal', function () {
    it('happy case', async function () {
      // note - this also tests that members can submit proposals without offering tribute
      // note - this also tests that member proposals are self-sponsored (bc votingStarts != 0)
      const countBefore = await baal.proposalCount()

      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      // TODO test return value - use a helper contract to submit + save the returned ID

      const now = await blockTime()

      const countAfter = await baal.proposalCount()
      expect(countAfter).to.equal(countBefore + 1)

      const state = await baal.state(1)
      expect(state).to.equal(STATES.VOTING)

      const proposalData = await baal.proposals(1)
      expect(proposalData.id).to.equal(1)
      expect(proposalData.votingStarts).to.equal(now)
      expect(proposalData.votingEnds).to.equal(now + deploymentConfig.VOTING_PERIOD_IN_SECONDS)
      expect(proposalData.yesVotes).to.equal(0)
      expect(proposalData.noVotes).to.equal(0)
      expect(proposalData.expiration).to.equal(proposal.expiration)
      expect(proposalData.details).to.equal(ethers.utils.id(proposal.details))
      expect(hashOperation(proposal.data)).to.equal(proposalData.proposalDataHash)
      const proposalStatus = await baal.getProposalStatus(1)
      expect(proposalStatus).to.eql([false, false, false, false])
    })

    it('require fail - expiration passed', async function() {
      const now = await blockTime()
      expect(baal.submitProposal(proposal.data, now, ethers.utils.id(proposal.details))).to.be.revertedWith(revertMessages.submitProposalExpired)
    })

    it('edge case - expiration exists, but far enough ahead', async function() {
      const countBefore = await baal.proposalCount()
      const expiration = (await blockTime()) + deploymentConfig.VOTING_PERIOD_IN_SECONDS + deploymentConfig.GRACE_PERIOD_IN_SECONDS + 10000
      await baal.submitProposal(proposal.data, expiration, ethers.utils.id(proposal.details))

      const countAfter = await baal.proposalCount()
      expect(countAfter).to.equal(countBefore + 1)

      const proposalData = await baal.proposals(1)
      expect(proposalData.id).to.equal(1)
    })
  })

  describe('sponsorProposal', function () {
    it('happy case', async function () {
      await shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))

      const proposalData = await baal.proposals(1)
      expect(proposalData.votingStarts).to.equal(0)
      const state = await baal.state(1)
      expect(state).to.equal(STATES.SUBMITTED) 

      await baal.sponsorProposal(1)
      const now = await blockTime()
      const proposalDataSponsored = await baal.proposals(1)
      expect(proposalDataSponsored.votingStarts).to.equal(now)
      expect(proposalDataSponsored.votingEnds).to.equal(now + deploymentConfig.VOTING_PERIOD_IN_SECONDS)

      const state2 = await baal.state(1)
      expect(state2).to.equal(STATES.VOTING) 
    })

    it('require fail - expired', async function () {
      const expiration = (await blockTime()) + deploymentConfig.VOTING_PERIOD_IN_SECONDS + deploymentConfig.GRACE_PERIOD_IN_SECONDS + 10000
      await shamanBaal.submitProposal(proposal.data, expiration, ethers.utils.id(proposal.details))
      await moveForwardPeriods(1)
      expect(baal.sponsorProposal(1)).to.be.revertedWith(revertMessages.sponsorProposalExpired)
    })

    it('edge case - expiration exists, but far enough ahead', async function() {
      const expiration = (await blockTime()) + deploymentConfig.VOTING_PERIOD_IN_SECONDS + deploymentConfig.GRACE_PERIOD_IN_SECONDS + 10000
      await baal.submitProposal(proposal.data, expiration, ethers.utils.id(proposal.details))
      const now = await blockTime()
      const proposalDataSponsored = await baal.proposals(1)
      expect(proposalDataSponsored.votingStarts).to.equal(now)
    })

    it('require fail - not sponsor', async function () {
      await shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))

      expect(shamanBaal.sponsorProposal(1)).to.be.revertedWith(revertMessages.sponsorProposalSponsor)
    })

    it('edge case - just enough shares to sponsor', async function () {
      await shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))

      const proposalData = await baal.proposals(1)
      expect(proposalData.votingStarts).to.equal(0)

      await baal.transfer(shaman.address, deploymentConfig.SPONSOR_THRESHOLD)
      
      await shamanBaal.sponsorProposal(1)
      const now = await blockTime()
      const proposalDataSponsored = await baal.proposals(1)
      expect(proposalDataSponsored.votingStarts).to.equal(now)
    })

    it('require fail - proposal doesnt exist', async function () {
      const state = await baal.state(1) 
      expect(state).to.equal(STATES.UNBORN)
      expect(baal.sponsorProposal(1)).to.be.revertedWith(revertMessages.sponsorProposalNotSubmitted)
    })

    it('require fail - already sponsored', async function () {
      await shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))

      const proposalData = await baal.proposals(1)
      expect(proposalData.votingStarts).to.equal(0)
      await baal.sponsorProposal(1)
      const state = await baal.state(1) 
      expect(state).to.equal(STATES.VOTING)
      expect(baal.sponsorProposal(1)).to.be.revertedWith(revertMessages.sponsorProposalNotSubmitted)
    })
  })

  describe('submitVote (w/ auto self-sponsor)', function () {
    beforeEach(async function () {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
    })

    it('happy case - yes vote', async function () {
      await baal.submitVote(1, yes)
      const prop = await baal.proposals(1)
      const nCheckpoints = await baal.numCheckpoints(summoner.address)
      const votes = (await baal.checkpoints(summoner.address, nCheckpoints.sub(1))).votes
      const priorVotes = await baal.getPriorVotes(summoner.address, prop.votingStarts)
      expect(priorVotes).to.equal(votes)
      expect(prop.yesVotes).to.equal(votes);
      expect(prop.maxTotalSharesAndLootAtYesVote).to.equal(shares + loot)
    });

    it("happy case - no vote", async function () {
      await baal.submitVote(1, no);
      const prop = await baal.proposals(1);
      const nCheckpoints = await baal.numCheckpoints(summoner.address);
      const votes = (
        await baal.checkpoints(summoner.address, nCheckpoints.sub(1))
      ).votes;
      expect(prop.noVotes).to.equal(votes);
    });

    it("require fail - voting period has ended", async function () {
      await moveForwardPeriods(2);
      const state = await baal.state(1)
      expect(state).to.equal(STATES.DEEFEATED)
      expect(baal.submitVote(1, no)).to.be.revertedWith(
        revertMessages.submitVoteNotVoting
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

    it('scenario - two yes votes', async function () {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details)) // p2
      await baal.submitVote(1, yes)
      await baal.submitVote(2, yes)
      const prop1 = await baal.proposals(1)
      const votes1 = await baal.getPriorVotes(summoner.address, prop1.votingStarts)
      expect(prop1.yesVotes).to.equal(votes1);

      const prop2 = await baal.proposals(2)
      const votes2 = await baal.getPriorVotes(summoner.address, prop2.votingStarts)
      expect(prop2.yesVotes).to.equal(votes2);
    });
  });
  
  describe('submitVote (no self-sponsor)', function () {
    it('require fail - voting not started', async function() {
      await shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      const state = await baal.state(1)
      expect(state).to.equal(STATES.SUBMITTED)
      expect(baal.submitVote(1, no)).to.be.revertedWith(
        revertMessages.submitVoteNotVoting
      );
    })

    it('scenario - increase shares during voting', async function () {
      await shamanBaal.mintShares([shaman.address], [100]) // add 100 shares for shaman
      await shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, yes)
      const prop1 = await baal.proposals(1)
      expect(prop1.maxTotalSharesAndLootAtYesVote).to.equal(shares + loot + 100)
      await shamanBaal.mintShares([shaman.address], [100]) // add another 100 shares for shaman
      await shamanBaal.submitVote(1, yes)
      const prop = await baal.proposals(1)
      expect(prop.yesVotes).to.equal(200); // 100 summoner and 1st 100 from shaman are counted
      expect(prop.maxTotalSharesAndLootAtYesVote).to.equal(shares + loot + 200)
    });

    it('scenario - decrease shares during voting', async function () {
      await shamanBaal.mintShares([shaman.address], [100]) // add 100 shares for shaman
      await shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, yes)
      const prop1 = await baal.proposals(1)
      expect(prop1.maxTotalSharesAndLootAtYesVote).to.equal(shares + loot + 100)
      await shamanBaal.ragequit(shaman.address, 50, 0)
      await shamanBaal.submitVote(1, yes)
      const prop = await baal.proposals(1)
      expect(prop.yesVotes).to.equal(200); // 100 summoner and 1st 100 from shaman are counted (not affected by rq)
      expect(prop.maxTotalSharesAndLootAtYesVote).to.equal(shares + loot + 100) // unchanged
    });
  })

  describe.only('submitVoteWithSig (w/ auto self-sponsor)', function () {
    beforeEach(async function () {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
    })

    it('happy case - yes vote', async function () {
      // await baal.submitVoteWithSig(1, yes)
      const signature = await signVote(chainId,baal.address,summoner,deploymentConfig.TOKEN_NAME,1,true)
      console.log(`signer: ${summoner.address}`)
      await baal.submitVoteWithSig(1, true, signature)
      const prop = await baal.proposals(1)
      const nCheckpoints = await baal.numCheckpoints(summoner.address)
      const votes = (await baal.checkpoints(summoner.address, nCheckpoints.sub(1))).votes
      const priorVotes = await baal.getPriorVotes(summoner.address, prop.votingStarts)
      expect(priorVotes).to.equal(votes)
      expect(prop.yesVotes).to.equal(votes);
    });
  })

  describe("processProposal", function () {
    it("happy case yes wins", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      const beforeProcessed = await baal.proposals(1);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed)
      const state = await baal.state(1)
      expect(state).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(1)
      expect(propStatus).to.eql([false, true, true, false])
    });

    it("require fail - no wins, proposal is defeated", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, no);
      await moveForwardPeriods(2);
      const state = await baal.state(1)
      expect(state).to.equal(STATES.DEEFEATED)
      expect(baal.processProposal(1, proposal.data)).to.be.revertedWith(revertMessages.processProposalNotReady)
    });

    it("require fail - proposal does not exist", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      const state = await baal.state(2)
      expect(state).to.equal(STATES.UNBORN)
      expect(
        baal.processProposal(2, proposal.data)
      ).to.be.revertedWith(revertMessages.processProposalNotReady);
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
        baal.processProposal(2, proposal.data)
      ).to.be.revertedWith("prev!processed");
    });

    it("require fail - proposal data mismatch on processing", async function () {
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
        baal.processProposal(1, badSelfTransferAction)
      ).to.be.revertedWith("incorrect calldata");
    });

    it("require fail - proposal not in voting", async function () {
      await shamanBaal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      expect(baal.processProposal(1, proposal.data)).to.be.revertedWith(revertMessages.processProposalNotReady) // fail at submitted
      await baal.sponsorProposal(1)
      expect(baal.processProposal(1, proposal.data)).to.be.revertedWith(revertMessages.processProposalNotReady) // fail at voting
      await baal.submitVote(1, yes);
      const beforeProcessed = await baal.proposals(1);
      await moveForwardPeriods(1);
      const state1 = await baal.state(1)
      expect(state1).to.equal(STATES.GRACE)
      expect(baal.processProposal(1, proposal.data)).to.be.revertedWith(revertMessages.processProposalNotReady) // fail at grace
      await moveForwardPeriods(1);
      await baal.processProposal(1, proposal.data); // propsal ready, works
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed)
      const state = await baal.state(1)
      expect(state).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(1)
      expect(propStatus).to.eql([false, true, true, false])
    });

    it("require fail - proposal cancelled", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await shamanBaal.cancelProposal(1)
      await moveForwardPeriods(2);
      const state = await baal.state(1)
      expect(state).to.equal(STATES.CANCELLED)
      expect(baal.processProposal(1, proposal.data)).to.be.revertedWith(revertMessages.processProposalNotReady)
    });

    it("require fail - proposal expired", async function () {
      proposal.expiration = await blockTime() + deploymentConfig.VOTING_PERIOD_IN_SECONDS + deploymentConfig.GRACE_PERIOD_IN_SECONDS + 2
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1)
      expect(state1).to.equal(STATES.READY)
      const beforeProcessed = await baal.proposals(1)
      await baal.processProposal(1, proposal.data)
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed)
      const state2 = await baal.state(1)
      expect(state2).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(1)
      expect(propStatus).to.eql([false, true, false, false]) // passed [3] is false
    });

    it("edge case - exactly at quorum", async function () {
      const governanceConfig = abiCoder.encode(
        ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS, deploymentConfig.GRACE_PERIOD_IN_SECONDS, deploymentConfig.PROPOSAL_OFFERING, 
          10, deploymentConfig.SPONSOR_THRESHOLD, deploymentConfig.MIN_RETENTION_PERCENT
        ]
      )

      await shamanBaal.mintShares([shaman.address], [900]) // mint 900 shares so summoner has exectly 10% w/ 100 shares

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1)
      expect(state1).to.equal(STATES.READY)
      await shamanBaal.setGovernanceConfig(governanceConfig) // set quorum to 10%
      const beforeProcessed = await baal.proposals(1)
      await baal.processProposal(1, proposal.data)
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed)
      const state2 = await baal.state(1)
      expect(state2).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(1)
      expect(propStatus).to.eql([false, true, true, false]) // passed [3] is true
    });

    it("edge case - just under quorum", async function () {
      const governanceConfig = abiCoder.encode(
        ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS, deploymentConfig.GRACE_PERIOD_IN_SECONDS, deploymentConfig.PROPOSAL_OFFERING, 
          10, deploymentConfig.SPONSOR_THRESHOLD, deploymentConfig.MIN_RETENTION_PERCENT
        ]
      )

      await shamanBaal.mintShares([shaman.address], [901]) // mint 901 shares so summoner has <10% w/ 100 shares

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1)
      expect(state1).to.equal(STATES.READY)
      await shamanBaal.setGovernanceConfig(governanceConfig) // set quorum to 10%
      const beforeProcessed = await baal.proposals(1)
      await baal.processProposal(1, proposal.data)
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed)
      const state2 = await baal.state(1)
      expect(state2).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(1)
      expect(propStatus).to.eql([false, true, false, false]) // passed [3] is false
    });

    it("edge case - exactly at minRetentionPercent", async function () {
      const governanceConfig = abiCoder.encode(
        ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS, deploymentConfig.GRACE_PERIOD_IN_SECONDS, deploymentConfig.PROPOSAL_OFFERING, 
          0, deploymentConfig.SPONSOR_THRESHOLD, 90 // min retention % = 90%, ragequit >10% of shares+loot to trigger
        ]
      )

      await shamanBaal.setGovernanceConfig(governanceConfig) // set min retention to 90%

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1)
      await baal.ragequit(summoner.address, 10, 50) // ragequit 10 shares out of 100 and 50 loot out of 500
      expect(state1).to.equal(STATES.READY)
      const beforeProcessed = await baal.proposals(1)
      await baal.processProposal(1, proposal.data)
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed)
      const state2 = await baal.state(1)
      expect(state2).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(1)
      expect(propStatus).to.eql([false, true, true, false]) // passed [3] is true
    });

    it("edge case - just below minRetentionPercent - shares+loot", async function () {
      const governanceConfig = abiCoder.encode(
        ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS, deploymentConfig.GRACE_PERIOD_IN_SECONDS, deploymentConfig.PROPOSAL_OFFERING, 
          0, deploymentConfig.SPONSOR_THRESHOLD, 90 // min retention % = 90%, ragequit >10% of shares to trigger
        ]
      )

      await shamanBaal.setGovernanceConfig(governanceConfig) // set min retention to 90%

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1)
      await baal.ragequit(summoner.address, 11, 50) // ragequit 11 shares out of 100, and 50 out of 500
      expect(state1).to.equal(STATES.READY)
      const beforeProcessed = await baal.proposals(1)
      await baal.processProposal(1, proposal.data)
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed)
      const state2 = await baal.state(1)
      expect(state2).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(1)
      expect(propStatus).to.eql([false, true, false, false]) // passed [3] is false - min retention exceeded
    });

    it("edge case - just below minRetentionPercent - just shares", async function () {
      const governanceConfig = abiCoder.encode(
        ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS, deploymentConfig.GRACE_PERIOD_IN_SECONDS, deploymentConfig.PROPOSAL_OFFERING, 
          0, deploymentConfig.SPONSOR_THRESHOLD, 90 // min retention % = 90%, ragequit >10% of shares to trigger
        ]
      )

      await shamanBaal.setGovernanceConfig(governanceConfig) // set min retention to 90%

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1)
      await baal.ragequit(summoner.address, 61, 0) // ragequit 61 shares out of 100, and 0 out of 500
      expect(state1).to.equal(STATES.READY)
      const beforeProcessed = await baal.proposals(1)
      await baal.processProposal(1, proposal.data)
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed)
      const state2 = await baal.state(1)
      expect(state2).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(1)
      expect(propStatus).to.eql([false, true, false, false]) // passed [3] is false - min retention exceeded
    });

    it("edge case - just below minRetentionPercent - just loot", async function () {
      const governanceConfig = abiCoder.encode(
        ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
        [
          deploymentConfig.VOTING_PERIOD_IN_SECONDS, deploymentConfig.GRACE_PERIOD_IN_SECONDS, deploymentConfig.PROPOSAL_OFFERING, 
          0, deploymentConfig.SPONSOR_THRESHOLD, 90 // min retention % = 90%, ragequit >10% of shares to trigger
        ]
      )

      await shamanBaal.setGovernanceConfig(governanceConfig) // set min retention to 90%

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1)
      await baal.ragequit(summoner.address, 0, 61) // ragequit 0 shares out of 100, and 61 out of 500
      expect(state1).to.equal(STATES.READY)
      const beforeProcessed = await baal.proposals(1)
      await baal.processProposal(1, proposal.data)
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed)
      const state2 = await baal.state(1)
      expect(state2).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(1)
      expect(propStatus).to.eql([false, true, false, false]) // passed [3] is false - min retention exceeded
    });

    it("scenario - offer tribute", async function () {
      weth.transfer(applicant.address, 100) // summoner transfer 100 weth
      const offerWeth = weth.interface.encodeFunctionData('transferFrom', [applicant.address, baal.address, 100])
      const tributeMultiAction = encodeMultiAction(multisend, [offerWeth], [weth.address], [BigNumber.from(0)], [0])
      proposal.data = tributeMultiAction

      await applicantWeth.approve(baal.address, 100)

      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      const beforeProcessed = await baal.proposals(1);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      const afterProcessed = await baal.proposals(1);
      verifyProposal(afterProcessed, beforeProcessed, { processed: true, passed: true })
      const applicantWethBalance = await weth.balanceOf(applicant.address)
      expect(applicantWethBalance).to.equal(0)
      const baalWethBalance = await weth.balanceOf(baal.address)
      expect(baalWethBalance).to.equal(100)
    });

    it("scenario - two propsals, prev is processed", async function () {
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
      const beforeProcessed = await baal.proposals(2);
      await moveForwardPeriods(2);
      await baal.processProposal(1, proposal.data);
      const state1 = await baal.state(1)
      expect(state1).to.equal(STATES.PROCESSED) // prev prop processed
      await baal.processProposal(2, proposal.data);
      const afterProcessed = await baal.proposals(2);
      verifyProposal(afterProcessed, beforeProcessed)
      const state2 = await baal.state(2)
      expect(state2).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(2)
      expect(propStatus).to.eql([false, true, true, false])
    });

    it("scenario - two propsals, prev is defeated", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, no);
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(2, yes);
      const beforeProcessed = await baal.proposals(2);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1)
      expect(state1).to.equal(STATES.DEEFEATED) // prev prop defeated
      await baal.processProposal(2, proposal.data);
      const afterProcessed = await baal.proposals(2);
      verifyProposal(afterProcessed, beforeProcessed)
      const state2 = await baal.state(2)
      expect(state2).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(2)
      expect(propStatus).to.eql([false, true, true, false])
    });

    it("scenario - two propsals, prev is cancelled", async function () {
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await shamanBaal.cancelProposal(1)
      await baal.submitProposal(
        proposal.data,
        proposal.expiration,
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(2, yes);
      const beforeProcessed = await baal.proposals(2);
      await moveForwardPeriods(2);
      const state1 = await baal.state(1)
      expect(state1).to.equal(STATES.CANCELLED) // prev prop cancelled
      await baal.processProposal(2, proposal.data);
      const afterProcessed = await baal.proposals(2);
      verifyProposal(afterProcessed, beforeProcessed)
      const state2 = await baal.state(2)
      expect(state2).to.equal(STATES.PROCESSED)
      const propStatus = await baal.getProposalStatus(2)
      expect(propStatus).to.eql([false, true, true, false])
    });
  });

  describe("ragequit", function () {
    it('happy case - full ragequit', async function () {
      const lootBefore = await lootToken.balanceOf(summoner.address)
      const summonerWethBefore = await weth.balanceOf(summoner.address)
      await weth.transfer(baal.address, 100)
      await baal.ragequit(summoner.address, shares, loot)
      const sharesAfter = await baal.balanceOf(summoner.address)
      const lootAfter = await lootToken.balanceOf(summoner.address)
      const summonerWethAfter = await weth.balanceOf(summoner.address)
      const baalWethAfter = await weth.balanceOf(baal.address)
      expect(lootAfter).to.equal(lootBefore.sub(loot))
      expect(sharesAfter).to.equal(0)
      expect(summonerWethAfter).to.equal(summonerWethBefore)
      expect(baalWethAfter).to.equal(0)
    })

    it('happy case - partial ragequit', async function () {
      const lootBefore = await lootToken.balanceOf(summoner.address)
      const lootToBurn = 250
      const sharesToBurn = 50
      const summonerWethBefore = await weth.balanceOf(summoner.address)
      await weth.transfer(baal.address, 100)
      await baal.ragequit(summoner.address, sharesToBurn, lootToBurn)
      const sharesAfter = await baal.balanceOf(summoner.address)
      const lootAfter = await lootToken.balanceOf(summoner.address)
      const summonerWethAfter = await weth.balanceOf(summoner.address)
      const baalWethAfter = await weth.balanceOf(baal.address)
      expect(lootAfter).to.equal(lootBefore.sub(lootToBurn))
      expect(sharesAfter).to.equal(50)
      expect(summonerWethAfter).to.equal(summonerWethBefore.sub(50))
      expect(baalWethAfter).to.equal(50)
    })

    it('happy case - full ragequit to different address', async function () {
      const lootBefore = await lootToken.balanceOf(summoner.address)
      const summonerWethBefore = await weth.balanceOf(summoner.address)
      await weth.transfer(baal.address, 100)
      await baal.ragequit(applicant.address, shares, loot) // ragequit to applicant
      const sharesAfter = await baal.balanceOf(summoner.address)
      const lootAfter = await lootToken.balanceOf(summoner.address)
      const summonerWethAfter = await weth.balanceOf(summoner.address)
      const baalWethAfter = await weth.balanceOf(baal.address)
      const applicantWethAfter = await weth.balanceOf(applicant.address)
      expect(lootAfter).to.equal(lootBefore.sub(loot))
      expect(sharesAfter).to.equal(0)
      expect(summonerWethAfter).to.equal(summonerWethBefore.sub(100))
      expect(baalWethAfter).to.equal(0)
      expect(applicantWethAfter).to.equal(100)
    })

    it('happy case - full ragequit - two tokens', async function () {
      // transfer 300 loot to DAO (summoner has 100 shares + 500 loot, so that's 50% of total)
      // transfer 100 weth to DAO
      // ragequit 100% of remaining shares & loot
      // expect: receive 50% of weth / loot from DAO
      await shamanBaal.setGuildTokens([lootToken.address]) // add loot token to guild tokens
      const summonerWethBefore = await weth.balanceOf(summoner.address)
      await weth.transfer(baal.address, 100)
      await lootToken.transfer(baal.address, 300)
      await baal.ragequit(summoner.address, shares, loot - 300)
      const sharesAfter = await baal.balanceOf(summoner.address)
      const lootAfter = await lootToken.balanceOf(summoner.address)
      const baalLootAfter = await lootToken.balanceOf(baal.address)
      const summonerWethAfter = await weth.balanceOf(summoner.address)
      const baalWethAfter = await weth.balanceOf(baal.address)
      expect(lootAfter).to.equal(150) // burn 200, receive 150
      expect(sharesAfter).to.equal(0) 
      expect(summonerWethAfter).to.equal(summonerWethBefore.sub(50)) // minus 100, plus 50
      expect(baalWethAfter).to.equal(50)
      expect(baalLootAfter).to.equal(150)
    })
  })

  describe('advancedRagequit', function() {
    it('collects tokens not on the list', async function () {
      // note - skips having shaman add LOOT to guildTokens
      // transfer 300 loot to DAO (summoner has 100 shares + 500 loot, so that's 50% of total)
      // transfer 100 weth to DAO
      // ragequit 100% of remaining shares & loot
      // expect: receive 50% of weth / loot from DAO
      const summonerWethBefore = await weth.balanceOf(summoner.address)
      await weth.transfer(baal.address, 100)
      await lootToken.transfer(baal.address, 300)
      const tokens = [lootToken.address, weth.address].sort((a, b) => {
        return parseInt(a.slice(2), 16) - parseInt(b.slice(2), 16)
      })
      await baal.advancedRagequit(summoner.address, shares, loot - 300, tokens)
      const sharesAfter = await baal.balanceOf(summoner.address)
      const lootAfter = await lootToken.balanceOf(summoner.address)
      const baalLootAfter = await lootToken.balanceOf(baal.address)
      const summonerWethAfter = await weth.balanceOf(summoner.address)
      const baalWethAfter = await weth.balanceOf(baal.address)
      expect(lootAfter).to.equal(150) // burn 200, receive 150
      expect(sharesAfter).to.equal(0) 
      expect(summonerWethAfter).to.equal(summonerWethBefore.sub(50)) // minus 100, plus 50
      expect(baalWethAfter).to.equal(50)
      expect(baalLootAfter).to.equal(150)
    })

    it('require fail - enforces ascending order', async function () {
      await weth.transfer(baal.address, 100)
      await lootToken.transfer(baal.address, 300)
      const tokens = [lootToken.address, weth.address].sort((a, b) => {
        return parseInt(a.slice(2), 16) - parseInt(b.slice(2), 16)
      }).reverse()
      expect(baal.advancedRagequit(summoner.address, shares, loot - 300, tokens)).to.be.revertedWith(revertMessages.advancedRagequitUnordered)
    })

    it('require fail - prevents actual duplicate', async function () {
      await weth.transfer(baal.address, 100)
      expect(baal.advancedRagequit(summoner.address, shares, loot - 300, [weth.address, weth.address])).to.be.revertedWith(revertMessages.advancedRagequitUnordered)
    })
  })

  describe('getCurrentVotes', function () {
    it('happy case - account with votes', async function () {
      const currentVotes = await baal.getCurrentVotes(summoner.address)
      const nCheckpoints = await baal.numCheckpoints(summoner.address)
      const checkpoints = await baal.checkpoints(summoner.address, nCheckpoints.sub(1))
      const votes = checkpoints.votes
      expect(currentVotes).to.equal(votes)
    })

    it('happy case - account without votes', async function () {
      const currentVotes = await baal.getCurrentVotes(shaman.address)
      expect(currentVotes).to.equal(0)
    })
  })

  describe('getPriorVotes', function () {
    beforeEach(async function () {
      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
    })

    it('happy case - yes vote', async function () {
      const blockT = await blockTime()
      await baal.submitVote(1, yes)
      const priorVote = await baal.getPriorVotes(summoner.address, blockT)
      const nCheckpoints = await baal.numCheckpoints(summoner.address)
      const votes = (await baal.checkpoints(summoner.address, nCheckpoints.sub(1))).votes
      expect(priorVote).to.equal(votes)
    })

    it('happy case - no vote', async function () {
      const blockT = await blockTime()
      await baal.submitVote(1, no)
      const priorVote = await baal.getPriorVotes(summoner.address, blockT)
      const nCheckpoints = await baal.numCheckpoints(summoner.address)
      const votes = (await baal.checkpoints(summoner.address, nCheckpoints.sub(1))).votes
      expect(priorVote).to.equal(votes)
    })

    it('require fail - timestamp not determined', async function () {
      const blockT = await blockTime()
      expect(baal.getPriorVotes(summoner.address, blockT)).to.be.revertedWith('!determined')
    })
  })
})

describe('Baal contract - tribute required', function () {
  let customConfig = { ...deploymentConfig, PROPOSAL_OFFERING: 69, SPONSOR_THRESHOLD: 1 }

  let baal: Baal
  let shamanBaal: Baal
  let weth: TestErc20
  let multisend: MultiSend

  let lootSingleton: Loot
  let LootFactory: ContractFactory
  let lootToken: Loot

  let applicant: SignerWithAddress
  let summoner: SignerWithAddress
  let shaman: SignerWithAddress

  let proposal: { [key: string]: any }

  let encodedInitParams: any

  const loot = 500
  const shares = 100
  const sharesPaused = false
  const lootPaused = false

  this.beforeAll(async function () {
    LootFactory = await ethers.getContractFactory('Loot')
    lootSingleton = (await LootFactory.deploy()) as Loot
  })

  beforeEach(async function () {
    const BaalContract = await ethers.getContractFactory('Baal')
    const MultisendContract = await ethers.getContractFactory('MultiSend')
    ;[summoner, applicant, shaman] = await ethers.getSigners()

    const ERC20 = await ethers.getContractFactory('TestERC20')
    weth = (await ERC20.deploy('WETH', 'WETH', 10000000)) as TestErc20

    multisend = (await MultisendContract.deploy()) as MultiSend

    baal = (await BaalContract.deploy()) as Baal
    shamanBaal = baal.connect(shaman) // needed to send txns to baal as the shaman

    const encodedInitParams = await getBaalParams(
      baal,
      multisend,
      lootSingleton,
      customConfig,
      [sharesPaused, lootPaused],
      [[weth.address]],
      [[shaman.address], [7]],
      [[summoner.address], [shares]],
      [[summoner.address], [loot]]
    )

    await baal.setUp(encodedInitParams)
    const lootTokenAddress = await baal.lootToken()

    lootToken = LootFactory.attach(lootTokenAddress) as Loot

    const selfTransferAction = encodeMultiAction(multisend, ['0x'], [baal.address], [BigNumber.from(0)], [0])

    proposal = {
      flag: 0,
      account: summoner.address,
      data: selfTransferAction,
      details: 'all hail baal',
      expiration: 0,
    }
  })

  describe('submitProposal', function () {
    it('happy case - tribute is accepted, not self-sponsored', async function () {
      // note - this also tests that the proposal is NOT sponsored
      const countBefore = await baal.proposalCount()

      await shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details), { value: 69 })

      const countAfter = await baal.proposalCount()
      expect(countAfter).to.equal(countBefore + 1)

      const proposalData = await baal.proposals(1)
      expect(proposalData.id).to.equal(1)
      expect(proposalData.votingStarts).to.equal(0)
    })

    it('happy case - sponsors can submit without tribute, auto-sponsors', async function () {
      const countBefore = await baal.proposalCount()

      await baal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      const now = await blockTime()

      const countAfter = await baal.proposalCount()
      expect(countAfter).to.equal(countBefore + 1)
      const proposalData = await baal.proposals(1)
      expect(proposalData.id).to.equal(1)
      expect(proposalData.votingStarts).to.equal(now)
    })

    it('edge case - sponsors can submit without tribute at threshold', async function () {
      const countBefore = await baal.proposalCount()
      await baal.transfer(shaman.address, 1) // transfer 1 share to shaman, putting them at threshold (1)

      await shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))
      const now = await blockTime()

      const countAfter = await baal.proposalCount()
      expect(countAfter).to.equal(countBefore + 1)
      const proposalData = await baal.proposals(1)
      expect(proposalData.id).to.equal(1)
      expect(proposalData.votingStarts).to.equal(now)
    })

    it('require fail - no tribute offered', async function () {
      expect(shamanBaal.submitProposal(proposal.data, proposal.expiration, ethers.utils.id(proposal.details))).to.be.revertedWith(
        revertMessages.submitProposalOffering
      )
    })
  })
})

describe('Baal contract - no shares minted - fails', function () {
  let customConfig = { ...deploymentConfig, PROPOSAL_OFFERING: 69, SPONSOR_THRESHOLD: 1 }

  let baal: Baal
  let shamanBaal: Baal
  let weth: TestErc20
  let multisend: MultiSend

  let lootSingleton: Loot
  let LootFactory: ContractFactory
  let lootToken: Loot

  let applicant: SignerWithAddress
  let summoner: SignerWithAddress
  let shaman: SignerWithAddress

  let encodedInitParams: any

  const loot = 500
  const shares = 100
  const sharesPaused = false
  const lootPaused = false

  this.beforeAll(async function () {
    LootFactory = await ethers.getContractFactory('Loot')
    lootSingleton = (await LootFactory.deploy()) as Loot
  })

  it('fails when 0 shares are provided', async function () {
    const BaalContract = await ethers.getContractFactory('Baal')
    const MultisendContract = await ethers.getContractFactory('MultiSend')
    ;[summoner, applicant, shaman] = await ethers.getSigners()

    const ERC20 = await ethers.getContractFactory('TestERC20')
    weth = (await ERC20.deploy('WETH', 'WETH', 10000000)) as TestErc20

    multisend = (await MultisendContract.deploy()) as MultiSend

    baal = (await BaalContract.deploy()) as Baal
    shamanBaal = baal.connect(shaman) // needed to send txns to baal as the shaman

    const encodedInitParams = await getBaalParams(
      baal,
      multisend,
      lootSingleton,
      customConfig,
      [sharesPaused, lootPaused],
      [[weth.address]],
      [[shaman.address], [7]],
      [[summoner.address], [0]], // 0 shares
      [[summoner.address], [loot]]
    )

    expect(baal.setUp(encodedInitParams)).to.be.revertedWith(revertMessages.molochSetupSharesNoShares)
  })
})