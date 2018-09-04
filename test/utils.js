const abi = require('ethereumjs-abi');
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

const createVoteHash = (vote, salt) => {
  const hash = `0x${abi.soliditySHA3(['uint', 'uint'],
    [vote, salt]).toString('hex')}`;
  return hash;
}

module.exports = { createVoteHash, assertRevert }
