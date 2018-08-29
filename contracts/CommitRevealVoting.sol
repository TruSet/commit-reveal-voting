pragma solidity ^0.4.24;
import "./AbstractRBAC.sol";
import "./CommitRevealVotingInternal.sol";

/**
* @title Commit-Reveal Voting demo contract, using an RBAC to gate access to all state-changing functions
* @author TruSet
*/
contract CommitRevealVoting is CommitRevealVotingInternal {
    AbstractRBAC rbac;

    constructor(address _rbac) public {
      rbac = AbstractRBAC(_rbac);
    }

    string public constant ROLE_ADMIN = "commit_reveal_admin";
    string public constant ROLE_VOTE = "commit_reveal_vote";

    modifier onlyAdmin() {
      rbac.checkRole(msg.sender, ROLE_ADMIN);
      _;
    }

    modifier onlyVoters() {
      rbac.checkRole(msg.sender, ROLE_VOTE);
      _;
    }

    // =================
    // VOTING INTERFACE:
    // =================

    /**
    * @notice Commits vote using hash of choice and secret salt to conceal vote until reveal
    * @param _pollID Identifer associated with target poll
    * @param _secretHash Commit keccak256 hash of voter's choice and salt (tightly packed in this order)
    */
    function commitVote(bytes32 _pollID, bytes32 _secretHash) public
        onlyVoters
    {
        _commitVote(_pollID, _secretHash);
    }

    /**
    * @notice                 Commits votes using hashes of choices and secret salts to conceal votes until reveal
    * @param _pollIDs         Array of identifers associated with target polls
    * @param _secretHashes    Array of commit keccak256 hashes of voter's choices and salts (tightly packed in this order)
    */
    function commitVotes(bytes32[] _pollIDs, bytes32[] _secretHashes) external
        onlyVoters
    {
        _commitVotes(_pollIDs, _secretHashes);
    }

    /**
    * @notice Reveals vote with choice and secret salt used in generating commitHash to attribute committed tokens
    * @param _pollID Identifer associated with target poll
    * @param _voteOption Vote choice used to generate commitHash for associated poll
    * @param _salt Secret number used to generate commitHash for associated poll
    */
    // TODO this function - or a new one - should take user address as an argument, allow you to reveal for anyone
    function revealVote(bytes32 _pollID, uint _voteOption, uint _salt) public {
        // Make sure the reveal period is active
        _revealVote(_pollID, _voteOption, _salt);
    }

    /**
    * @notice             Reveals multiple votes with choices and secret salts used in generating commitHashes to attribute committed tokens
    * @param _pollIDs     Array of identifers associated with target polls
    * @param _voteOptions Array of vote choices used to verify commitHashes for associated polls
    * @param _salts       Array of secret numbers used to verify commitHashes for associated polls
    */
    function revealVotes(bytes32[] _pollIDs, uint[] _voteOptions, uint[] _salts) external {
        _revealVotes(_pollIDs, _voteOptions, _salts);
    }

    // ==================
    // POLLING INTERFACE:
    // ==================

    /**
    * @dev Initiates a poll with canonical configured parameters at pollID emitted by PollCreated event
    * @param _commitDuration Length of desired commit period in seconds
    * @param _revealDuration Length of desired reveal period in seconds
    */
    function startPoll(bytes32 _pollID, uint _commitDuration, uint _revealDuration) public 
        onlyAdmin
    returns (bytes32 pollID)
    {
        return _startPoll(_pollID, _commitDuration, _revealDuration);
    }
}
