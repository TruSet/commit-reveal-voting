const CommitRevealVoting = artifacts.require('./CommitRevealVoting.sol');

contract('CommitRevealVoting', function (accounts) {
  let crv;

  before(async function () {
    crv = await CommitRevealVoting.deployed()
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
})
