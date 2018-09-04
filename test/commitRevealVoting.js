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
      let secretVote = utils.createVoteHash('0', defaultSalt)
      await crv.commitVote(pollID, secretVote)

      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,1])

      let didCommit = await crv.didCommit.call(pollID, admin)
      assert.equal(didCommit, true, 'user should be able to commit a vote')
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

    it('forbids further commits during the reveal phase', async function() {
      await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})

      let secretVote = utils.createVoteHash('0', defaultSalt)
      await utils.assertRevert(crv.commitVote(pollID, secretVote, { from: voter2 }))

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])
    })

    it('allows you to reveal your own vote during the reveal phase', async function() {
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

    it('allows anyone to reveal someone else\'s vote during the reveal phase', async function() {
      await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})

      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])

      await crv.revealVote(pollID, admin, 0, defaultSalt, { from: voter1 })

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,1,1])

      let didReveal = await crv.didReveal.call(pollID, admin)
      assert.equal(didReveal, true, 'admin\'s vote was revealed')

      let vote = await crv.getVote.call(pollID, admin)
      assert.equal(vote.toNumber(), 0, '\'user voted against\' tracked as expected')
    })
    
  })

      // Tests TODO: committing multiple votes
    //             revealing multiple votes
    //             checking 
    //             make tests independent
    //             verify expected events

})
