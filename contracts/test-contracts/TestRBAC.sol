pragma solidity 0.5.10;

contract TestRBAC {
  // this is just for testing purposes and not secure
  mapping (address => bool) isAdmin;
  mapping (address => bool) isVoter;

  function makeAdmin(address _user) public {
    isAdmin[_user] = true;
  }

  function makeVoter(address _user) public {
    isVoter[_user] = true;
  }

  function checkAdmin(address _user) view public {
    require(isAdmin[_user], "User must be an admin");
  }
  function checkVoter(address _user) view public {
    require(isVoter[_user], "User must be a voter");
  }
}