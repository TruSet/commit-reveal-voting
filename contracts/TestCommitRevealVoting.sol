pragma solidity 0.5.10;
import "./AbstractRBAC.sol";
import "./CommitRevealVoting.sol";

/**
* @title Commit-Reveal Voting demo contract, using an RBAC to gate access to all state-changing functions
* @author TruSet
*/
contract TestCommitRevealVoting is CommitRevealVoting {
    AbstractRBAC rbac;

    constructor(address _rbac) public {
      require(_rbac != address(0), "Invalid RBAC");
      rbac = AbstractRBAC(_rbac);
    }

    modifier onlyAdmin() {
      rbac.checkAdmin(msg.sender);
      _;
    }

    modifier onlyVoters() {
      rbac.checkVoter(msg.sender);
      _;
    }

    // =================
    // VOTING INTERFACE:
    // =================

    /**
    * @notice Commits a vote by submitting a hash (of the vote and secret salt) to conceal the vote until reveal
    * @param _pollID Identifer associated with target poll
    * @param _secretHash keccak256 hash of voter's choice and salt (tightly packed in this order)
    */
    function commitVote(bytes32 _pollID, bytes32 _secretHash) public
        onlyVoters
    {
        _commitVote(_pollID, _secretHash);
    }

    /**
    * @notice                 Commits multiple votes. All input arrays must be the same length, and the two values at any given
    *                         array index must constitute the information required to commit a single vote (see `_commitVote` params)
    * @param _pollIDs         Array of identifers associated with target polls
    * @param _secretHashes    Array of keccak256 hashes of each choice and the corresponding secret salt (tightly packed in this order)
    */
    function commitVotes(bytes32[] calldata _pollIDs, bytes32[] calldata _secretHashes) external
        onlyVoters
    {
        _commitVotes(_pollIDs, _secretHashes);
    }

    /**
    * @notice Reveals a vote. The vote and secret salt must correspond to a prior commitment.
    * @param _pollID     Identifer associated with target poll
    * @param _voter      The user who committed the vote
    * @param _voteOption Vote choice (0 or 1)
    * @param _salt       Secret number that was used to generate the vote commitment
    */
    function revealVote(bytes32 _pollID, address _voter, uint _voteOption, uint _salt) public {
        _revealVote(_pollID, _voter, _voteOption, _salt);
    }

    /**
    * @notice Convenience function for revealing one's own vote. The vote and secret salt must correspond to a prior commitment.
    * @param _pollID     Identifer associated with target poll
    * @param _voteOption Vote choice (0 or 1)
    * @param _salt       Secret number that was used to generate the vote commitment
    */
    function revealMyVote(bytes32 _pollID, uint _voteOption, uint _salt) public {
        _revealVote(_pollID, msg.sender, _voteOption, _salt);
    }

    /**
    * @notice Reveals multiple votes. All input arrays must be the same length, and the four values at any given
    *         array index constitute the information required to reveal a single vote (see `_revealVote` params)
    * @param _pollIDs     Array of identifers associated with target polls
    * @param _voters      Array of voter addresses
    * @param _voteOptions Array of vote choices (each 0 or 1)
    * @param _salts       Array of secret numbers that were used to generate the vote commitment
    */
    function revealVotes(bytes32[] calldata _pollIDs, address[] calldata _voters, uint[] calldata _voteOptions, uint[] calldata _salts) external {
        _revealVotes(_pollIDs, _voters, _voteOptions, _salts);
    }

    // ==================
    // ADMIN INTERFACE:
    // ==================

    /**
    * @dev Initiates a poll with the configured parameters
    * @param _pollID Identifer to be associated with target poll must not alrady exist
    * @param _commitDuration Length of desired commit period in seconds
    * @param _revealDuration Length of desired reveal period in seconds
    */
    function startPoll(bytes32 _pollID, uint _commitDuration, uint _revealDuration) public 
        onlyAdmin
    returns (bytes32 pollID)
    {
        return _startPoll(_pollID, _commitDuration, _revealDuration);
    }

    /**
    * @dev Closes the reveal period, or reverts if it is not currently open
    * @param _pollID Bytes32 identifier associated with target poll
    */
    function haltRevealPeriod(bytes32 _pollID) public 
        onlyAdmin
    {
        return _haltRevealPeriod(_pollID);
    }

    /**
    * @dev Closes the commit period, or reverts if it is not currently open
    * @param _pollID Bytes32 identifier associated with target poll
    */
    function haltCommitPeriod(bytes32 _pollID) public 
        onlyAdmin
    {
        return _haltCommitPeriod(_pollID);
    }
}
