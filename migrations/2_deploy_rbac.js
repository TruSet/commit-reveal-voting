const TestRBAC = artifacts.require('./test-contracts/TestRBAC');


module.exports = (deployer, network, accounts) => {
  deployer.deploy(TestRBAC)
}
