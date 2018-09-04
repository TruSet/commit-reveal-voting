const TestCommitRevealVoting = artifacts.require('./TestCommitRevealVoting.sol');
const RBAC = artifacts.require('./test-contracts/TestRBAC.sol');
const utils = require('./utils.js')

contract('TestCommitRevealVoting', function (accounts) {
  assert.isAtLeast(accounts.length, 4)
  let [admin, voter1, voter2, voter3] = accounts
  let crv;
  let rbac;
  let defaultSalt = '666';
  let counter = 0

  function getNewPollID() {
    return 'testPoll' + counter++
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
    expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,0])

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

      let secretVote = utils.createVoteHash('0', defaultSalt)
      await crv.commitVote(pollID, secretVote)

      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,1])

      didCommit = await crv.didCommit.call(pollID, admin)
      assert.equal(didCommit, true, 'user has committed')
    })
  })

  describe('when a poll has committed votes', function() {

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
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])

      await utils.assertRevert(crv.revealVote(pollID, admin, 0, defaultSalt, { from: voter2 }))

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])
    })

    it('forbids further commits after commit phase expires', async function() {
      await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})

      let secretVote = utils.createVoteHash('0', defaultSalt)
      await utils.assertRevert(crv.commitVote(pollID, secretVote, { from: voter2 }))

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])
    })

    it('forbids further commits after commit phase is halted', async function() {
      await crv.haltCommitPeriod(pollID)

      let secretVote = utils.createVoteHash('0', defaultSalt)
      await utils.assertRevert(crv.commitVote(pollID, secretVote, { from: voter2 }))

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])
    })

    it('allows you to reveal your own after commit phase expires', async function() {
      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])

      let secretVote = utils.createVoteHash('1', defaultSalt)
      await crv.commitVote(pollID, secretVote, { from: voter1 })

      let revealPeriodActive = await crv.revealPeriodActive.call(pollID)
      assert.equal(revealPeriodActive, false, 'poll should not be in the reveal period yet')
      let commitPeriodActive = await crv.commitPeriodActive.call(pollID)
      assert.equal(commitPeriodActive, true, 'poll should be in the commit period')

      await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})

      revealPeriodActive = await crv.revealPeriodActive.call(pollID)
      assert.equal(revealPeriodActive, true, 'poll should enter the reveal period after 25 hours')
      commitPeriodActive = await crv.commitPeriodActive.call(pollID)
      assert.equal(commitPeriodActive, false, 'poll should no longer be in the commit period')

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])

      await crv.revealMyVote(pollID, '1', defaultSalt, { from: voter1 })

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([1,0,1])

      let didReveal = await crv.didReveal.call(pollID, voter1)
      assert.equal(didReveal, true, 'user should be able to reveal a vote')

      let vote = await crv.getVote.call(pollID, voter1)
      assert.equal(vote.toNumber(), 1, '\'user voted for\' tracked as expected')
    })

    it('allows you to reveal your own after commit phase is halted', async function() {
      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])

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
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])

      await crv.revealMyVote(pollID, '1', defaultSalt, { from: voter1 })

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([1,0,1])

      let didReveal = await crv.didReveal.call(pollID, voter1)
      assert.equal(didReveal, true, 'user should be able to reveal a vote')

      let vote = await crv.getVote.call(pollID, voter1)
      assert.equal(vote.toNumber(), 1, '\'user voted for\' tracked as expected')
    })

    it('allows anyone to reveal someone else\'s vote after commit phase expires', async function() {
      await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})

      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])

      let didReveal = await crv.didReveal.call(pollID, admin)
      assert.equal(didReveal, false, 'admin\'s vote was not revealed yet')

      await crv.revealVote(pollID, admin, 0, defaultSalt, { from: voter1 })

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,1,1])

      didReveal = await crv.didReveal.call(pollID, admin)
      assert.equal(didReveal, true, 'admin\'s vote was revealed')

      let vote = await crv.getVote.call(pollID, admin)
      assert.equal(vote.toNumber(), 0, '\'user voted against\' tracked as expected')
    })

    it('allows anyone to reveal someone else\'s vote after commit phase is halted', async function() {
      await crv.haltCommitPeriod(pollID)

      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])

      let didReveal = await crv.didReveal.call(pollID, admin)
      assert.equal(didReveal, false, 'admin\'s vote was not revealed yet')

      await crv.revealVote(pollID, admin, 0, defaultSalt, { from: voter1 })

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,1,1])

      didReveal = await crv.didReveal.call(pollID, admin)
      assert.equal(didReveal, true, 'admin\'s vote was revealed')

      let vote = await crv.getVote.call(pollID, admin)
      assert.equal(vote.toNumber(), 0, '\'user voted against\' tracked as expected')
    })

    it('rejects a reveal if the wrong vote or salt is provided', async function() {
      await crv.haltCommitPeriod(pollID)

      await utils.assertRevert(crv.revealVote(pollID, admin, 1, defaultSalt, { from: voter1 }))
      await utils.assertRevert(crv.revealVote(pollID, admin, 0, defaultSalt + 1, { from: voter1 }))
      await crv.revealVote(pollID, admin, 0, defaultSalt, { from: voter1 })

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,1,1])

      let didReveal = await crv.didReveal.call(pollID, admin)
      assert.equal(didReveal, true, 'admin\'s vote was revealed')

      let vote = await crv.getVote.call(pollID, admin)
      assert.equal(vote.toNumber(), 0, '\'user voted against\' tracked as expected')
    })
    
  })

  describe('when a poll has revealed votes', function() {
    beforeEach(async function () {
      pollID = getNewPollID()
      await crv.startPoll(pollID, 24*60*60, 5*60*60)

      // Revealed No vote from admin
      let secretVoteNo = utils.createVoteHash('0', defaultSalt + 1)
      await crv.commitVote(pollID, secretVoteNo)

      // Revealed Yes votes from voters  1 and 2
      secretVoteYes = utils.createVoteHash('1', defaultSalt)
      await crv.commitVote(pollID, secretVoteYes, { from: voter1 })
      await crv.commitVote(pollID, secretVoteYes, { from: voter2 })

      // Unrevealed vote from voter3
      await crv.commitVote(pollID, secretVoteNo, { from: voter3 })

      await crv.haltCommitPeriod(pollID)

      await crv.revealMyVote(pollID, 1, defaultSalt, { from: voter1 })
      await crv.revealVote(pollID, admin, 0, defaultSalt + 1, { from: voter3 })
      await crv.revealVote(pollID, voter2, 1, defaultSalt, { from: voter3 })
    })

    it('returns the expected vote counts', async function() {
      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([2,1,1])
    })

    // TODO: test pollEnded(), getVoters(), getVote()
  })

  // Tests TODO: committing multiple votes in one trx?
  //             getVoters()
  //             revealing multiple votes in one trx
  //             verify expected event logs

})
