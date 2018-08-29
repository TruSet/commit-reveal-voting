pragma solidity ^0.4.22;

contract AbstractRBAC {
  function checkRole(address _operator, string _role) view public;
}
