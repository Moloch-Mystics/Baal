const { ethers } = require('hardhat');
const chai = require('chai');
const { expect } = chai;

chai
  .use(require('chai-as-promised'))
  .should();

const revertMessages =  {
  molochConstructorMinionCannotBe0: 'minion cannot be 0',
  molochConstructorGuildTokenCannotBe0: 'guildToken cannot be 0',
  molochConstructorSummonerCannotBe0: 'summoner cannot be 0',
  molochConstructorSharesCannotBe0: 'shares cannot be 0',
  molochConstructorMinVotingPeriodCannotBe0: 'minVotingPeriod cannot be 0',
  molochConstructorMaxVotingPeriodCannotBe0: 'maxVotingPeriod cannot be 0',
  submitProposalVotingPeriod: '!votingPeriod',
  submitProposalArrays: '!arrays',
  submitProposalArrayMax: 'array max',
  submitProposalFlag: '!flag',
  submitVoteTimeEnded: 'ended',
  submitVoteAlreadyVoted: 'voted'
}

const zeroAddress = '0x0000000000000000000000000000000000000000';

async function blockTime() {
  const block = await ethers.provider.getBlock('latest');
  return block.timestamp;
}

async function moveForwardPeriods(periods) {
  const goToTime = deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS * periods;
  await ethers.provider.send('evm_increaseTime', [goToTime]);
  return true;
}

const deploymentConfig = {
  'MIN_VOTING_PERIOD_IN_SECONDS': 172800,
  'MAX_VOTING_PERIOD_IN_SECONDS': 432000,
  'TOKEN_NAME': 'wrapped ETH',
  'TOKEN_SYMBOL': 'WETH',
}

