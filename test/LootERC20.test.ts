import { expect } from 'chai';
import { ethers, getChainId } from 'hardhat';

import signPermit from '../src/signPermit'
import { Loot, MockBaal } from '../src/types';
import { blockTime } from './utils/evm';
import { mockBaalSetup, Signer } from './utils/fixtures';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

const revertMessages = {
  lootAlreadyInitialized: 'Initializable: contract is already initialized',
  permitNotAuthorized: 'ERC20Permit: invalid signature',
  permitExpired: 'ERC20Permit: expired deadline',
  lootNotBaal: 'Ownable: caller is not the owner',
  notTransferable: 'loot: !transferable',
  transferToZero: 'ERC20: transfer to the zero address'
};

describe('Loot ERC20 contract', function () {
  let lootSingleton: Loot;
  let mockBaal: MockBaal;
  let lootToken: Loot;
  let chainId: number;

  let users: {
    [key: string]: Signer;
  };

  this.beforeAll(async function () {
    chainId = Number(await getChainId());
  });

  beforeEach(async function () {
    const { Loot, LootSingleton, MockBaal, signers } = await mockBaalSetup();
    lootSingleton = LootSingleton;
    lootToken = Loot;
    mockBaal = MockBaal;
    users = signers;
  });

  describe('constructor', async function () {
    it('creates an unusable template', async () => {
      expect(await lootSingleton.owner()).to.equal(ethers.constants.AddressZero);
    });

    it('require fail - initializer (setup) cant be called twice on loot', async () => {
      await expect(lootToken.setUp('NAME', 'SYMBOL'))
        .to.be.revertedWith(revertMessages.lootAlreadyInitialized);
    });

    it('require fail - initializer (setup) cant be called on singleton', async () => {
      await expect(lootSingleton.setUp('NAME', 'SYMBOL'))
        .to.be.revertedWith(revertMessages.lootAlreadyInitialized);
    });
  });

  describe('er20 loot - authorized minting, burning', async function () {
    it('happy case - allows baal to mint when loot not paused', async () => {
      expect(await mockBaal.lootPaused()).to.equal(false);
      expect(await lootToken.balanceOf(users.s2.address)).to.equal(0);
      await mockBaal.mintLoot(users.s2.address, 100);
      expect(await lootToken.balanceOf(users.s2.address)).to.equal(100);
    });

    it('happy case - allows baal to mint when loot paused', async () => {
      await mockBaal.setLootPaused(true);
      expect(await mockBaal.lootPaused()).to.equal(true);
      expect(await lootToken.balanceOf(users.s2.address)).to.equal(0);
      await mockBaal.mintLoot(users.s2.address, 100);
      expect(await lootToken.balanceOf(users.s2.address)).to.equal(100);
    });

    it('require fail - non baal tries to mint', async () => {
      await expect(users.s1.loot?.mint(users.s1.address, 100))
        .to.be.revertedWith(revertMessages.lootNotBaal);
    });

    it('happy case - allows baal to burn when loot not paused', async () => {
      expect(await mockBaal.lootPaused()).to.equal(false);
      expect(await lootToken.balanceOf(users.summoner.address)).to.equal(500);
      await mockBaal.burnLoot(users.summoner.address, 100);
      expect(await lootToken.balanceOf(users.summoner.address)).to.equal(400);
    });

    it('happy case - allows baal to burn when loot paused', async () => {
      await mockBaal.setLootPaused(true);
      expect(await mockBaal.lootPaused()).to.equal(true);
      expect(await lootToken.balanceOf(users.summoner.address)).to.equal(500);
      await mockBaal.burnLoot(users.summoner.address, 100);
      expect(await lootToken.balanceOf(users.summoner.address)).to.equal(400);
    });

    it('require fail - non baal tries to burn', async () => {
      await mockBaal.mintLoot(users.s2.address, 100);
      await expect(users.s1.loot?.burn(users.s2.address, 50))
        .to.be.revertedWith(revertMessages.lootNotBaal);
    });

    it('require fail - non baal tries to send to 0', async () => {
      await mockBaal.mintLoot(users.s2.address, 100);
      await expect(users.s1.loot?.transfer(ethers.constants.AddressZero, 50))
        .to.be.revertedWith(revertMessages.transferToZero);
    });
  });

  describe('er20 loot - restrict transfer', async function () {
    it('happy case - allows loot to be transferred when enabled', async () => {
      expect(await lootToken.balanceOf(users.summoner.address)).to.equal(500);
      expect(await lootToken.balanceOf(users.s1.address)).to.equal(0);
      expect(await mockBaal.lootPaused()).to.equal(false);
      await users.summoner.loot?.transfer(users.s1.address, 100);
      expect(await lootToken.balanceOf(users.summoner.address)).to.equal(400);
      expect(await lootToken.balanceOf(users.s1.address)).to.equal(100);
    });

    it('require fail - tries to transfer loot when paused', async () => {
      await mockBaal.setLootPaused(true);
      expect(await mockBaal.lootPaused()).to.equal(true);
      await expect(lootToken.transfer(users.s1.address, 100))
        .to.be.revertedWith(revertMessages.notTransferable);
    });

    it('happy case - allows loot to be transfered with approval when enabled', async () => {
      expect(await lootToken.balanceOf(users.summoner.address)).to.equal(500);
      expect(await lootToken.balanceOf(users.s1.address)).to.equal(0);
      expect(await mockBaal.lootPaused()).to.equal(false);
      await users.summoner.loot?.approve(users.s2.address, 100);
      await users.s2.loot?.transferFrom(users.summoner.address, users.s1.address, 100);
      expect(await lootToken.balanceOf(users.summoner.address)).to.equal(400);
      expect(await lootToken.balanceOf(users.s1.address)).to.equal(100);
    });

    it('require fail - tries to transfer with approval loot when paused', async () => {
      await mockBaal.setLootPaused(true);
      await users.summoner.loot?.approve(users.s2.address, 100);
      await expect(
          users.s2.loot?.transferFrom(
            users.summoner.address,
            users.s1.address,
            100
          )
      ).to.be.revertedWith(revertMessages.notTransferable);
    });

  })

  describe('erc20 loot - increase allowance with permit', function () {
    let signer: SignerWithAddress;

    this.beforeEach(async function () {
      signer = await ethers.getSigner(users.summoner.address);
    });

    it('happy case - increase allowance with valid permit', async () => {
      const deadline = (await blockTime()) + 10000;
      const nonce = await lootToken.nonces(users.summoner.address);
      const permitSignature = await signPermit(
        chainId, // chainId
        lootToken.address, // contractAddress
        signer, // signer
        await lootToken.name(), // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        users.summoner.address, // owner
        users.s1.address, // spender
        500, // value
        nonce, // nonce
        deadline, // deadline
      );

      const { v, r, s } = await ethers.utils.splitSignature(permitSignature);
      await lootToken.permit(users.summoner.address, users.s1.address, 500, deadline, v, r, s); //  owner, spender, value, deadline, v, r, s
      const s1Allowance = await lootToken.allowance(users.summoner.address, users.s1.address);
      expect(s1Allowance).to.equal(500);
    })

    it('Require fail -  invalid nonce', async () => {
      const deadline = (await blockTime()) + 10000
      const nonce = await lootToken.nonces(users.summoner.address)
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        signer,
        await lootToken.name(), // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        users.summoner.address,
        users.s1.address,
        500,
        nonce.add(1),
        deadline
      );

      const { v, r, s } = await ethers.utils.splitSignature(permitSignature);
      await expect(
        lootToken.permit(
          users.summoner.address,
          users.s1.address,
          500,
          deadline,
          v, r, s
        )
      ).to.be.revertedWith(revertMessages.permitNotAuthorized);
    })

    it('Require fail - invalid chain Id', async () => {
      const deadline = (await blockTime()) + 10000;
      const nonce = await lootToken.nonces(users.summoner.address);
      const permitSignature = await signPermit(
        420,
        lootToken.address,
        signer,
        await lootToken.name(), // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        users.summoner.address,
        users.s1.address,
        500,
        nonce,
        deadline
      );

      const {v,r,s} = await ethers.utils.splitSignature(permitSignature);
      await expect(
        lootToken.permit(
          users.summoner.address,
          users.s1.address,
          500,
          deadline,
          v, r, s
        )
      ).to.be.revertedWith(revertMessages.permitNotAuthorized);
    })

    it('Require fail - invalid name', async () => {
      const deadline = (await blockTime()) + 10000;
      const nonce = await lootToken.nonces(users.summoner.address);
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        signer,
        'invalid',
        users.summoner.address,
        users.s1.address,
        500,
        nonce,
        deadline
      );
      const { v, r, s } = await ethers.utils.splitSignature(permitSignature);
      await expect(
        lootToken.permit(
          users.summoner.address,
          users.s1.address,
          500,
          deadline,
          v, r, s
        )
      ).to.be.revertedWith(revertMessages.permitNotAuthorized);
    });

    it('Require fail - invalid address', async () => {
      const deadline = (await blockTime()) + 10000;
      const nonce = await lootToken.nonces(users.summoner.address)
      const permitSignature = await signPermit(
        chainId,
        ethers.constants.AddressZero,
        signer,
        await lootToken.name(), // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        users.summoner.address,
        users.s1.address,
        500,
        nonce,
        deadline
      );

      const { v, r, s } = await ethers.utils.splitSignature(permitSignature);
      await expect(
        lootToken.permit(
          users.summoner.address,
          users.s1.address,
          500,
          deadline,
          v, r, s
        )
      ).to.be.revertedWith(revertMessages.permitNotAuthorized);
    });

    it('Require fail - invalid owner', async () => {
      const deadline = (await blockTime()) + 10000;
      const nonce = await lootToken.nonces(users.summoner.address);
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        signer,
        await lootToken.name(), // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        users.s1.address,
        users.s1.address,
        500,
        nonce,
        deadline
      );

      const { v, r, s } = await ethers.utils.splitSignature(permitSignature);
      await expect(
        lootToken.permit(
          users.summoner.address,
          users.s1.address,
          500,
          deadline,
          v, r, s
        )
      ).to.be.revertedWith(revertMessages.permitNotAuthorized);
    })

    it('Require fail - invalid spender', async () => {
      const deadline = (await blockTime()) + 10000;
      const nonce = await lootToken.nonces(users.summoner.address);
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        signer,
        await lootToken.name(), // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        users.summoner.address,
        users.s2.address,
        500,
        nonce,
        deadline
      );

      const { v, r, s } = await ethers.utils.splitSignature(permitSignature);
      await expect(
        lootToken.permit(
          users.summoner.address,
          users.s1.address,
          500,
          deadline,
          v, r, s
        )
      ).to.be.revertedWith(revertMessages.permitNotAuthorized);
    });

    it('Require fail - invalid amount', async () => {
      const deadline = (await blockTime()) + 10000;
      const nonce = await lootToken.nonces(users.summoner.address);
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        signer,
        await lootToken.name(), // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        users.summoner.address,
        users.s1.address,
        499,
        nonce,
        deadline
      );

      const { v, r, s } = await ethers.utils.splitSignature(permitSignature);
      await expect(
        lootToken.permit(
          users.summoner.address,
          users.s1.address,
          500,
          deadline,
          v, r, s
        )
      ).to.be.revertedWith(revertMessages.permitNotAuthorized);
    });

    it('Require fail - invalid deadline', async () => {
      const deadline = (await blockTime()) + 10000;
      const nonce = await lootToken.nonces(users.summoner.address)
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        signer,
        await lootToken.name(), // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        users.summoner.address,
        users.s1.address,
        500,
        nonce,
        deadline - 1
      );

      const { v, r, s } = await ethers.utils.splitSignature(permitSignature);
      await expect(
        lootToken.permit(
          users.summoner.address,
          users.s1.address,
          500,
          deadline,
          v, r, s
        )
      ).to.be.revertedWith(revertMessages.permitNotAuthorized);
    });

    it('Require fail - expired deadline', async () => {
      const deadline = (await blockTime()) - 1;
      const nonce = await lootToken.nonces(users.summoner.address);
      const permitSignature = await signPermit(
        chainId,
        lootToken.address,
        signer,
        await lootToken.name(), // name -- replacing await lootToken.name()  with 'Loot' for new signing scope
        users.summoner.address,
        users.s1.address,
        500,
        nonce,
        deadline
      );

      const { v, r, s } = await ethers.utils.splitSignature(permitSignature);
      await expect(
        lootToken.permit(
          users.summoner.address,
          users.s1.address,
          500,
          deadline,
          v, r, s
        )
      ).to.be.revertedWith(revertMessages.permitExpired);
    });
  });
});
