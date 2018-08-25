pragma solidity ^0.4.22;

contract AbstractRBAC {
  function checkRole(address _operator, string _role) view public;
  //function hasRole(address _operator, string _role) view public returns (bool);
  //function adminAddRole(address admin) public;
  //function adminRemoveRole(address admin) public;
  //function publishAddRole(address publisher) public;
  //function publishRemoveRole(address publish) public;
  //function validateAddRole(address validator) public;
  //function validateRemoveRole(address validator) public;
  //function newUser(address _addr, string _display, string _role) external;
  //function getUserDisplay(address _addr) constant public returns (string);
}
