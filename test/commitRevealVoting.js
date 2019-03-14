const TestCommitRevealVoting = artifacts.require('./TestCommitRevealVoting.sol');
const RBAC = artifacts.require('./test-contracts/TestRBAC.sol');
const utils = require('./utils.js')
const web3Utils = require('web3-utils')
const { promisify } = require('util');

contract('TestCommitRevealVoting', function (accounts) {
  assert.isAtLeast(accounts.length, 4)
  let [admin, voter1, voter2, voter3] = accounts
  let crv;
  let rbac;
  let defaultSalt = '666';
  let counter = 0

  function getNewPollID() {
    counter = counter + 1
    return web3Utils.soliditySha3('testPoll' + counter)
  }

  before(async function () {
    crv = await TestCommitRevealVoting.deployed()
    rbac = await RBAC.deployed()
    let promises = accounts.map((account) => rbac.makeVoter(account))
    promises.push(rbac.makeAdmin(accounts[0]))
    await Promise.all(promises)
  })


  it('creates a poll', async function () {
    let pollID = getNewPollID()

    let pollExists = await crv.pollExists(pollID)
    assert.equal(pollExists, false, 'poll does not exist before creation')

    await crv.startPoll(pollID, 24*60*60, 5*60*60)
    pollExists = await crv.pollExists(pollID)
    assert.equal(pollExists, true, 'poll exists after creation')

    let pollEnded = await crv.pollEnded.call(pollID)
    assert.equal(pollEnded, false, 'poll should be open')

    let voteCounts = await crv.getVoteCounts.call(pollID)
    expect(voteCounts.numForVotes.toNumber()).to.equal(0)
    expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
    expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(0)


    let commitPeriodActive = await crv.commitPeriodActive.call(pollID)
    assert.equal(commitPeriodActive, true, 'poll should be in the commit period')

    let revealPeriodActive = await crv.revealPeriodActive.call(pollID)
    assert.equal(revealPeriodActive, false, 'poll should not be in the reveal period')
  })

  describe('when a poll exists', function() {

    let pollID

    beforeEach(async function () {
      pollID = getNewPollID()
      await crv.startPoll(pollID, 24*60*60, 5*60*60)
    })

    it('allows you to commit a vote', async function() {
      let didCommit = await crv.didCommit.call(pollID, admin)
      assert.equal(didCommit, false, 'user has not yet committed')

      let getVoteRes = await crv.getVote.call(pollID, admin)
      assert.equal(getVoteRes[0], false, 'not committed')
      assert.equal(getVoteRes[1], false, 'not yet revealed')

      let secretVote = utils.createVoteHash('0', defaultSalt)
      await crv.commitVote(pollID, secretVote)

      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.numForVotes.toNumber()).to.equal(0)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)


      didCommit = await crv.didCommit.call(pollID, admin)
      assert.equal(didCommit, true, 'user has committed')

      getVoteRes = await crv.getVote.call(pollID, admin)
      assert.equal(getVoteRes[0], true, 'committed')
      assert.equal(getVoteRes[1], false, 'still not revealed')
    })


    describe('when the poll has committed votes', function() {

      beforeEach(async function () {
        pollID = getNewPollID()
        await crv.startPoll(pollID, 24*60*60, 5*60*60)
  
        let secretVote = utils.createVoteHash('0', defaultSalt)
        await crv.commitVote(pollID, secretVote)
  
        secretVote = utils.createVoteHash('1', defaultSalt)
        await crv.commitVote(pollID, secretVote, { from: voter1 })
      })
  
      it('forbids vote revelation during the commit phase', async function() {
        let voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
  
        await utils.assertRevert(crv.revealVote(pollID, admin, 0, defaultSalt, { from: voter2 }))
  
        voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
      })
  
      it('forbids further commits after commit phase expires', async function() {
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})
  
        let secretVote = utils.createVoteHash('0', defaultSalt)
        await utils.assertRevert(crv.commitVote(pollID, secretVote, { from: voter2 }))
  
        voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
      })
  
      it('forbids further commits after commit phase is halted', async function() {
        await crv.haltCommitPeriod(pollID)
  
        let secretVote = utils.createVoteHash('0', defaultSalt)
        await utils.assertRevert(crv.commitVote(pollID, secretVote, { from: voter2 }))
  
        voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
      })
  
      it('allows you to reveal your own after commit phase expires', async function() {
        let voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)

        let secretVote = utils.createVoteHash('1', defaultSalt)
        await crv.commitVote(pollID, secretVote, { from: voter1 })

        let revealPeriodActive = await crv.revealPeriodActive.call(pollID)
        assert.equal(revealPeriodActive, false, 'poll should not be in the reveal period yet')
        let commitPeriodActive = await crv.commitPeriodActive.call(pollID)
        assert.equal(commitPeriodActive, true, 'poll should be in the commit period')
  
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})
  
        revealPeriodActive = await crv.revealPeriodActive.call(pollID)
        assert.equal(revealPeriodActive, true, 'poll should enter the reveal period after 25 hours')
        commitPeriodActive = await crv.commitPeriodActive.call(pollID)
        assert.equal(commitPeriodActive, false, 'poll should no longer be in the commit period')
  
        voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
  
        await crv.revealMyVote(pollID, '1', defaultSalt, { from: voter1 })
  
        voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(1)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)
  
        let didReveal = await crv.didReveal.call(pollID, voter1)
        assert.equal(didReveal, true, 'user should be able to reveal a vote')
  
        let {hasVoted, hasRevealed, vote} = await crv.getVote.call(pollID, voter1)
        assert.equal(hasVoted, true, '\'user committed\' tracked as expected')
        assert.equal(hasRevealed, true, '\'user revealed\' tracked as expected')
        assert.equal(vote.toNumber(), 1, '\'user voted for\' tracked as expected')
      })
  
      it('allows you to reveal your own after commit phase is halted', async function() {
        let voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
  
        let secretVote = utils.createVoteHash('1', defaultSalt)
        await crv.commitVote(pollID, secretVote, { from: voter1 })
  
        let revealPeriodActive = await crv.revealPeriodActive.call(pollID)
        assert.equal(revealPeriodActive, false, 'poll should not be in the reveal period yet')
        let commitPeriodActive = await crv.commitPeriodActive.call(pollID)
        assert.equal(commitPeriodActive, true, 'poll should be in the commit period')
  
        await crv.haltCommitPeriod(pollID)
  
        revealPeriodActive = await crv.revealPeriodActive.call(pollID)
        assert.equal(revealPeriodActive, true, 'poll should enter the reveal period after 25 hours')
        commitPeriodActive = await crv.commitPeriodActive.call(pollID)
        assert.equal(commitPeriodActive, false, 'poll should no longer be in the commit period')
  
        voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
  
        await crv.revealMyVote(pollID, '1', defaultSalt, { from: voter1 })
  
        voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(1)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)
  
        let didReveal = await crv.didReveal.call(pollID, voter1)
        assert.equal(didReveal, true, 'user should be able to reveal a vote')
  
        let { vote } = await crv.getVote.call(pollID, voter1)
        assert.equal(vote.toNumber(), 1, '\'user voted for\' tracked as expected')
      })
  
      it('allows anyone to reveal someone else\'s vote after commit phase expires', async function() {
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})
  
        let voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
  
        let didReveal = await crv.didReveal.call(pollID, admin)
        assert.equal(didReveal, false, 'admin\'s vote was not revealed yet')
  
        await crv.revealVote(pollID, admin, 0, defaultSalt, { from: voter1 })
  
        voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(1)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)
  
        didReveal = await crv.didReveal.call(pollID, admin)
        assert.equal(didReveal, true, 'admin\'s vote was revealed')
  
        let { vote } = await crv.getVote.call(pollID, admin)
        assert.equal(vote.toNumber(), 0, '\'user voted against\' tracked as expected')
      })
  
      it('allows anyone to reveal someone else\'s vote after commit phase is halted', async function() {
        await crv.haltCommitPeriod(pollID)
  
        let voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
  
        let didReveal = await crv.didReveal.call(pollID, admin)
        assert.equal(didReveal, false, 'admin\'s vote was not revealed yet')
  
        await crv.revealVote(pollID, admin, 0, defaultSalt, { from: voter1 })
  
        voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(1)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)
  
        didReveal = await crv.didReveal.call(pollID, admin)
        assert.equal(didReveal, true, 'admin\'s vote was revealed')
  
        let { vote } = await crv.getVote.call(pollID, admin)
        assert.equal(vote.toNumber(), 0, '\'user voted against\' tracked as expected')
      })
  
      it('rejects a reveal if the wrong vote or salt is provided', async function() {
        await crv.haltCommitPeriod(pollID)
  
        await utils.assertRevert(crv.revealVote(pollID, admin, 1, defaultSalt, { from: voter1 }))
        await utils.assertRevert(crv.revealVote(pollID, admin, 0, defaultSalt + 1, { from: voter1 }))
        await crv.revealVote(pollID, admin, 0, defaultSalt, { from: voter1 })
  
        voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(0)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(1)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)
  
        let didReveal = await crv.didReveal.call(pollID, admin)
        assert.equal(didReveal, true, 'admin\'s vote was revealed')
  
        let { vote } = await crv.getVote.call(pollID, admin)
        assert.equal(vote.toNumber(), 0, '\'user voted against\' tracked as expected')
      })
      
    })
  
    describe('when the poll has revealed votes', function() {
      beforeEach(async function () {
        pollID = getNewPollID()
        await crv.startPoll(pollID, 24*60*60, 5*60*60)
  
        // Revealed No vote from admin
        let secretVoteNo = utils.createVoteHash('0', defaultSalt + 1)
        await crv.commitVote(pollID, secretVoteNo)
        let voters = await crv.getVoters(pollID)
        expect(voters).to.deep.equal([admin])
  
        // Revealed Yes votes from voters  1 and 2
        secretVoteYes = utils.createVoteHash('1', defaultSalt)
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
  
        // Unrevealed vote from voter3
        await crv.commitVote(pollID, secretVoteNo, { from: voter3 })
  
        voters = await crv.getVoters(pollID)
        expect(voters).to.deep.equal([admin, voter1, voter2, voter3])
  
        await crv.haltCommitPeriod(pollID)
  
        let pollEnded = await crv.pollEnded(pollID)
        assert.equal(pollEnded, false, 'Poll has not ended yet')
  
        await crv.revealVote(pollID, admin, 0, defaultSalt + 1, { from: voter3 })
        await crv.revealMyVote(pollID, 1, defaultSalt, { from: voter1 })
        await crv.revealVote(pollID, voter2, 1, defaultSalt, { from: voter3 })
  
        voters = await crv.getVoters(pollID)
        expect(voters).to.deep.equal([admin, voter1, voter2, voter3])
  
        pollEnded = await crv.pollEnded(pollID)
        assert.equal(pollEnded, false, 'Poll has not ended yet')
      })
  
      it('returns the expected vote results', async function() {
        let votePromises = [admin, voter1, voter2].map(acc => crv.getVote.call(pollID, acc))
        let votes = await Promise.all(votePromises)
        expect(votes.map(e => e.vote.toNumber())).to.deep.equal([0,1,1])
      })
      
      it('returns the expected vote counts', async function() {
        let voteCounts = await crv.getVoteCounts.call(pollID)
        expect(voteCounts.numForVotes.toNumber()).to.equal(2)
        expect(voteCounts.numAgainstVotes.toNumber()).to.equal(1)
        expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)
  
        await crv.haltRevealPeriod(pollID)
        pollEnded = await crv.pollEnded(pollID)
        assert.equal(pollEnded, true, 'Poll has ended now')
      })
    })
  
    describe('when the poll has commit duration = 0', function() {
      let secretVoteYes = utils.createVoteHash('1', defaultSalt)
      let secretVoteNo = utils.createVoteHash('0', defaultSalt)
      let result
  
      beforeEach(async function () {
        pollID = getNewPollID()
        await crv.startPoll(pollID, 0, 5*60*60)
      })
  
      it('tracks the commit phase properly initially', async function() {
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, true)
      })
      
  
      it('maintains commit phase after votes & elapsed time', async function() {
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
  
        // Commitments from voters 1, 2 and 3
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
  
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, true)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
      })
  
      it('tracks the phase transition when halted after more votes & elapsed time', async function() {
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
  
        // Commitments from voters 1, 2 and 3
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
        
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        
        // Commitment from admin
        await crv.commitVote(pollID, secretVoteNo, { from: admin })
        
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, true)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
  
        await crv.haltCommitPeriod(pollID)
  
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
      })
  
      it('tracks the phase transition when halted even without votes or elapsed time', async function() {
        await crv.haltCommitPeriod(pollID)
  
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
      })
  
      it('maintains reveal phase after reveals & ends it after elapsed time', async function() {
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
  
        // Commitments from voters 1, 2 and 3
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        await crv.haltCommitPeriod(pollID)
        
        // Reveals from all voters
        await crv.revealVote(pollID, voter1, 1, defaultSalt)
        await crv.revealVote(pollID, voter2, 1, defaultSalt)
        await crv.revealVote(pollID, voter3, 1, defaultSalt)
  
        // Reveal period still active after all reveals
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false, 'commit before increaseTime')
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true, 'reveal before increaseTime')
  
        // Reveal period ends after elapsed time
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false, 'commit after increaseTime')
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false, 'reveal after increaseTime')
      })
    })
  
    describe('when the poll has reveal duration = 0', function() {
      let secretVoteYes = utils.createVoteHash('1', defaultSalt)
      let secretVoteNo = utils.createVoteHash('0', defaultSalt)
      let result
  
      beforeEach(async function () {
        pollID = getNewPollID()
        await crv.startPoll(pollID, 5*60*60, 0)
      })
  
      it('tracks the commit phase properly initially', async function() {
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, true)
      })
      
  
      it('maintains commit phase after votes and ends after elapsed time', async function() {
        
        // Commitments from voters 1, 2 and 3
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
        
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, true)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
  
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
  
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
      })
  
      it('maintains the reveal phase after reveals & elapsed time', async function() {
        // Commitments from voters 1, 2 and 3, and admin
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
        await crv.commitVote(pollID, secretVoteNo, { from: admin })
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
  
        // Reveals from all voters
        await crv.revealVote(pollID, voter1, 1, defaultSalt)
        await crv.revealVote(pollID, voter2, 1, defaultSalt)
        await crv.revealVote(pollID, voter3, 1, defaultSalt)
        await crv.revealVote(pollID, admin, 0, defaultSalt)
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
  
        // Elapsed time
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
      })
  
      it('ends the reveal phase when halted, after all reveals', async function() {
        // Commitments from voters 1, 2 and 3, and admin
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
        await crv.commitVote(pollID, secretVoteNo, { from: admin })
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
  
        // Reveals from all voters
        await crv.revealVote(pollID, voter1, 1, defaultSalt)
        await crv.revealVote(pollID, voter2, 1, defaultSalt)
        await crv.revealVote(pollID, voter3, 1, defaultSalt)
        await crv.revealVote(pollID, admin, 0, defaultSalt)
  
        // Elapsed time
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
        
        // Halt reveal phase
        await crv.haltRevealPeriod(pollID)
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
      })
  
      it('ends the reveal phase when halted, with unrevealed commitments', async function() {
        // Commitments from voters 1, 2 and 3, and admin
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
        await crv.commitVote(pollID, secretVoteNo, { from: admin })
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        
        // Halt reveal phase
        await crv.haltRevealPeriod(pollID)
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
      })
  
      it('ends the reveal phase when halted, without any commitments', async function() {
        // End commit phase
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        
        // Halt reveal phase
        await crv.haltRevealPeriod(pollID)
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
      })
    })
  
    describe('when the poll has commit duration = 0 and reveal duration = 0', function() {
      let secretVoteYes = utils.createVoteHash('1', defaultSalt)
      let secretVoteNo = utils.createVoteHash('0', defaultSalt)
      let result
  
      beforeEach(async function () {
        pollID = getNewPollID()
        await crv.startPoll(pollID, 0, 0)
      })
  
      it('tracks the commit phase properly initially', async function() {
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, true)
      })
  
      it('tracks the phase transition when halted even without votes or elapsed time', async function() {
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, true)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
        
        await crv.haltCommitPeriod(pollID)
  
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false, 'halted commit')
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true, 'started reveal')
      })
      
      it('maintains commit phase after votes and elapsed time, then ends when halted', async function() {
        
        // Commitments from voters 1, 2 and 3
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, true)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
  
        await crv.haltCommitPeriod(pollID)
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false, 'halted commit')
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true, 'started reveal')
      })
  
      it('maintains the reveal phase after reveals & elapsed time', async function() {
        // Commitments from voters 1, 2 and 3, and admin
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
        await crv.commitVote(pollID, secretVoteNo, { from: admin })
        await crv.haltCommitPeriod(pollID)
        // Reveals from all voters
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
        await crv.revealVote(pollID, voter1, 1, defaultSalt)
        await crv.revealVote(pollID, voter2, 1, defaultSalt)
        await crv.revealVote(pollID, voter3, 1, defaultSalt)
        await crv.revealVote(pollID, admin, 0, defaultSalt)
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
  
        // Elapsed time
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
      })
  
      it('ends the reveal phase when halted, after all reveals', async function() {
        // Commitments from voters 1, 2 and 3, and admin
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
        await crv.commitVote(pollID, secretVoteNo, { from: admin })
        await crv.haltCommitPeriod(pollID)
  
        // Reveals from all voters
        await crv.revealVote(pollID, voter1, 1, defaultSalt)
        await crv.revealVote(pollID, voter2, 1, defaultSalt)
        await crv.revealVote(pollID, voter3, 1, defaultSalt)
        await crv.revealVote(pollID, admin, 0, defaultSalt)
  
        // Elapsed time
        await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [96*3600], id: 0})
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, true)
        
        // Halt reveal phase
        await crv.haltRevealPeriod(pollID)
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
      })
  
      it('ends the reveal phase when halted, with unrevealed commitments', async function() {
        // Commitments from voters 1, 2 and 3, and admin
        await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter2 })
        await crv.commitVote(pollID, secretVoteYes, { from: voter3 })
        await crv.commitVote(pollID, secretVoteNo, { from: admin })
        await crv.haltCommitPeriod(pollID)
        
        // Halt reveal phase
        await crv.haltRevealPeriod(pollID)
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
      })
  
      it('ends the reveal phase when halted, without any commitments', async function() {
        // Halt commit phase
        await crv.haltCommitPeriod(pollID)
        
        // Halt reveal phase
        await crv.haltRevealPeriod(pollID)
        result = await crv.commitPeriodActive.call(pollID)
        assert.equal(result, false)
        result = await crv.revealPeriodActive.call(pollID)
        assert.equal(result, false)
      })
    })
  })

  describe('when multiple polls exist', function() {

    let pollID1, pollID2, pollID3
    let secretVoteYes = utils.createVoteHash('1', defaultSalt)
    let secretVoteNo = utils.createVoteHash('0', defaultSalt + 1)
    let result

    beforeEach(async function () {
      pollID1 = getNewPollID()
      pollID2 = getNewPollID()
      pollID3 = getNewPollID()
      await crv.startPoll(pollID1, 24*60*60, 5*60*60)
      await crv.startPoll(pollID2, 24*60*60, 5*60*60)
      await crv.startPoll(pollID3, 24*60*60, 5*60*60)
    })

    it('allows you to commit multiple votes in one trx', async function() {
      
      result = await crv.didCommit.call(pollID1, admin)
      assert.equal(result, false, 'user has not yet committed 1')
      result = await crv.didCommit.call(pollID2, admin)
      assert.equal(result, false, 'user has not yet committed 2')

      // Commit votes and verify resulting state
      await crv.commitVotes([pollID1, pollID2], [secretVoteYes, secretVoteNo])

      // vote counts
      let voteCounts = await crv.getVoteCounts.call(pollID1)
      expect(voteCounts.numForVotes.toNumber()).to.equal(0)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)
      voteCounts = await crv.getVoteCounts.call(pollID2)
      expect(voteCounts.numForVotes.toNumber()).to.equal(0)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)
      voteCounts = await crv.getVoteCounts.call(pollID3)
      expect(voteCounts.numForVotes.toNumber()).to.equal(0)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(0)

      // commit status
      result = await crv.didCommit.call(pollID1, admin)
      assert.equal(result, true, 'user has committed 1')
      result = await crv.didCommit.call(pollID2, admin)
      assert.equal(result, true, 'user has committed 2')
      result = await crv.didCommit.call(pollID3, admin)
      assert.equal(result, false, 'user has not committed')
    })

    it('allows you to reveal multiple votes in one trx (one vote per poll)', async function() {
      // Commit votes and verify resulting state
      await crv.commitVotes([pollID1, pollID2], [secretVoteYes, secretVoteNo])
      await crv.commitVote(pollID3, secretVoteYes, {from: voter1})

      // check status of single vote
      let voteCounts = await crv.getVoteCounts.call(pollID3)
      expect(voteCounts.numForVotes.toNumber()).to.equal(0)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)
      result = await crv.didCommit.call(pollID3, voter1)
      assert.equal(result, true, 'user has committed')

      // reveal votes
      await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})
      await crv.revealVotes([pollID1, pollID2, pollID3], [admin, admin, voter1], [1,0,1], [defaultSalt, defaultSalt+1, defaultSalt], {from: voter2})

      // vote counts
      voteCounts = await crv.getVoteCounts.call(pollID1)
      expect(voteCounts.numForVotes.toNumber()).to.equal(1)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(0)
      voteCounts = await crv.getVoteCounts.call(pollID2)
      expect(voteCounts.numForVotes.toNumber()).to.equal(0)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(1)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(0)
      voteCounts = await crv.getVoteCounts.call(pollID3)
      expect(voteCounts.numForVotes.toNumber()).to.equal(1)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(0)

      // check votes
      let vote = await crv.getVote.call(pollID1, admin)
      assert.equal(vote[2].toNumber(), 1, 'expected vote for poll 1')
      vote = await crv.getVote.call(pollID2, admin)
      assert.equal(vote[2].toNumber(), 0, 'expected vote for poll 2')
      vote = await crv.getVote.call(pollID3, voter1)
      assert.equal(vote[2].toNumber(), 1, 'expected vote for poll 3')
    })

    it('allows you to reveal multiple votes in one trx (multiple votes per poll)', async function() {
      // Commit votes as follows:
      // Poll1: {Admin: 1, voter1: 1}
      // Poll2: {Admin: 0, voter1: 0}
      // Poll3: {Admin: 1, voter1: 0, voter2: 1}
      await crv.commitVotes([pollID1, pollID2, pollID3], [secretVoteYes, secretVoteNo, secretVoteYes], {from: admin})
      await crv.commitVote(pollID3, secretVoteNo, {from: voter1})
      await crv.commitVotes([pollID1, pollID2], [secretVoteYes, secretVoteNo], {from: voter1})
      await crv.commitVote(pollID3, secretVoteYes, {from: voter2})

      // check status of single vote
      let voteCounts = await crv.getVoteCounts.call(pollID1)
      expect(voteCounts.numForVotes.toNumber()).to.equal(0)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
      voteCounts = await crv.getVoteCounts.call(pollID2)
      expect(voteCounts.numForVotes.toNumber()).to.equal(0)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(2)
      voteCounts = await crv.getVoteCounts.call(pollID3)
      expect(voteCounts.numForVotes.toNumber()).to.equal(0)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(3)

      // reveal votes
      await promisify(web3.currentProvider.send)({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})
      await crv.revealVotes(
        [pollID1, pollID1, pollID2, pollID3, pollID3, pollID3],
        [admin, voter1, admin, admin, voter1, voter2],
        [1,1,0,1,0,1],
        [defaultSalt, defaultSalt, defaultSalt+1, defaultSalt, defaultSalt+1, defaultSalt], {from: voter2})

      // vote counts
      voteCounts = await crv.getVoteCounts.call(pollID1)
      expect(voteCounts.numForVotes.toNumber()).to.equal(2)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(0)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(0)
      voteCounts = await crv.getVoteCounts.call(pollID2)
      expect(voteCounts.numForVotes.toNumber()).to.equal(0)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(1)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(1)
      voteCounts = await crv.getVoteCounts.call(pollID3)
      expect(voteCounts.numForVotes.toNumber()).to.equal(2)
      expect(voteCounts.numAgainstVotes.toNumber()).to.equal(1)
      expect(voteCounts.numCommittedButNotRevealedVotes.toNumber()).to.equal(0)

      // check votes
      let vote = await crv.getVote.call(pollID1, admin)
      assert.equal(vote[2].toNumber(), 1, 'expected vote for admin@1')
      vote = await crv.getVote.call(pollID1, voter1)
      assert.equal(vote[2].toNumber(), 1, 'expected vote for voter1@1')
      vote = await crv.getVote.call(pollID2, admin)
      assert.equal(vote[2].toNumber(), 0, 'expected vote for admin@2')
      vote = await crv.getVote.call(pollID3, admin)
      assert.equal(vote[2].toNumber(), 1, 'expected vote for admin@3')
      vote = await crv.getVote.call(pollID3, voter1)
      assert.equal(vote[2].toNumber(), 0, 'expected vote for voter1@3')
      vote = await crv.getVote.call(pollID3, voter2)
      assert.equal(vote[2].toNumber(), 1, 'expected vote for voter2@3')
    })
  })

  // Tests TODO: verify expected event logs
})
