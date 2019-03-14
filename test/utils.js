const web3Utils = require('web3-utils')
const should = require('chai')
  .should();

async function assertRevert (promise) {
  try {
    await promise;
  } catch (error) {
    error.message.should.include('revert', `Expected "revert()", got ${error} instead`);
    return;
  }
  should.fail('Expected "revert()"');
}

const createVoteHash = (vote, salt) =>
  web3Utils.soliditySha3(vote, salt)

const createPollId = (address, dataIdentifier, payloadHash) => {
  return web3Utils.soliditySha3(address, dataIdentifier, payloadHash)
}

module.exports = { createVoteHash, assertRevert }
