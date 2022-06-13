import { ethers } from 'hardhat'
import { solidity } from 'ethereum-waffle'
import { use, expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { Baal } from '../src/types/Baal'
import { TestErc20 } from '../src/types/TestErc20'
import { TributeMinion } from '../src/types/TributeMinion'
import { Loot } from '../src/types/Loot'
import { decodeMultiAction, encodeMultiAction } from '../src/util'
import { BigNumber } from '@ethersproject/bignumber'
import { buildContractCall } from '@gnosis.pm/safe-contracts'
import { MultiSend } from '../src/types/MultiSend'
import { CompatibilityFallbackHandler } from '../src/types/CompatibilityFallbackHandler'
import { ContractFactory, ContractTransaction } from 'ethers'
import { ConfigExtender } from 'hardhat/types'
import { Test } from 'mocha'
import { BaalSummoner } from '../src/types/BaalSummoner'
import { GnosisSafe } from '../src/types/GnosisSafe'
import { Poster } from '../src/types/Poster'
import { Shares } from '../src/types/Shares'

use(solidity)

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

async function moveForwardPeriods(periods: number, extra?: number) {
  const goToTime = (await blockTime()) + (deploymentConfig.VOTING_PERIOD_IN_SECONDS * periods) + (extra ? extra : 0)
  await ethers.provider.send("evm_mine", [goToTime])
  return true
}
const getNewBaalAddresses = async (tx: ContractTransaction): Promise<{ baal: string; loot: string; safe: string }> => {
  const receipt = await ethers.provider.getTransactionReceipt(tx.hash)
  // console.log({logs: receipt.logs})
  let baalSummonAbi = ['event SummonBaal(address indexed baal, address indexed loot, address indexed shares, address safe)']
  let iface = new ethers.utils.Interface(baalSummonAbi)
  let log = iface.parseLog(receipt.logs[receipt.logs.length - 1])
  const { baal, loot, safe } = log.args
  return { baal, loot, safe }
}

const deploymentConfig = {
  GRACE_PERIOD_IN_SECONDS: 43200,
  VOTING_PERIOD_IN_SECONDS: 432000,
  PROPOSAL_OFFERING: 0,
  SPONSOR_THRESHOLD: 1,
  MIN_RETENTION_PERCENT: 0,
  MIN_STAKING_PERCENT: 0,
  QUORUM_PERCENT: 0,
  TOKEN_NAME: 'wrapped ETH',
  TOKEN_SYMBOL: 'WETH',
}

const metadataConfig = {
  CONTENT: '{"name":"test"}',
  TAG: 'daohaus.summon.metadata'
}

const abiCoder = ethers.utils.defaultAbiCoder

const getBaalParams = async function (
  baal: Baal,
  multisend: MultiSend,
  lootSingleton: Loot,
  sharesSingleton: Shares,
  poster: Poster,
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
  shamans: [string[], number[]],
  shares: [string[], number[]],
  loots: [string[], number[]]
) {
  const governanceConfig = abiCoder.encode(
    ['uint32', 'uint32', 'uint256', 'uint256', 'uint256', 'uint256'],
    [
      config.VOTING_PERIOD_IN_SECONDS,
      config.GRACE_PERIOD_IN_SECONDS,
      config.PROPOSAL_OFFERING,
      config.QUORUM_PERCENT,
      config.SPONSOR_THRESHOLD,
      config.MIN_RETENTION_PERCENT,
    ]
  )

  const setAdminConfig = await baal.interface.encodeFunctionData('setAdminConfig', adminConfig)
  const setGovernanceConfig = await baal.interface.encodeFunctionData('setGovernanceConfig', [governanceConfig])
  const setShaman = await baal.interface.encodeFunctionData('setShamans', shamans)
  const mintShares = await baal.interface.encodeFunctionData('mintShares', shares)
  const mintLoot = await baal.interface.encodeFunctionData('mintLoot', loots)
  const postMetaData = await poster.interface.encodeFunctionData('post', [metadataConfig.CONTENT, metadataConfig.TAG])
  const posterFromBaal = await baal.interface.encodeFunctionData('executeAsBaal', [poster.address, 0, postMetaData])


  const initalizationActions = [setAdminConfig, setGovernanceConfig, setShaman, mintShares, mintLoot, posterFromBaal]

  return {
    initParams: abiCoder.encode(
      ['string', 'string', 'address', 'address', 'address'],
      [config.TOKEN_NAME, config.TOKEN_SYMBOL, lootSingleton.address, sharesSingleton.address, multisend.address]
    ),
    initalizationActions,
  }
}


describe('Tribute proposal type', function () {
  let baal: Baal
  let lootSingleton: Loot
  let LootFactory: ContractFactory
  let sharesSingleton: Shares
  let SharesFactory: ContractFactory
  let ERC20: ContractFactory
  let lootToken: Loot
  let sharesToken: Shares
  let shamanLootToken: Loot
  let shamanBaal: Baal
  let applicantBaal: Baal
  let weth: TestErc20
  let applicantWeth: TestErc20
  let multisend: MultiSend
  let poster: Poster

  let BaalFactory: ContractFactory
  let baalSingleton: Baal
  let baalSummoner: BaalSummoner
  let gnosisSafeSingleton: GnosisSafe
  let gnosisSafe: GnosisSafe

  let Poster: ContractFactory

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
    SharesFactory = await ethers.getContractFactory('Shares')
    sharesSingleton = (await SharesFactory.deploy()) as Shares
    BaalFactory = await ethers.getContractFactory('Baal')
    baalSingleton = (await BaalFactory.deploy()) as Baal
    Poster = await ethers.getContractFactory('Poster')
    poster = (await Poster.deploy()) as Poster
  })

  beforeEach(async function () {
    const GnosisSafe = await ethers.getContractFactory('GnosisSafe')
    const BaalSummoner = await ethers.getContractFactory('BaalSummoner')
    const CompatibilityFallbackHandler = await ethers.getContractFactory('CompatibilityFallbackHandler')
    const BaalContract = await ethers.getContractFactory('Baal')
    const MultisendContract = await ethers.getContractFactory('MultiSend')
    const GnosisSafeProxyFactory = await ethers.getContractFactory('GnosisSafeProxyFactory')
    const ModuleProxyFactory = await ethers.getContractFactory('ModuleProxyFactory')
    ;[summoner, applicant, shaman, s1, s2, s3, s4, s5, s6] = await ethers.getSigners()


    ERC20 = await ethers.getContractFactory('TestERC20')
    weth = (await ERC20.deploy('WETH', 'WETH', 10000000)) as TestErc20
    applicantWeth = weth.connect(applicant)
    
    await weth.transfer(applicant.address, 1000)

    multisend = (await MultisendContract.deploy()) as MultiSend
    gnosisSafeSingleton = (await GnosisSafe.deploy()) as GnosisSafe
    const handler = (await CompatibilityFallbackHandler.deploy()) as CompatibilityFallbackHandler
    const proxy = await GnosisSafeProxyFactory.deploy()
    const moduleProxyFactory = (await ModuleProxyFactory.deploy())
    
    baalSummoner = (await BaalSummoner.deploy(
      baalSingleton.address, 
      gnosisSafeSingleton.address, 
      handler.address, 
      multisend.address,
      proxy.address,
      moduleProxyFactory.address
      )) as BaalSummoner


    encodedInitParams = await getBaalParams(
      baalSingleton,
      multisend,
      lootSingleton,
      sharesSingleton,
      poster,
      deploymentConfig,
      [sharesPaused, lootPaused],
      [[shaman.address], [7]],
      [[summoner.address, applicant.address], [shares, shares]],
      [[summoner.address, applicant.address], [loot, loot]]
    )
    const tx = await baalSummoner.summonBaalAndSafe(encodedInitParams.initParams, encodedInitParams.initalizationActions, 101)
    const addresses = await getNewBaalAddresses(tx)

    baal = BaalFactory.attach(addresses.baal) as Baal
    gnosisSafe = BaalFactory.attach(addresses.safe) as GnosisSafe
    shamanBaal = baal.connect(shaman) // needed to send txns to baal as the shaman
    applicantBaal = baal.connect(applicant) // needed to send txns to baal as the shaman
    s1Baal = baal.connect(s1)
    s2Baal = baal.connect(s2)
    s3Baal = baal.connect(s3)
    s4Baal = baal.connect(s4)
    s5Baal = baal.connect(s5)
    s6Baal = baal.connect(s6)


    const lootTokenAddress = await baal.lootToken()

    lootToken = LootFactory.attach(lootTokenAddress) as Loot
    shamanLootToken = lootToken.connect(shaman)

    const sharesTokenAddress = await baal.sharesToken()

    sharesToken = SharesFactory.attach(sharesTokenAddress) as Shares
    shamanLootToken = lootToken.connect(shaman)

    const selfTransferAction = encodeMultiAction(multisend, ['0x'], [baal.address], [BigNumber.from(0)], [0])

    proposal = {
      flag: 0,
      account: applicant.address,
      data: selfTransferAction,
      details: 'all hail baal',
      expiration: 0,
    }
  })

  describe('Dangerous proposal tribute', function () {
    it('Allows applicant to tribute tokens in exchagne for shares', async function () {
      expect(await weth.balanceOf(gnosisSafe.address)).to.equal(0)

      await applicantWeth.approve(gnosisSafe.address, 100)

      const mintShares = await baal.interface.encodeFunctionData('mintShares', [[applicant.address], [100]])
      const sendTribute = await applicantWeth.interface.encodeFunctionData('transferFrom', [applicant.address, gnosisSafe.address, 100])

      const encodedProposal = encodeMultiAction(
        multisend,
        [mintShares, sendTribute],
        [baal.address, weth.address],
        [BigNumber.from(0), BigNumber.from(0)],
        [0, 0]
      )
      // const encodedProposal = encodeMultiAction(multisend, [mintShares], [baal.address], [BigNumber.from(0)], [0])

      await baal.submitProposal(encodedProposal, proposal.expiration, 0, ethers.utils.id(proposal.details))
      await baal.submitVote(1, yes)
      await moveForwardPeriods(2)
      await baal.processProposal(1, encodedProposal)
      expect(await weth.balanceOf(gnosisSafe.address)).to.equal(100)
      expect(await sharesToken.balanceOf(applicant.address)).to.equal(200) // current shares plus new shares
    })

    it('EXPLOIT - Allows another proposal to spend tokens intended for tribute', async function () {
      
      expect(await weth.balanceOf(gnosisSafe.address)).to.equal(0)

      await applicantWeth.approve(gnosisSafe.address, 100)

      const mintShares = await baal.interface.encodeFunctionData('mintShares', [[applicant.address], [100]])
      const sendTribute = await applicantWeth.interface.encodeFunctionData('transferFrom', [applicant.address, gnosisSafe.address, 100])

      const encodedProposal = encodeMultiAction(
        multisend,
        [mintShares, sendTribute],
        [baal.address, weth.address],
        [BigNumber.from(0), BigNumber.from(0)],
        [0, 0]
      )
      const maliciousProposal = encodeMultiAction(multisend, [sendTribute], [weth.address], [BigNumber.from(0)], [0])
      // const encodedProposal = encodeMultiAction(multisend, [mintShares], [baal.address], [BigNumber.from(0)], [0])

      await baal.submitProposal(encodedProposal, proposal.expiration, 0, ethers.utils.id(proposal.details))
      await baal.submitProposal(maliciousProposal, proposal.expiration, 0, ethers.utils.id(proposal.details))
      await baal.submitVote(1, no)
      await baal.submitVote(2, yes)
      await moveForwardPeriods(2)
      // await baal.processProposal(1, encodedProposal)
      await baal.processProposal(2, maliciousProposal)
      expect(await weth.balanceOf(gnosisSafe.address)).to.equal(100)
      expect(await sharesToken.balanceOf(applicant.address)).to.equal(100) // only current shares no new ones
    })
  })

  describe('safe tribute', function () {
    let tributeMinion: TributeMinion
    this.beforeEach(async function () {
      const TributeMinionContract = await ethers.getContractFactory('TributeMinion')
      tributeMinion = (await TributeMinionContract.deploy()) as TributeMinion
    })
    it('allows external tribute minion to submit share proposal in exchange for tokens', async function () {

      const applicantTributeMinion = tributeMinion.connect(applicant)

      
      expect(await applicantWeth.balanceOf(gnosisSafe.address)).to.equal(0)
      expect(await applicantWeth.balanceOf(applicant.address)).to.equal(1000)

      const cuurentShares = await sharesToken.balanceOf(applicant.address)
      
      await applicantWeth.approve(tributeMinion.address, 10000)

      await applicantTributeMinion.submitTributeProposal(baal.address, applicantWeth.address, 100, 1234, 1007, proposal.expiration, 'tribute');
      await baal.sponsorProposal(1)
      await baal.submitVote(1, yes)
      await moveForwardPeriods(2)

      const encodedProposal = await tributeMinion.encodeTributeProposal(baal.address, 1234, 1007, applicant.address, 1, tributeMinion.address)

      const decoded = decodeMultiAction(multisend, encodedProposal)
      
      // TODO: why is this commented out
      // await tributeMinion.releaseEscrow(baal.address,1)

      await baal.processProposal(1, encodedProposal)

      const state = await baal.state(1)
      // const propData = await baal.proposals(1)
      const propStatus = await baal.getProposalStatus(1)
      console.log({state, propStatus})

      expect(await sharesToken.balanceOf(applicant.address)).to.equal(1234 + parseInt(cuurentShares.toString()))
      expect(await applicantWeth.balanceOf(gnosisSafe.address)).to.equal(100)
    })
  })

})
