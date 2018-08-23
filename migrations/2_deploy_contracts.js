var CommitRevealVoting = artifacts.require("./CommitRevealVoting.sol");

module.exports = function(deployer) {
  deployer.deploy(CommitRevealVoting);
};
