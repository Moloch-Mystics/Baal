import { ethers } from 'hardhat'
import { solidity } from 'ethereum-waffle'
import { use, expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { Baal } from '../src/types/Baal'
import { TestErc20 } from '../src/types/TestErc20'
import { RageQuitBank } from '../src/types/RageQuitBank'
import { MultiSend } from '../src/types/MultiSend'
import { GnosisSafe } from '../src/types/GnosisSafe'
import { CompatibilityFallbackHandler } from '../src/types/CompatibilityFallbackHandler'
import { encodeMultiAction } from '../src/util'
import { BigNumber } from '@ethersproject/bignumber'
import { Contract, ContractFactory, ContractReceipt } from '@ethersproject/contracts'

use(solidity)

// chai
//   .use(require('chai-as-promised'))
//   .should();

const revertMessages = {
  molochConstructorShamanCannotBe0: 'shaman cannot be 0',
  molochConstructorGuildTokenCannotBe0: 'guildToken cannot be 0',
  molochConstructorSummonerCannotBe0: 'summoner cannot be 0',
  molochConstructorSharesCannotBe0: 'shares cannot be 0',
  molochConstructorMinVotingPeriodCannotBe0: 'minVotingPeriod cannot be 0',
  molochConstructorMaxVotingPeriodCannotBe0: 'maxVotingPeriod cannot be 0',
  submitProposalVotingPeriod: '!votingPeriod',
  submitProposalArrays: '!array parity',
  submitProposalArrayMax: 'array max',
  submitProposalFlag: '!flag',
  submitVoteTimeEnded: 'ended',
  proposalMisnumbered: '!exist',
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
  const goToTime = deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS * periods
  await ethers.provider.send('evm_increaseTime', [goToTime])
  return true
}

async function deployNewSafe(proxyFactory: Contract, singleton: string): Promise<string> {
  const tx = await proxyFactory.createProxy(singleton, '0x')
  const receipt: ContractReceipt = await tx.wait()
  const events = receipt.events?.filter((x) => {
    return x.event == 'ProxyCreation'
  })
  if (!events) throw new Error()
  const decoded = events[0]?.args

  return decoded?.proxy
}

const deploymentConfig = {
  GRACE_PERIOD_IN_SECONDS: 43200,
  MIN_VOTING_PERIOD_IN_SECONDS: 172800,
  MAX_VOTING_PERIOD_IN_SECONDS: 432000,
  TOKEN_NAME: 'wrapped ETH',
  TOKEN_SYMBOL: 'WETH',
}

describe.only('Zodiac POC', function () {
  let baal: Baal
  let weth: TestErc20
  let shaman: RageQuitBank
  let multisend: MultiSend
  let handler: CompatibilityFallbackHandler

  let gnosisSafeProxyFactory: Contract
  let gnosisSafeSingleton: GnosisSafe
  let gnosisSafe: GnosisSafe

  let BaalContract: ContractFactory
  let ShamanContract: ContractFactory
  let MultisendContract: ContractFactory
  let CompatibilityFallbackHandlerContract: ContractFactory
  let ERC20: ContractFactory
  let GnosisSafeContract: ContractFactory

  let applicant: SignerWithAddress
  let summoner: SignerWithAddress

  let proposal: { [key: string]: any }

  const loot = 500
  const shares = 100
  const sharesPaused = false
  const lootPaused = false

  const yes = true
  const no = false

  this.beforeAll(async function () {
    BaalContract = await ethers.getContractFactory('Baal')
    ShamanContract = await ethers.getContractFactory('RageQuitBank')
    MultisendContract = await ethers.getContractFactory('MultiSend')
    CompatibilityFallbackHandlerContract = await ethers.getContractFactory('CompatibilityFallbackHandler')
    ERC20 = await ethers.getContractFactory('TestERC20')
    ;[summoner, applicant] = await ethers.getSigners()

    GnosisSafeContract = await ethers.getContractFactory('GnosisSafe')
    const GnosisSafeProxyFactory = await ethers.getContractFactory('GnosisSafeProxyFactory')
    gnosisSafeSingleton = (await GnosisSafeContract.deploy()) as GnosisSafe
    gnosisSafeProxyFactory = await GnosisSafeProxyFactory.deploy()

    multisend = (await MultisendContract.deploy()) as MultiSend
    handler = (await CompatibilityFallbackHandlerContract.deploy()) as CompatibilityFallbackHandler
  })

  beforeEach(async function () {
    weth = (await ERC20.deploy('WETH', 'WETH', 10000000)) as TestErc20

    shaman = (await ShamanContract.deploy()) as RageQuitBank

    baal = (await BaalContract.deploy()) as Baal

    const newSafeAddress = await deployNewSafe(gnosisSafeProxyFactory, gnosisSafeSingleton.address)
    gnosisSafe = (await GnosisSafeContract.attach(newSafeAddress)) as GnosisSafe

    const enableModuleAction = await gnosisSafe.interface.encodeFunctionData('enableModule', [baal.address])
    const setupMultisend = encodeMultiAction(multisend, [enableModuleAction], [gnosisSafe.address], [BigNumber.from(0)], [0])

    await gnosisSafe.setup([baal.address], 1, multisend.address, setupMultisend, handler.address, zeroAddress, 0, zeroAddress)

    const abiCoder = ethers.utils.defaultAbiCoder

    const periods = abiCoder.encode(
      ['uint32', 'uint32', 'uint32', 'bool', 'bool'],
      [
        deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS,
        deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS,
        deploymentConfig.GRACE_PERIOD_IN_SECONDS,
        lootPaused,
        sharesPaused,
      ]
    )

    const setPeriods = await baal.interface.encodeFunctionData('setPeriods', [periods])
    const setGuildTokens = await baal.interface.encodeFunctionData('setGuildTokens', [[weth.address]])
    const setShaman = await baal.interface.encodeFunctionData('setShamans', [[shaman.address], true])
    const mintShares = await baal.interface.encodeFunctionData('mintShares', [[summoner.address], [shares]])
    const mintLoot = await baal.interface.encodeFunctionData('mintLoot', [[summoner.address], [loot]])
    const delegateSummoners = await baal.interface.encodeFunctionData('delegateSummoners', [[summoner.address], [summoner.address]])

    const initalizationActions = encodeMultiAction(
      multisend,
      [setPeriods, setGuildTokens, setShaman, mintShares, mintLoot, delegateSummoners],
      [baal.address, baal.address, baal.address, baal.address, baal.address, baal.address],
      [BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0)],
      [0, 0, 0, 0, 0, 0]
    )

    const encodedInitParams = abiCoder.encode(
      ['string', 'string', 'address', 'bytes'],
      [deploymentConfig.TOKEN_NAME, deploymentConfig.TOKEN_SYMBOL, multisend.address, initalizationActions]
    )

    await baal.setUp(encodedInitParams)

    await shaman.init(baal.address)

    const selfTransferAction = encodeMultiAction(multisend, ['0x'], [baal.address], [BigNumber.from(0)], [0])
    
    proposal = {
      flag: 0,
      votingPeriod: 175000,
      account: summoner.address,
      data: selfTransferAction,
      details: 'all hail baal',
    }
  })

  describe('constructor', function () {
    it('verify deployment parameters', async function () {
      const now = await blockTime()

      const decimals = await baal.decimals()
      expect(decimals).to.equal(18)

      const gracePeriod = await baal.gracePeriod()
      expect(gracePeriod).to.equal(deploymentConfig.GRACE_PERIOD_IN_SECONDS)

      const minVotingPeriod = await baal.minVotingPeriod()
      expect(minVotingPeriod).to.equal(deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS)

      const maxVotingPeriod = await baal.maxVotingPeriod()
      expect(maxVotingPeriod).to.equal(deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS)

      const name = await baal.name()
      expect(name).to.equal(deploymentConfig.TOKEN_NAME)

      const symbol = await baal.symbol()
      expect(symbol).to.equal(deploymentConfig.TOKEN_SYMBOL)

      const lootPaused = await baal.lootPaused()
      expect(lootPaused).to.be.false

      const sharesPaused = await baal.sharesPaused()
      expect(sharesPaused).to.be.false

      const shamans = await baal.shamans(shaman.address)
      expect(shamans).to.be.true

      const guildTokens = await baal.getGuildTokens()
      expect(guildTokens[0]).to.equal(weth.address)

      const summonerData = await baal.members(summoner.address)
      expect(summonerData.loot).to.equal(500)
      expect(summonerData.highestIndexYesVote).to.equal(0)

      expect(await baal.balanceOf(summoner.address)).to.equal(100)

      const totalLoot = await baal.totalLoot()
      expect(totalLoot).to.equal(500)

      expect(await gnosisSafe.isModuleEnabled(baal.address)).to.equal(true)
    })
  })

  describe('Executing as module', async function () {
    it('allows baal to execute gnosis transactions', async function () {
      await weth.transfer(gnosisSafe.address, 1000)
      
      expect(await weth.balanceOf(gnosisSafe.address)).to.equal(1000)
      
      const transferWethAction = await weth.interface.encodeFunctionData('transfer', [zeroAddress, 500])
      const execAsModuleAction = await gnosisSafe.interface.encodeFunctionData('execTransactionFromModule', [multisend.address, 0, transferWethAction, 1])

      const encodedAction = encodeMultiAction(multisend, [execAsModuleAction], [gnosisSafe.address], [BigNumber.from(0)], [0])
      await baal.submitProposal(proposal.votingPeriod, encodedAction, ethers.utils.id(proposal.details))
      await baal.submitVote(1, yes)
      await moveForwardPeriods(2)
      await baal.processProposal(1)
      expect(await baal.proposalsPassed(1)).to.equal(true)

      expect(await weth.balanceOf(gnosisSafe.address)).to.equal(500)
    })
  })
})
