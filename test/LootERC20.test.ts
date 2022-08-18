import { ethers } from 'hardhat'
import { solidity } from 'ethereum-waffle'
import { use, expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import { Loot, MockBaal } from '../src/types'
import { ContractFactory } from 'ethers'
import signPermit from '../src/signPermit'

use(solidity)

// chai
//   .use(require('chai-as-promised'))
//   .should();

const revertMessages = {
  lootAlreadyInitialized: 'Initializable: contract is already initialized',
  permitNotAuthorized: 'ERC20Permit: invalid signature',
  permitExpired: 'expired',
  lootNotBaal: '!auth',
  notTransferable: '!transferable',
  transferToZero: 'ERC20: transfer to the zero address'
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

describe('Loot ERC20 contract', async function () {
  let lootSingleton: Loot
  let LootFactory: ContractFactory
  let MockBaalFactory: ContractFactory

  let mockBaal: MockBaal

  let lootToken: Loot
  let baalLootToken: Loot

  let summoner: SignerWithAddress
  let member: SignerWithAddress
  let chainId: number

  let s1: SignerWithAddress
  let s2: SignerWithAddress

  let s1Loot: Loot
  let s2Loot: Loot

  this.beforeAll(async function () {
    LootFactory = await ethers.getContractFactory('Loot')
    lootSingleton = (await LootFactory.deploy()) as Loot
    MockBaalFactory = await ethers.getContractFactory('MockBaal')
    const network = await ethers.provider.getNetwork()
    chainId = network.chainId
  })

  beforeEach(async function () {
    ;[summoner, member, s1, s2] = await ethers.getSigners()
    mockBaal = (await MockBaalFactory.deploy(lootSingleton.address, 'NAME', 'SYMBOL')) as MockBaal
    const lootTokenAddress = await mockBaal.lootToken()
    lootToken = LootFactory.attach(lootTokenAddress) as Loot
    s1Loot = lootToken.connect(s1)
    s2Loot = lootToken.connect(s2)
    await mockBaal.mintLoot(summoner.address, 500)
  })

  describe('constructor', async function () {
    it('creates an unusable template', async function () {
      expect(await lootSingleton.baal()).to.equal(zeroAddress)
    })

    it('require fail - initializer (setup) cant be called twice on loot', async function () {
      expect(lootToken.setUp('NAME', 'SYMBOL')).to.be.revertedWith(revertMessages.lootAlreadyInitialized)
    })

    it('require fail - initializer (setup) cant be called on singleton', async function () {
      expect(lootSingleton.setUp('NAME', 'SYMBOL')).to.be.revertedWith(revertMessages.lootAlreadyInitialized)
    })
  })

  describe('er20 loot - authorized minting, burning', async function () {
    it('happy case - allows baal to mint when loot not paused', async function () {
      expect(await mockBaal.lootPaused()).to.equal(false)
      expect(await lootToken.balanceOf(s2.address)).to.equal(0)
      await mockBaal.mintLoot(s2.address, 100)
      expect(await lootToken.balanceOf(s2.address)).to.equal(100)
    })

    it('happy case - allows baal to mint when loot paused', async function () {
      await mockBaal.setLootPaused(true)
      expect(await mockBaal.lootPaused()).to.equal(true)
      expect(await lootToken.balanceOf(s2.address)).to.equal(0)
      await mockBaal.mintLoot(s2.address, 100)
      expect(await lootToken.balanceOf(s2.address)).to.equal(100)
    })

    it('require fail - non baal tries to mint', async function () {
      expect(s1Loot.mint(s1.address, 100)).to.be.revertedWith(revertMessages.lootNotBaal)
    })

    it('happy case - allows baal to burn when loot not paused', async function () {
      expect(await mockBaal.lootPaused()).to.equal(false)
      expect(await lootToken.balanceOf(summoner.address)).to.equal(500)
      await mockBaal.burnLoot(summoner.address, 100)
      expect(await lootToken.balanceOf(summoner.address)).to.equal(400)
    })

    it('happy case - allows baal to burn when loot paused', async function () {
      await mockBaal.setLootPaused(true)
      expect(await mockBaal.lootPaused()).to.equal(true)
      expect(await lootToken.balanceOf(summoner.address)).to.equal(500)
      await mockBaal.burnLoot(summoner.address, 100)
      expect(await lootToken.balanceOf(summoner.address)).to.equal(400)
    })

    it('require fail - non baal tries to burn', async function () {
      await mockBaal.mintLoot(s2.address, 100)
      expect(s1Loot.burn(s2.address, 50)).to.be.revertedWith(revertMessages.lootNotBaal)
    })

    it('require fail - non baal tries to send to 0', async function () {
      await mockBaal.mintLoot(s2.address, 100)
      expect(s1Loot.transfer(zeroAddress, 50)).to.be.revertedWith(revertMessages.transferToZero)
    })
  })

  describe('er20 loot - restrict transfer', async function () {
    it('happy case - allows loot to be transferred when enabled', async function () {
      expect(await lootToken.balanceOf(summoner.address)).to.equal(500)
      expect(await lootToken.balanceOf(s1.address)).to.equal(0)
      expect(await mockBaal.lootPaused()).to.equal(false)
      await lootToken.transfer(s1.address, 100)
      expect(await lootToken.balanceOf(summoner.address)).to.equal(400)
      expect(await lootToken.balanceOf(s1.address)).to.equal(100)
    })

    it('require fail - tries to transfer loot when paused', async function () {
      await mockBaal.setLootPaused(true)
      expect(await mockBaal.lootPaused()).to.equal(true)
      expect(lootToken.transfer(s1.address, 100)).to.be.revertedWith(revertMessages.notTransferable)
    })

    it('happy case - allows loot to be transfered with approval when enabled', async function () {
      expect(await lootToken.balanceOf(summoner.address)).to.equal(500)
      expect(await lootToken.balanceOf(s1.address)).to.equal(0)
      expect(await mockBaal.lootPaused()).to.equal(false)
      await lootToken.approve(s2.address, 100)
      await s2Loot.transferFrom(summoner.address, s1.address, 100)
      expect(await lootToken.balanceOf(summoner.address)).to.equal(400)
      expect(await lootToken.balanceOf(s1.address)).to.equal(100)
    })

    it('require fail - tries to transfer with approval loot when paused', async function () {
      await mockBaal.setLootPaused(true)
      await lootToken.approve(s2.address, 100)
      expect(s2Loot.transferFrom(summoner.address, s1.address, 100)).to.be.revertedWith(revertMessages.notTransferable)
    })

  })

  describe('erc20 loot - increase allowance with permit', async function () {
    it('happy case - increase allowance with valid permit', async function () {
      const deadline = (await blockTime()) + 10000
      const nonce = await lootToken.nonces(summoner.address)
      const permitSignature = await signPermit(
        chainId, // chainId
        lootToken.address, // contractAddress
        summoner, // signer
        'Loot', // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        summoner.address, // owner
        s1.address, // spender
        500, // value
        nonce, // nonce
        deadline, // deadline
      )

      const {v,r,s} = await ethers.utils.splitSignature(permitSignature)
      await lootToken.permit(summoner.address, s1.address, 500, deadline, v, r, s) //  owner, spender, value, deadline, v, r, s
      const s1Allowance = await lootToken.allowance(summoner.address, s1.address)
      console.log(s1Allowance)
      expect(s1Allowance).to.equal(500)
    })

    it('Require fail -  invalid nonce', async function () {
      const deadline = (await blockTime()) + 10000
      const nonce = await lootToken.nonces(summoner.address)
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        summoner,
        'Loot', // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        summoner.address,
        s1.address,
        500,
        nonce.add(1),
        deadline
      )

      const {v,r,s} = await ethers.utils.splitSignature(permitSignature)
      expect(lootToken.permit(summoner.address, s1.address, 500, deadline, v, r, s)).to.be.revertedWith(revertMessages.permitNotAuthorized)
    })

    it('Require fail - invalid chain Id', async function () {
      const deadline = (await blockTime()) + 10000
      const nonce = await lootToken.nonces(summoner.address)
      const permitSignature = await signPermit(
        420,
        lootToken.address,
        summoner,
        'Loot', // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        summoner.address,
        s1.address,
        500,
        nonce,
        deadline
      )

      const {v,r,s} = await ethers.utils.splitSignature(permitSignature)
      expect(lootToken.permit(summoner.address, s1.address, 500, deadline, v, r, s)).to.be.revertedWith(revertMessages.permitNotAuthorized)
    })

    it('Require fail - invalid name', async function () {
      const deadline = (await blockTime()) + 10000
      const nonce = await lootToken.nonces(summoner.address)
      const permitSignature = await signPermit(chainId, lootToken.address, summoner, 'invalid', summoner.address, s1.address, 500, nonce, deadline)
      const {v,r,s} = await ethers.utils.splitSignature(permitSignature)
      expect(lootToken.permit(summoner.address, s1.address, 500, deadline, v, r, s)).to.be.revertedWith(revertMessages.permitNotAuthorized)
    })

    it('Require fail - invalid address', async function () {
      const deadline = (await blockTime()) + 10000
      const nonce = await lootToken.nonces(summoner.address)
      const permitSignature = await signPermit(
        chainId,
        zeroAddress,
        summoner,
        'Loot', // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        summoner.address,
        s1.address,
        500,
        nonce,
        deadline
      )

      const {v,r,s} = await ethers.utils.splitSignature(permitSignature)
      expect(lootToken.permit(summoner.address, s1.address, 500, deadline, v, r, s)).to.be.revertedWith(revertMessages.permitNotAuthorized)
    })

    it('Require fail - invalid owner', async function () {
      const deadline = (await blockTime()) + 10000
      const nonce = await lootToken.nonces(summoner.address)
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        summoner,
        'Loot', // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        s1.address,
        s1.address,
        500,
        nonce,
        deadline
      )

      const {v,r,s} = await ethers.utils.splitSignature(permitSignature)
      expect(lootToken.permit(summoner.address, s1.address, 500, deadline, v, r, s)).to.be.revertedWith(revertMessages.permitNotAuthorized)
    })

    it('Require fail - invalid spender', async function () {
      const deadline = (await blockTime()) + 10000
      const nonce = await lootToken.nonces(summoner.address)
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        summoner,
        'Loot', // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        summoner.address,
        s2.address,
        500,
        nonce,
        deadline
      )

      const {v,r,s} = await ethers.utils.splitSignature(permitSignature)
      expect(lootToken.permit(summoner.address, s1.address, 500, deadline, v, r, s)).to.be.revertedWith(revertMessages.permitNotAuthorized)
    })

    it('Require fail - invalid amount', async function () {
      const deadline = (await blockTime()) + 10000
      const nonce = await lootToken.nonces(summoner.address)
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        summoner,
        'Loot', // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        summoner.address,
        s1.address,
        499,
        nonce,
        deadline
      )

      const {v,r,s} = await ethers.utils.splitSignature(permitSignature)
      expect(lootToken.permit(summoner.address, s1.address, 500, deadline, v, r, s)).to.be.revertedWith(revertMessages.permitNotAuthorized)
    })

    it('Require fail - invalid deadline', async function () {
      const deadline = (await blockTime()) + 10000
      const nonce = await lootToken.nonces(summoner.address)
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        summoner,
        'Loot', // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        summoner.address,
        s1.address,
        500,
        nonce,
        deadline - 1
      )

      const {v,r,s} = await ethers.utils.splitSignature(permitSignature)
      expect(lootToken.permit(summoner.address, s1.address, 500, deadline, v, r, s)).to.be.revertedWith(revertMessages.permitNotAuthorized)
    })

    it('Require fail - expired deadline', async function () {
      const deadline = (await blockTime()) - 1
      const nonce = await lootToken.nonces(summoner.address)
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        summoner,
        'Loot', // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        summoner.address,
        s1.address,
        500,
        nonce,
        deadline
      )

      const {v,r,s} = await ethers.utils.splitSignature(permitSignature)
      expect(lootToken.permit(summoner.address, s1.address, 500, deadline, v, r, s)).to.be.revertedWith(revertMessages.permitExpired)
    })
  })
})
