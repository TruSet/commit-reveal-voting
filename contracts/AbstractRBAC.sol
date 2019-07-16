pragma solidity 0.5.10;

contract AbstractRBAC {
  function checkAdmin(address _user) view public;
  function checkVoter(address _user) view public;
}
