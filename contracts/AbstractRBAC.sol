pragma solidity 0.5.10;

contract AbstractRBAC {
  function checkRole(address _operator, string memory _role) view public;
}
