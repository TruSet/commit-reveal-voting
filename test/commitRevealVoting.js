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
    await crv.startPoll(pollID, 51, 24*60*60, 5*60*60)

    let pollEnded = await crv.pollEnded.call(pollID)
    assert.equal(pollEnded, false, 'poll should be open')

    let commitPeriodActive = await crv.commitPeriodActive.call(pollID)
    assert.equal(commitPeriodActive, true, 'poll should be in the commit period')

    let revealPeriodActive = await crv.revealPeriodActive.call(pollID)
    assert.equal(revealPeriodActive, false, 'poll should not be in the reveal period')
  })

  describe('when a poll exists', function() {
    let pollID = 'testPoll2'

    before(async function () {
      await crv.startPoll(pollID, 51, 24*60*60, 5*60*60)
    })

    it('allows you to commit a vote', async function() {
      let secretVote = utils.createVoteHash('1', defaultSalt)
      await crv.commitVote(pollID, secretVote)

      let didCommit = await crv.didCommit.call(greg, pollID)
      assert.equal(didCommit, true, 'user should be able to commit a vote')
    })

    it('allows you to reveal your vote', async function() {
      let secretVote = utils.createVoteHash('1', defaultSalt)
      await crv.commitVote(pollID, secretVote, { from: neil })

      web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [25*3600], id: 0})

      let revealPeriodActive = await crv.revealPeriodActive.call(pollID)
      assert.equal(revealPeriodActive, true, 'poll should enter the reveal period after 25 hours')

      await crv.revealVote(pollID, '1', defaultSalt, { from: neil })

      let didReveal = await crv.didReveal.call(neil, pollID)
      assert.equal(didReveal, true, 'user should be able to reveal a vote')
    })
  })
})