describe('Baal contract', function () {

  let baal;
  let minion;
  let applicant;
  let guildToken;
  let summoner;
  
  let proposal;

  const loot = 500;
  const shares = 100;
  const lootPaused = false;
  const sharesPaused = false;

  const yes = 1;
  const no = 2;

  beforeEach(async function () {
    const BaalContract = await ethers.getContractFactory('Baal');
    [minion, guildToken, summoner, applicant] = await ethers.getSigners();
    
    baal = await BaalContract.deploy(
      [minion.address],
      [guildToken.address],
      [summoner.address],
      [loot],
      [shares],
      deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS,
      deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS,
      deploymentConfig.TOKEN_NAME,
      deploymentConfig.TOKEN_SYMBOL,
      lootPaused,
      sharesPaused
    );

    proposal = {
      account: minion.address,
      value: 50,
      votingPeriod: 175000,
      flag: 0,
      data: 10,
      details: 'all hail baal'
    }
  });

  describe('constructor', function () {
    it('verify deployment parameters', async function () {
      const now = await blockTime();

      const decimals = await baal.decimals();
      expect(decimals).to.equal(18);
      
      const minVotingPeriod = await baal.minVotingPeriod();
      expect(minVotingPeriod).to.equal(deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS);

      const maxVotingPeriod = await baal.maxVotingPeriod();
      expect(maxVotingPeriod).to.equal(deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS);

      const name = await baal.name();
      expect(name).to.equal(deploymentConfig.TOKEN_NAME);

      const symbol = await baal.symbol();
      expect(symbol).to.equal(deploymentConfig.TOKEN_SYMBOL);

      const lootPaused = await baal.lootPaused();
      expect(lootPaused).to.be.false;
  
      const sharesPaused = await baal.sharesPaused();
      expect(sharesPaused).to.be.false;

      const minions = await baal.minions(minion.address);
      expect(minions).to.be.true;

      const guildTokens = await baal.getGuildTokens();
      expect(guildTokens[0]).to.equal(guildToken.address);

      const memberList = await baal.getMemberList();
      expect(memberList[0]).to.equal(summoner.address);

      const summonerData = await baal.members(summoner.address);
      expect(summonerData.loot).to.equal(500);
      expect(summonerData.highestIndexYesVote).to.equal(0);

      const totalLoot = await baal.totalLoot();
      expect(totalLoot).to.equal(500);
    });
  });

  describe('memberAction', function () {

  });
  
  describe('submitProposal', function () {
    it('happy case', async function () {
      const countBefore = await baal.proposalCount();

      await baal.submitProposal(
        [proposal.account], 
        [proposal.value],
        proposal.votingPeriod,
        proposal.flag,
        [proposal.data],
        ethers.utils.id(proposal.details)
      );

      const countAfter = await baal.proposalCount();
      expect(countAfter).to.equal(countBefore.add(1));
    });

    it('require fail - voting period too low', async function() { 
      await baal.submitProposal(
        [proposal.account], 
        [proposal.value],
        deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS - 100,
        proposal.flag,
        [proposal.data],
        ethers.utils.id(proposal.details)
      ).should.be.rejectedWith(revertMessages.submitProposalVotingPeriod);
    });

    it('require fail - voting period too high', async function() { 
      await baal.submitProposal(
        [proposal.account], 
        [proposal.value],
        deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS + 100,
        proposal.flag,
        [proposal.data],
        ethers.utils.id(proposal.details)
      ).should.be.rejectedWith(revertMessages.submitProposalVotingPeriod);
    });

    it('require fail - to array does not match', async function() { 
      await baal.submitProposal(
        [proposal.account, summoner.address], 
        [proposal.value],
        proposal.votingPeriod,
        proposal.flag,
        [proposal.data],
        ethers.utils.id(proposal.details)
      ).should.be.rejectedWith(revertMessages.submitProposalArray);
    });

    it('require fail - value array does not match', async function() { 
      await baal.submitProposal(
        [proposal.account], 
        [proposal.value, 20],
        proposal.votingPeriod,
        proposal.flag,
        [proposal.data],
        ethers.utils.id(proposal.details)
      ).should.be.rejectedWith(revertMessages.submitProposalArray);
    });

    it('require fail - data array does not match', async function() { 
      await baal.submitProposal(
        [proposal.account], 
        [proposal.value],
        proposal.votingPeriod,
        proposal.flag,
        [proposal.data, 15],
        ethers.utils.id(proposal.details)
      ).should.be.rejectedWith(revertMessages.submitProposalArray);
    });

    it('require fail - flag is out of bounds', async function() { 
      await baal.submitProposal(
        [proposal.account], 
        [proposal.value],
        proposal.votingPeriod,
        6,
        [proposal.data],
        ethers.utils.id(proposal.details)
      ).should.be.rejectedWith(revertMessages.submitProposalFlag);
    });
  });

  describe('submitVote', function () {
    beforeEach(async function () {
      await baal.submitProposal(
        [proposal.account], 
        [proposal.value],
        proposal.votingPeriod,
        proposal.flag,
        [proposal.data],
        ethers.utils.id(proposal.details)
      );
    });

    it('happy case - yes vote', async function() {
      await baal.submitVote(1, yes);
      const vote = await baal.getProposalVotes(proposal.account, 1);
      expect(vote).equal(yes);
    });

    it('happy case - no vote', async function() {
      await baal.submitVote(1, no);
      const vote = await baal.getProposalVotes(proposal.account, 1);
      expect(vote).to.equal(no);
    });

    it('require fail - voting period has ended', async function() {
      await moveForwardPeriods(2);
      await baal.submitVote(1, no)
        .should.be.rejectedWith(revertMessages.submitVoteTimeEnded);
    });

    it('require fail - caller has already voted', async function() {
      await baal.submitVote(1, yes); 
      await baal.submitVote(1, no)
        .should.be.rejectedWith(revertMessages.submitVoteAlreadyVoted);
    });
  });

  describe('processProposal', function () {
    it('happy case - flag[0] - yes wins', async function () {
      await baal.submitProposal(
        [proposal.account], 
        [proposal.value],
        proposal.votingPeriod,
        proposal.flag,
        [proposal.data],
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      await baal.processProposal(1, [proposal.account], [proposal.value], [proposal.data]);
    });

    it('happy case - flag[1] - yes wins', async function () {
      await baal.submitProposal(
        [proposal.account], 
        [proposal.value],
        proposal.votingPeriod,
        proposal.flag + 1,
        [proposal.data],
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, yes);
      await moveForwardPeriods(2);
      await baal.processProposal(1, [proposal.account], [proposal.value], [proposal.data]);
    });

    it('happy case - flag[0] - no wins', async function () {
      await baal.submitProposal(
        [proposal.account], 
        [proposal.value],
        proposal.votingPeriod,
        proposal.flag,
        [proposal.data],
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, no);
      await moveForwardPeriods(2);
      await baal.processProposal(1, [proposal.account], [proposal.value], [proposal.data]);
    });

    it('happy case - flag[1] - no wins', async function () {
      await baal.submitProposal(
        [proposal.account], 
        [proposal.value],
        proposal.votingPeriod,
        proposal.flag + 1,
        [proposal.data],
        ethers.utils.id(proposal.details)
      );
      await baal.submitVote(1, no);
      await moveForwardPeriods(2);
      await baal.processProposal(1, [proposal.account], [proposal.value], [proposal.data]);
    });
  });
});
