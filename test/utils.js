const abi = require('ethereumjs-abi');

const createVoteHash = (vote, salt) => {
  const hash = `0x${abi.soliditySHA3(['uint', 'uint'],
    [vote, salt]).toString('hex')}`;
  return hash;
}

module.exports = { createVoteHash }
