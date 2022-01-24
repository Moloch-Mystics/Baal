import { ethers } from 'hardhat'
import { solidity } from 'ethereum-waffle'
import { use, expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { Baal } from '../src/types/Baal'
import { Loot } from '../src/types/Loot'
import { TestErc20 } from '../src/types/TestErc20'
import { RageQuitBank } from '../src/types/RageQuitBank'
import { MultiSend } from '../src/types/MultiSend'
import { encodeMultiAction, hashOperation } from '../src/util'
import { BigNumber } from '@ethersproject/bignumber'
import { buildContractCall } from '@gnosis.pm/safe-contracts'
import { ContractFactory } from 'ethers'

use(solidity)

const deploymentConfig = {
  GRACE_PERIOD_IN_SECONDS: 43200,
  MIN_VOTING_PERIOD_IN_SECONDS: 172800,
  MAX_VOTING_PERIOD_IN_SECONDS: 432000,
  PROPOSAL_OFFERING: 0,
  TOKEN_NAME: 'wrapped ETH',
  TOKEN_SYMBOL: 'WETH',
}

describe.only('Loot ERC20', function () {
  let baal: Baal
  let lootSingleton: Loot
  let LootFactory: ContractFactory
  let lootToken: Loot
  let weth: TestErc20
  let shaman: RageQuitBank
  let multisend: MultiSend

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
    LootFactory = await ethers.getContractFactory('Loot')
    lootSingleton = (await LootFactory.deploy()) as Loot
  })

  beforeEach(async function () {
    const BaalContract = await ethers.getContractFactory('Baal')
    const ShamanContract = await ethers.getContractFactory('RageQuitBank')
    const MultisendContract = await ethers.getContractFactory('MultiSend')
    ;[summoner, applicant] = await ethers.getSigners()

    const ERC20 = await ethers.getContractFactory('TestERC20')
    weth = (await ERC20.deploy('WETH', 'WETH', 10000000)) as TestErc20

    shaman = (await ShamanContract.deploy()) as RageQuitBank

    multisend = (await MultisendContract.deploy()) as MultiSend

    baal = (await BaalContract.deploy()) as Baal

    const abiCoder = ethers.utils.defaultAbiCoder

    const periods = abiCoder.encode(
      ['uint32', 'uint32', 'uint32', 'uint256', 'bool', 'bool'],
      [
        deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS,
        deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS,
        deploymentConfig.GRACE_PERIOD_IN_SECONDS,
        deploymentConfig.PROPOSAL_OFFERING,
        lootPaused,
        sharesPaused,
      ]
    )

    const setPeriods = await baal.interface.encodeFunctionData('setPeriods', [periods])
    const setGuildTokens = await baal.interface.encodeFunctionData('setGuildTokens', [[weth.address]])
    const setShaman = await baal.interface.encodeFunctionData('setShamans', [[shaman.address], true])
    const mintShares = await baal.interface.encodeFunctionData('mintShares', [[summoner.address], [shares]])
    const mintLoot = await baal.interface.encodeFunctionData('mintLoot', [[summoner.address], [loot]])
    // const delegateSummoners = await baal.interface.encodeFunctionData('delegateSummoners', [[summoner.address], [summoner.address]])

    const initalizationActions = encodeMultiAction(
      multisend,
      [setPeriods, setGuildTokens, setShaman, mintShares, mintLoot],
      [baal.address, baal.address, baal.address, baal.address, baal.address],
      [BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0), BigNumber.from(0)],
      [0, 0, 0, 0, 0]
    )

    const encodedInitParams = abiCoder.encode(
      ['string', 'string', 'address', 'address', 'bytes'],
      [deploymentConfig.TOKEN_NAME, deploymentConfig.TOKEN_SYMBOL, lootSingleton.address, multisend.address, initalizationActions]
    )

    await baal.setUp(encodedInitParams)

    const lootTokenAddress = await baal.lootToken()

    lootToken = LootFactory.attach(lootTokenAddress) as Loot

    await shaman.init(baal.address)

    const selfTransferAction = encodeMultiAction(multisend, ['0x'], [baal.address], [BigNumber.from(0)], [0])

    proposal = {
      flag: 0,
      votingPeriod: 175000,
      account: summoner.address,
      data: selfTransferAction,
      details: 'all hail baal',
      expiration: 0,
      revertOnFailure: true,
    }
  })

  describe('constructor', function () {
    it('verify deployment parameters', async function () {
      const decimals = await baal.decimals()
      expect(decimals).to.equal(18)

      const gracePeriod = await baal.gracePeriod()
      expect(gracePeriod).to.equal(deploymentConfig.GRACE_PERIOD_IN_SECONDS)

      const minVotingPeriod = await baal.minVotingPeriod()
      expect(minVotingPeriod).to.equal(deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS)

      const maxVotingPeriod = await baal.maxVotingPeriod()
      expect(maxVotingPeriod).to.equal(deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS)

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
      expect(shamans).to.be.true

      const guildTokens = await baal.getGuildTokens()
      expect(guildTokens[0]).to.equal(weth.address)

      const summonerData = await baal.members(summoner.address)
      expect(await lootToken.balanceOf(summoner.address)).to.equal(500)
      // expect(summonerData.highestIndexYesVote).to.equal(0)

      expect(await baal.balanceOf(summoner.address)).to.equal(100)

      const totalLoot = await baal.totalLoot()
      expect(totalLoot).to.equal(500)
    })
    it('hash operation behaves the same in JS and solidity', async function () {
      const jsHashed = hashOperation(proposal.data)
      const solHashed = await baal.hashOperation(proposal.data)
      console.log({ jsHashed, solHashed })
      expect(jsHashed).to.equal(solHashed)
    })
  })
})
