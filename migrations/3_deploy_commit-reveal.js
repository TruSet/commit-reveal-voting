var CommitRevealVoting = artifacts.require("./CommitRevealVoting.sol");
const TestRBAC = artifacts.require('./test-contracts/TestRBAC');

module.exports = function(deployer) {
  deployer.then(async () => {
    let rbac = await TestRBAC.deployed()

    return deployer.deploy(CommitRevealVoting, rbac.address);
  })
};
