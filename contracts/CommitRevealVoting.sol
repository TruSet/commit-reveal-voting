pragma solidity 0.5.10;
import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/**
* @title Commit-Reveal Voting logic for use/adaptation in commit-reveal voting contracts
* @author TruSet
* @dev The functions that change state are all internal, so to make use of this logic
*      this contract must be subclassed and have some functions that change state exposed publically. It is anticipated
*      that the public functions will need to be restricted in some way (e.g. whitelisting), which is out of the scope
*      of this base contract.
*/
// Initial implementaiton adapted from "Partial-Lock-Commit-Reveal Voting scheme with ERC20 tokens" by Aspyn Palatnick, Cem Ozer, Yorke Rhodes
contract CommitRevealVoting {
    using SafeMath for uint;

    // ============
    // EVENTS:
    // ============

    event VoteCommitted(bytes32 indexed pollID, address indexed voter, bytes32 indexed secretHash);
    event VoteRevealed(bytes32 indexed pollID, bytes32 indexed secretHash, uint indexed choice, address voter, address revealer, uint votesFor, uint votesAgainst, uint votesCommittedButNotRevealed);
    event PollCreated(bytes32 indexed pollID, address creator, uint commitDuration, uint revealDuration);
    event CommitPeriodHalted(bytes32 indexed pollID, address haltedBy, uint timestamp);
    event RevealPeriodHalted(bytes32 indexed pollID, address haltedBy, uint timestamp);

    // ============
    // DATA STRUCTURES:
    // ============
    struct Poll {
        uint commitPeriodStartedAt; // the poll was opened and the commit period started at this time
        uint commitDuration;        // the maxiumum amount of time (in seconds) to allow for vote commitments following the start of the commit period, or zero to have no maximum
        uint commitsHaltedAt;       // the time that the commit period ended, if different from the value returned by commitDeadline()
        uint revealDuration;        // the maxiumum amount of time (in seconds) to allow for vote revelation following the end of the commit period, or zero to have no maximum
        uint revealsHaltedAt;       // the time that the reveal period ended, if different from the value returned by revealDeadline()
        uint votesFor;	            // tally of votes supporting proposal
        uint votesAgainst;          // tally of votes countering proposal
        uint votesCommittedButNotRevealed;        // tally of votes that have been committed but not revealed
        mapping(address => bool) didReveal;       // voter -> whether the voter's vote has been revealed
        mapping(address => bytes32) commitHashes; // voter -> voter's commitment to a vote
        mapping(address => uint) revealedVotes;   // voter -> voter's revealed vote (0=Against; 1=For)
        address[] voters;   // a list of the addresses who have committed (not necess revealed) a vote in this poll
    }

    // ============
    // STATE VARIABLES:
    // ============
    mapping(bytes32 => Poll) public pollMap; // maps pollID to Poll struct
    uint public constant MAX_COMMIT_DURATION_IN_SECONDS = 365 days;
    uint public constant MAX_REVEAL_DURATION_IN_SECONDS = 365 days;
    uint public constant VOTE_FOR = 1;
    uint public constant VOTE_AGAINST = 0;

    // =================
    // VOTING INTERFACE:
    // =================

    /**
    * @notice Commits vote using hash of choice and secret salt to conceal vote until reveal
    * @param _pollID Identifer associated with target poll
    * @param _secretHash Commit keccak256 hash of voter's choice and salt (tightly packed in this order)
    */
    function _commitVote(bytes32 _pollID, bytes32 _secretHash) internal
    {
        // prevent user from committing to a non-existent poll or one in the wrong state
        require(_pollID != 0, "Not a valid pollID");
        require(commitPeriodActive(_pollID), "Commit period must be active");

        // prevent user from committing a secretHash of 0
        require(_secretHash != 0, "Invalid commitment hash");

        Poll storage p = pollMap[_pollID];
        if (p.commitHashes[msg.sender] == bytes32(0)) {
            // This commitment has not already been counted
            p.votesCommittedButNotRevealed = p.votesCommittedButNotRevealed.add(1);
            p.voters.push(msg.sender);
        }
        p.commitHashes[msg.sender] = _secretHash;

        emit VoteCommitted(_pollID, msg.sender, _secretHash);
    }

    /**
    * @notice                 Commits votes using hashes of choices and secret salts to conceal votes until reveal
    * @param _pollIDs         Array of identifers associated with target polls
    * @param _secretHashes    Array of commit keccak256 hashes of voter's choices and salts (tightly packed in this order)
    */
    function _commitVotes(bytes32[] memory _pollIDs, bytes32[] memory _secretHashes) internal
    {
        // make sure the array lengths are all the same
        require(_pollIDs.length == _secretHashes.length, "Expected as many secretHashes as pollIDs");

        // loop through arrays, committing each individual vote values
        for (uint i = 0; i < _pollIDs.length; i++) {
            _commitVote(_pollIDs[i], _secretHashes[i]);
        }
    }

    /**
    * @notice Reveals a vote. The vote choice and secret salt must correspond to a prior commitment.
    * @param _pollID     Identifer associated with target poll
    * @param _voter      The user who committed the vote
    * @param _voteOption Vote choice (0 or 1)
    * @param _salt       Secret number that was used to generate the vote commitment
    */
    function _revealVote(bytes32 _pollID, address _voter, uint _voteOption, uint _salt) internal {
        // Make sure the reveal period is active
        require(revealPeriodActive(_pollID), "Reveal period must be active");
        require(_voteOption == VOTE_AGAINST || _voteOption == VOTE_FOR, "voteOption must be 0 or 1");
        require(didCommit(_pollID, _voter), "no commitment found"); // make sure user has committed a vote for this poll
        require(!didReveal(_pollID, _voter), "already revealed"); // prevent user from revealing multiple times
        Poll storage p = pollMap[_pollID];
        bytes32 commitHash = p.commitHashes[_voter];
        require(keccak256(abi.encodePacked(_voteOption, _salt)) == commitHash, "The hash of the vote and salt (tightly packed in that order) does not match the commitment"); // compare resultant hash from inputs to original commitHash
        require(p.votesCommittedButNotRevealed > 0, "No votes left to reveal");

        if (_voteOption == VOTE_FOR) {
            p.votesFor = p.votesFor.add(1);
        } else {
            p.votesAgainst = p.votesAgainst.add(1);
        }

        p.revealedVotes[_voter] = _voteOption;
        p.didReveal[_voter] = true;
        p.votesCommittedButNotRevealed = p.votesCommittedButNotRevealed.sub(1);

        emit VoteRevealed(_pollID, commitHash, _voteOption, _voter, msg.sender, p.votesFor, p.votesAgainst, p.votesCommittedButNotRevealed);
    }

    /**
    * @notice Reveals multiple votes. All input arrays must be the same length, and the four values at any given
    *         array index constitute the information required to reveal a single vote (see `_revealVote` params)
    * @param _pollIDs     Array of identifers associated with target polls
    * @param _voters      Array of voter addresses
    * @param _voteOptions Array of vote choices (each 0 or 1)
    * @param _salts       Array of secret numbers that were used to generate the vote commitment
    */
    function _revealVotes(bytes32[] memory _pollIDs, address[] memory _voters, uint[] memory _voteOptions, uint[] memory _salts) internal {
        // Make sure the array lengths are all the same
        uint l = _pollIDs.length;
        require(l == _voteOptions.length, "Expected as many voteOptions as pollIDs");
        require(l == _salts.length, "Expected as many salts as pollIDs");
        require(l == _voters.length, "Expected as many voters as pollIDs");

        // Loop through arrays, revealing each individual vote values
        for (uint i = 0; i < l; i++) {
            _revealVote(_pollIDs[i], _voters[i], _voteOptions[i], _salts[i]);
        }
    }

    // ==================
    // ADMIN INTERFACE:
    // ==================

    /**
    * @dev Initiates a poll with canonical configured parameters at pollID emitted by PollCreated event
    * @param _commitDuration Duration after which the commit period will end, in seconds.
    *                        Or zero to have no fixed duration, relying only on _haltCommitPeriod
    * @param _revealDuration Duration after which the reveal period will end, in seconds.
    *                        Or zero to have no fixed duration, relying only on _haltRevealPeriod
    */
    function _startPoll(bytes32 _pollID, uint _commitDuration, uint _revealDuration) internal 
    returns (bytes32 pollID)
    {
        require(!pollExists(_pollID), "no such poll");
        require(_commitDuration <= MAX_COMMIT_DURATION_IN_SECONDS, "commitDuration <= 365 days");
        require(_revealDuration <= MAX_REVEAL_DURATION_IN_SECONDS, "revealDuration <= 365 days");

        pollMap[_pollID] = Poll({
            commitPeriodStartedAt: block.timestamp, // Invariant: all existing (active or inactive) Polls have a non-zero commitPeriodStartedAt
            commitDuration: _commitDuration, 
            commitsHaltedAt: 0, 
            revealDuration: _revealDuration,
            revealsHaltedAt: 0,
            votesFor: 0,
            votesAgainst: 0,
            votesCommittedButNotRevealed: 0,
            voters: new address[](0)
        });

        emit PollCreated(_pollID, msg.sender, _commitDuration, _revealDuration);
        return _pollID;
    }

    /**
    * @dev Closes the commit period, or reverts if it is not currently open.
    * @param _pollID Bytes32 identifier associated with target poll
    */
    function _haltCommitPeriod(bytes32 _pollID) internal 
    {
        require(commitPeriodActive(_pollID), "Commit period must be active");
        Poll storage p = pollMap[_pollID];
        p.commitsHaltedAt = block.timestamp;
        emit CommitPeriodHalted(_pollID, msg.sender, block.timestamp);
    }

    /**
    * @dev Closes the reveal period, or reverts if it is not currently open
    * @param _pollID Bytes32 identifier associated with target poll
    */
    function _haltRevealPeriod(bytes32 _pollID) internal 
    {
        require(revealPeriodActive(_pollID), "Reveal period must be active");
        pollMap[_pollID].revealsHaltedAt = block.timestamp;
        emit RevealPeriodHalted(_pollID, msg.sender, block.timestamp);
    }

    // ----------------
    // POLLING HELPERS:
    // ----------------

    /**
    * @dev Gets the vote counts for a poll
    *      N.B. Ensure that the reveal period is over before assuming that these results are final.
    * @param _pollID Bytes32 identifier associated with target poll
    * @return Total number of 'For' votes, 'Against' votes, and committed votes that were not revealed. (3 integers, in that order.)
    */
    function getVoteCounts(bytes32 _pollID) view public
        returns (
            uint numForVotes,
            uint numAgainstVotes,
            uint numCommittedButNotRevealedVotes) {
        Poll memory p = pollMap[_pollID]; 
        return (p.votesFor, p.votesAgainst,  p.votesCommittedButNotRevealed);
    }

    /**
    * @dev Gets the addresses that voted in a poll
    *      Unless restrictions are added to the implementing contract,
    *      the length of this list is unbounded and therefore unsuitable for examination on-chain.
    *      Ensure that the commit period is over before assuming that this list is final.
    * @param _pollID Bytes32 identifier associated with target poll
    * @return The list of addresses that voted in the poll, regardless of whether or not they
    *         revealed their vote. 
    */
    function getVoters(bytes32 _pollID) view public returns (address[] memory voters) {
        return pollMap[_pollID].voters; 
    }

    /**
    * @notice Determines if poll is over
    * @dev If neither the commit period nor the reveal period is active then we assume the poll is over
    * @return Boolean indication of whether polling period is over
    */
    function pollEnded(bytes32 _pollID) view public returns (bool ended) {
        return !commitPeriodActive(_pollID) && !revealPeriodActive(_pollID);
    }

    /**
    * @notice Returns the deadline for commits to a given poll.
    *         The commit period may be halted earlier by calls to _haltCommitPeriod().
    * @param _pollID Identifer associated with target poll
    * @return Returns the deadline at which the commit period is/was scheduled to end, or 0 if no such deadline
    *         exists/existed.
    */
    function commitDeadline(bytes32 _pollID) view public returns (uint timestamp) {
        require(pollExists(_pollID), "Poll does not exist");
        Poll memory p = pollMap[_pollID];

        if (p.commitDuration == 0) {
            return 0;
        } else {
            return p.commitPeriodStartedAt.add(p.commitDuration);
        }
    }

    /**
    * @notice Checks if the commit period is still active for the specified poll
    * @dev Checks the specified poll's commitDeadline(), and for earlier manual halting of commits
    * @param _pollID Identifer associated with target poll
    * @return Boolean indication of isCommitPeriodActive for target poll
    */
    function commitPeriodActive(bytes32 _pollID) view public returns (bool active) {
        require(pollExists(_pollID), "Poll does not exist");
        Poll memory p = pollMap[_pollID];
        bool endedEarly = (p.commitsHaltedAt != 0);
        return !endedEarly && !isExpired(commitDeadline(_pollID));
    }

    /**
    * @notice Returns the time at which a commit period started
    * @param _pollID Identifer associated with target poll
    * @return The timestamp at which the commit period started for the given poll
    */
    function commitPeriodStartedTimestamp(bytes32 _pollID) view public returns (uint timestamp) {
        require(pollExists(_pollID), "Poll does not exist");
        return pollMap[_pollID].commitPeriodStartedAt;
    }

    /**
    * @notice Returns the deadline for reveals to a given poll. This is subject to change (the reveal period
    *         may be brought forward by calls to _haltCommitPeriod()) and reveals may be halted earlier
    *         by calls to _haltRevealPeriod().
    * @param _pollID Identifer associated with target poll
    * @return Returns the deadline at which the reveal period is currently or was scheduled to end, or 0 if no
    *         such deadline exists/existed.
    */
    function revealDeadline(bytes32 _pollID) view public returns (uint timestamp) {
        require(pollExists(_pollID), "Poll does not exist");
        uint revealDuration = pollMap[_pollID].revealDuration;
        uint revealPeriodStarted = revealPeriodStartedTimestamp(_pollID);

        if ((revealDuration == 0) || (revealPeriodStarted == 0)) {
            return 0;
        } else {
            return revealPeriodStarted.add(revealDuration); // Both non-zero
        }
    }

    /**
    * @notice Checks if the reveal period is still active for the specified poll
    * @dev Checks the specified poll's revealDeadline, and for earlier manual halting of reveals
    * @param _pollID Identifer associated with target poll
    */
    function revealPeriodActive(bytes32 _pollID) view public returns (bool active) {
        require(pollExists(_pollID), "Poll does not exist");
        Poll memory p = pollMap[_pollID];
        bool endedEarly = (p.revealsHaltedAt != 0);
        return !endedEarly && !isExpired(revealDeadline(_pollID)) && !commitPeriodActive(_pollID);
    }

    /**
    * @notice Returns the time at which a reveal period started
    * @param _pollID Identifer associated with target poll
    * @return The timestamp at which the reveal period started for the given poll, or zero if it has not yet started
    */
    function revealPeriodStartedTimestamp(bytes32 _pollID) view public returns (uint timestamp) {
        require(pollExists(_pollID), "Poll does not exist");
        Poll memory p = pollMap[_pollID];

        if (p.commitsHaltedAt != 0) {
            timestamp = p.commitsHaltedAt;
        } else if (commitPeriodActive(_pollID)) {
            timestamp = 0;
        } else {
            timestamp = commitDeadline(_pollID); // Commit period has ended and was not halted, so this is non-zero
        }

        return timestamp;
    }

    /**
    * @dev Checks if user has committed for specified poll
    * @param _pollID Identifier associated with target poll
    * @param _voter Address of user to check
    * @return Boolean indication of whether user has committed
    */
    function didCommit(bytes32 _pollID, address _voter) view public returns (bool committed) {
        require(pollExists(_pollID), "Poll does not exist");
        return pollMap[_pollID].commitHashes[_voter] != bytes32(0);
    }

    /**
    @dev Checks if user has already committed and revealed for specified poll.
    @param _pollID Identifier associated with target poll
    @param _voter Address of user to check
    @return Boolean indication of whether user has revealed
    */
    function didReveal(bytes32 _pollID, address _voter) view public returns (bool revealed) {
        require(pollExists(_pollID), "Poll does not exist");
        return pollMap[_pollID].didReveal[_voter];
    }

    /**
    * @dev Returns user's revealed vote value in a specified poll. Reverts if they did not
    *      commit a vote or if they failed to reveal it.
    * @param _pollID Identifier associated with target poll
    * @param _voter Address of user to check
    * @return Whether the user has voted, whether the user's vote has been revealed, and (if revealed) the vote itself
    */
    function getVote(bytes32 _pollID, address _voter) view public returns (
      bool hasVoted,
      bool hasRevealed,
      uint vote
    ) {
      hasVoted = didCommit(_pollID, _voter);
      hasRevealed = didReveal(_pollID, _voter);

      if (hasVoted && hasRevealed) {
        vote = pollMap[_pollID].revealedVotes[_voter];
      }

      return (
        hasVoted,
        hasRevealed,
        vote
      );

    }

    /**
    * @dev Checks if a poll exists
    * @param _pollID The pollID whose existance is to be evaluated.
    * @return Boolean Indicates whether a poll exists for the provided pollID
    */
    function pollExists(bytes32 _pollID) view public returns (bool exists) {
        return (_pollID != 0) && (pollMap[_pollID].commitPeriodStartedAt > 0);
    }

    /**
    * @dev Gets the bytes32 commitHash property of target poll
    * @param _voter Address of user to check against
    * @param _pollID Identifer associated with target poll
    * @return Bytes32 hash property attached to target poll
    */
    function getCommitHash(bytes32 _pollID, address _voter) view public returns (bytes32 commitHash) {
        return pollMap[_pollID].commitHashes[_voter];
    }

    // ----------------
    // GENERAL HELPERS:
    // ----------------

    /**
    * @dev Checks if an expiration date has been reached. An expiration date of 0 will always return false.
    * @param _terminationDate Integer timestamp of date to compare current timestamp with
    * @return expired Boolean indication of whether the terminationDate has passed
    */
    function isExpired(uint _terminationDate) view public returns (bool expired) {
        return (_terminationDate > 0 && block.timestamp > _terminationDate);
    }
}
