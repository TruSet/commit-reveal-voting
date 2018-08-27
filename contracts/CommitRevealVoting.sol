pragma solidity ^0.4.8;
import "./AbstractRBAC.sol";

/**
@title Partial-Lock-Commit-Reveal Voting scheme with ERC20 tokens
@author Team: Aspyn Palatnick, Cem Ozer, Yorke Rhodes
*/
// TODO revealEndDate -> revealDuration (short circuited by complete reveal)
//      allow you to start the reveal period from a function call
contract CommitRevealVoting {
    AbstractRBAC rbac;

    // ============
    // EVENTS:
    // ============

    event VoteCommitted(bytes32 indexed pollID, address indexed voter, bytes32 indexed secretHash);
    event VoteRevealed(bytes32 indexed pollID, bytes32 indexed secretHash, uint indexed choice, address voter, address revealer, uint votesFor, uint votesAgainst);
    event PollCreated(bytes32 indexed pollID, address creator, uint voteQuorum, uint commitEndDate, uint revealEndDate);

    // ============
    // DATA STRUCTURES:
    // ============
    struct Poll {
        uint commitEndDate;     /// expiration date of commit period for poll
        uint revealEndDate;     /// expiration date of reveal period for poll
        uint voteQuorum;	    /// number of votes required for a proposal to pass
        uint votesFor;		    /// tally of votes supporting proposal
        uint votesAgainst;      /// tally of votes countering proposal
        mapping(address => bool) didCommit;  /// indicates whether an address committed a vote for this poll
        mapping(address => bool) didReveal;   /// indicates whether an address revealed a vote for this poll
    }

    // ============
    // STATE VARIABLES:
    // ============
    mapping(bytes32 => Poll) public pollMap; // maps pollID to Poll struct
    mapping(bytes32 => mapping(address => bytes32)) commitHashes; // [pollID][user]

    constructor(address _rbac) public {
      rbac = AbstractRBAC(_rbac);
    }

    string public constant ROLE_ADMIN = "commit_reveal_admin";
    string public constant ROLE_VOTE = "commit_reveal_vote";
    uint public constant MAX_COMMIT_DURATION_IN_SECONDS = 365 days;
    uint public constant MAX_REVEAL_DURATION_IN_SECONDS = 365 days;

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
    @notice Commits vote using hash of choice and secret salt to conceal vote until reveal
    @param _pollID Integer identifier associated with target poll
    @param _secretHash Commit keccak256 hash of voter's choice and salt (tightly packed in this order)
    */
    function commitVote(bytes32 _pollID, bytes32 _secretHash) public
    onlyVoters
    {
        require(commitPeriodActive(_pollID));
        // prevent user from committing to zero node placeholder
        require(_pollID != 0);

        // prevent user from committing a secretHash of 0
        require(_secretHash != 0);

        commitHashes[_pollID][msg.sender] = _secretHash;

        pollMap[_pollID].didCommit[msg.sender] = true;
        emit VoteCommitted(_pollID, msg.sender, _secretHash);
    }

    /**
    @notice                 Commits votes using hashes of choices and secret salts to conceal votes until reveal
    @param _pollIDs         Array of integer identifiers associated with target polls
    @param _secretHashes    Array of commit keccak256 hashes of voter's choices and salts (tightly packed in this order)
    */
    function commitVotes(bytes32[] _pollIDs, bytes32[] _secretHashes) external
    onlyVoters
    {
        // make sure the array lengths are all the same
        require(_pollIDs.length == _secretHashes.length);

        // loop through arrays, committing each individual vote values
        for (uint i = 0; i < _pollIDs.length; i++) {
            commitVote(_pollIDs[i], _secretHashes[i]);
        }
    }

    /**
    @notice Reveals vote with choice and secret salt used in generating commitHash to attribute committed tokens
    @param _pollID Integer identifier associated with target poll
    @param _voteOption Vote choice used to generate commitHash for associated poll
    @param _salt Secret number used to generate commitHash for associated poll
    */
    // TODO this function - or a new one - should take user address as an argument, allow you to reveal for anyone
    function revealVote(bytes32 _pollID, uint _voteOption, uint _salt) public {
        // Make sure the reveal period is active
        require(revealPeriodActive(_pollID));
        require(pollMap[_pollID].didCommit[msg.sender]); // make sure user has committed a vote for this poll
        require(!pollMap[_pollID].didReveal[msg.sender]); // prevent user from revealing multiple times
        bytes32 commitHash = getCommitHash(msg.sender, _pollID);
        require(keccak256(abi.encodePacked(_voteOption, _salt)) == commitHash); // compare resultant hash from inputs to original commitHash

        if (_voteOption == 1) {
            pollMap[_pollID].votesFor += 1;
        } else {
            pollMap[_pollID].votesAgainst += 1;
        }

        pollMap[_pollID].didReveal[msg.sender] = true;

        emit VoteRevealed(_pollID, commitHash, _voteOption, msg.sender, msg.sender, pollMap[_pollID].votesFor, pollMap[_pollID].votesAgainst);
    }

    /**
    @notice             Reveals multiple votes with choices and secret salts used in generating commitHashes to attribute committed tokens
    @param _pollIDs     Array of integer identifiers associated with target polls
    @param _voteOptions Array of vote choices used to generate commitHashes for associated polls
    @param _salts       Array of secret numbers used to generate commitHashes for associated polls
    */
    function revealVotes(bytes32[] _pollIDs, uint[] _voteOptions, uint[] _salts) external {
        // make sure the array lengths are all the same
        require(_pollIDs.length == _voteOptions.length);
        require(_pollIDs.length == _salts.length);

        // loop through arrays, revealing each individual vote values
        for (uint i = 0; i < _pollIDs.length; i++) {
            revealVote(_pollIDs[i], _voteOptions[i], _salts[i]);
        }
    }

    // ==================
    // POLLING INTERFACE:
    // ==================

    /**
    @dev Initiates a poll with canonical configured parameters at pollID emitted by PollCreated event
    @param _voteQuorum Type of majority (out of 100) that is necessary for poll to be successful
    @param _commitDuration Length of desired commit period in seconds
    @param _revealDuration Length of desired reveal period in seconds
    */
    function startPoll(bytes32 _pollID, uint _voteQuorum, uint _commitDuration, uint _revealDuration) public 
    onlyAdmin
    returns (bytes32 pollID)
    {
        // TODO: use safemath
        require(!pollExists(_pollID));
        require(_commitDuration > 0 && _commitDuration <= MAX_COMMIT_DURATION_IN_SECONDS, "0 < commitDuration <= 365 days");
        require(_revealDuration > 0 && _revealDuration <= MAX_REVEAL_DURATION_IN_SECONDS, "0 < revealDuration <= 365 days");
        //uint commitEndDate = block.timestamp.add(_commitDuration);
        //uint revealEndDate = commitEndDate.add(_revealDuration);
        uint commitEndDate = block.timestamp + _commitDuration;
        assert(commitEndDate > 0); // Redundant "Double Check" because we rely on a non-zero value implying poll existence
        uint revealEndDate = commitEndDate + _revealDuration;

        pollMap[_pollID] = Poll({
            commitEndDate: commitEndDate, // Invariant: all (active or inactive) Polls have a non-zero commitEndDate
            revealEndDate: revealEndDate,
            voteQuorum: _voteQuorum,
            votesFor: 0,
            votesAgainst: 0
        });

        emit PollCreated(_pollID, msg.sender, _voteQuorum, commitEndDate, revealEndDate);
        return _pollID;
    }

    /**
    @notice Determines if proposal has passed
    @dev Check if votesFor out of totalVotes exceeds votesQuorum (requires pollEnded)
    @param _pollID Integer identifier associated with target poll
    */
    function isPassed(bytes32 _pollID) view public returns (bool passed) {
        require(pollEnded(_pollID));

        Poll memory poll = pollMap[_pollID];
        return (100 * poll.votesFor) > (poll.voteQuorum * (poll.votesFor + poll.votesAgainst));
    }

    // ----------------
    // POLLING HELPERS:
    // ----------------

    /**
    @dev Gets the total winning and losing votes for reward distribution purposes
    @param _pollID Bytes32 identifier associated with target poll
    @return Total number of winning votes and losing votes (in that order) for specified, already-ended poll
    */
    function getTotalNumberOfWinningVotes(bytes32 _pollID) view public returns (uint numWinningVotes, uint numLosingVotes) {
        require(pollEnded(_pollID));

        if (isPassed(_pollID))
            return (pollMap[_pollID].votesFor, pollMap[_pollID].votesAgainst);
        else
            return (pollMap[_pollID].votesAgainst, pollMap[_pollID].votesFor);
    }

    /**
    @notice Determines if poll is over
    @dev Checks isExpired for specified poll's revealEndDate
    @return Boolean indication of whether polling period is over
    */
    function pollEnded(bytes32 _pollID) view public returns (bool ended) {
        require(pollExists(_pollID));

        return isExpired(pollMap[_pollID].revealEndDate);
    }

    /**
    @notice Checks if the commit period is still active for the specified poll
    @dev Checks isExpired for the specified poll's commitEndDate
    @param _pollID Integer identifier associated with target poll
    @return Boolean indication of isCommitPeriodActive for target poll
    */
    function commitPeriodActive(bytes32 _pollID) view public returns (bool active) {
        require(pollExists(_pollID));

        return !isExpired(pollMap[_pollID].commitEndDate);
    }

    /**
    @notice Checks if the reveal period is still active for the specified poll
    @dev Checks isExpired for the specified poll's revealEndDate
    @param _pollID Integer identifier associated with target poll
    */
    function revealPeriodActive(bytes32 _pollID) view public returns (bool active) {
        require(pollExists(_pollID));

        return !isExpired(pollMap[_pollID].revealEndDate) && !commitPeriodActive(_pollID);
    }

    /**
    @dev Checks if user has committed for specified poll
    @param _voter Address of user to check against
    @param _pollID Integer identifier associated with target poll
    @return Boolean indication of whether user has committed
    */
    function didCommit(address _voter, bytes32 _pollID) view public returns (bool committed) {
        require(pollExists(_pollID));

        return pollMap[_pollID].didCommit[_voter];
    }

    /**
    @dev Checks if user has revealed for specified poll
    @param _voter Address of user to check against
    @param _pollID Integer identifier associated with target poll
    @return Boolean indication of whether user has revealed
    */
    function didReveal(address _voter, bytes32 _pollID) view public returns (bool revealed) {
        require(pollExists(_pollID));

        return pollMap[_pollID].didReveal[_voter];
    }

    /**
    @dev Checks if a poll exists
    @param _pollID The pollID whose existance is to be evaluated.
    @return Boolean Indicates whether a poll exists for the provided pollID
    */
    function pollExists(bytes32 _pollID) view public returns (bool exists) {
        return (_pollID != 0) && (pollMap[_pollID].commitEndDate > 0);
    }

    // ---------------------------
    // DOUBLE-LINKED-LIST HELPERS:
    // ---------------------------

    /**
    @dev Gets the bytes32 commitHash property of target poll
    @param _voter Address of user to check against
    @param _pollID Integer identifier associated with target poll
    @return Bytes32 hash property attached to target poll
    */
    function getCommitHash(address _voter, bytes32 _pollID) view public returns (bytes32 commitHash) {
        return commitHashes[_pollID][_voter];
    }

    // ----------------
    // GENERAL HELPERS:
    // ----------------

    /**
    @dev Checks if an expiration date has been reached
    @param _terminationDate Integer timestamp of date to compare current timestamp with
    @return expired Boolean indication of whether the terminationDate has passed
    */
    function isExpired(uint _terminationDate) view public returns (bool expired) {
        return (block.timestamp > _terminationDate);
    }
}
