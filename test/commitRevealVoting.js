const CommitRevealVoting = artifacts.require('./CommitRevealVoting.sol');
const RBAC = artifacts.require('./test-contracts/TestRBAC.sol');
const utils = require('./utils.js')

contract('CommitRevealVoting', function (accounts) {
  let [greg, neil] = accounts
  let crv;
  let rbac;
  let defaultSalt = '666';

  before(async function () {
    crv = await CommitRevealVoting.deployed()
    rbac = await RBAC.deployed()
    let promises = accounts.map((account) => rbac.makeVoter(account))
    promises.push(rbac.makeAdmin(accounts[0]))
    await Promise.all(promises)
  })


  it('creates a poll', async function () {
    let pollID = 'testPoll'
    await crv.startPoll(pollID, 24*60*60, 5*60*60)

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
    let pollID = 'testPoll2'

    before(async function () {
      await crv.startPoll(pollID, 24*60*60, 5*60*60)
    })

    it('allows you to commit a vote', async function() {
      let secretVote = utils.createVoteHash('1', defaultSalt)
      await crv.commitVote(pollID, secretVote)

      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,1])

      let didCommit = await crv.didCommit.call(pollID, greg)
      assert.equal(didCommit, true, 'user should be able to commit a vote')
    })

    it('allows you to reveal your vote', async function() {
      let secretVote = utils.createVoteHash('1', defaultSalt)
      await crv.commitVote(pollID, secretVote, { from: neil })

      await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})

      let revealPeriodActive = await crv.revealPeriodActive.call(pollID)
      assert.equal(revealPeriodActive, true, 'poll should enter the reveal period after 25 hours')

      let voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([0,0,2])

      await crv.revealVote(pollID, '1', defaultSalt, { from: neil })

      voteCounts = await crv.getVoteCounts.call(pollID)
      expect(voteCounts.map(e => e.toNumber())).to.deep.equal([1,0,1])

      let didReveal = await crv.didReveal.call(pollID, neil)
      assert.equal(didReveal, true, 'user should be able to reveal a vote')
    })
  })
})
