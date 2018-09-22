pragma solidity ^0.4.24;
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

// TODO revealDeadline -> revealDuration (short circuited by complete reveal)
//      RevealPeriodStarted events per Greg's API spec - probably doesn't make sense to make these here but could the instrument sensibly make some?
//      allow you to start the reveal period from a function call
//      allow you to end the reveal period from a function call
//      place restrictions on who can start a new poll? I.e. instruments. Requires new RBAC role!
contract CommitRevealVoting {
    using SafeMath for uint;

    // ============
    // EVENTS:
    // ============

    event VoteCommitted(bytes32 indexed pollID, address indexed voter, bytes32 indexed secretHash);
    event VoteRevealed(bytes32 indexed pollID, bytes32 indexed secretHash, uint indexed choice, address voter, address revealer, uint votesFor, uint votesAgainst);
    event PollCreated(bytes32 indexed pollID, address creator, uint commitDeadline, uint revealDeadline);
    event CommitPeriodHalted(bytes32 indexed pollID, address haltedBy, uint timestamp);
    event RevealPeriodHalted(bytes32 indexed pollID, address haltedBy, uint timestamp);

    // ============
    // DATA STRUCTURES:
    // ============
    struct Poll {
        uint commitDeadline;  // the commit period will end at this time if it does not end earlier
        uint commitsHaltedAt; // the time that the commit period ended, if different from commitDeadline
        uint revealDuraton;   // the maxiumum amount of time (in seconds) to allow for vote revelation following the end of the commit period
        uint revealDeadline;  // the reveal period will end at this time if it does not end earlier (subject to change if the commit period ends early)
        uint revealsHaltedAt; // the time that the reveal period ended, if different from revealDeadline
        uint votesFor;	      // tally of votes supporting proposal
        uint votesAgainst;    // tally of votes countering proposal
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
        require(commitPeriodActive(_pollID));
        // prevent user from committing to zero node placeholder
        require(_pollID != 0);

        // prevent user from committing a secretHash of 0
        require(_secretHash != 0);

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
    function _commitVotes(bytes32[] _pollIDs, bytes32[] _secretHashes) internal
    {
        // make sure the array lengths are all the same
        require(_pollIDs.length == _secretHashes.length);

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
        require(revealPeriodActive(_pollID));
        require(_voteOption == VOTE_AGAINST || _voteOption == VOTE_FOR, "voteOption must be 0 or 1");
        require(didCommit(_pollID, _voter), "no commitment found"); // make sure user has committed a vote for this poll
        require(!didReveal(_pollID, _voter), "already revealed"); // prevent user from revealing multiple times
        Poll storage p = pollMap[_pollID];
        bytes32 commitHash = p.commitHashes[_voter];
        require(keccak256(abi.encodePacked(_voteOption, _salt)) == commitHash, "The hash of the vote and salt (tighly packed in taht order) does not match the commitment"); // compare resultant hash from inputs to original commitHash
        require(p.votesCommittedButNotRevealed > 0);

        if (_voteOption == VOTE_FOR) {
            p.votesFor = p.votesFor.add(1);
        } else {
            p.votesAgainst = p.votesAgainst.add(1);
        }

        p.revealedVotes[_voter] = _voteOption;
        p.didReveal[_voter] = true;
        p.votesCommittedButNotRevealed = p.votesCommittedButNotRevealed.sub(1);

        emit VoteRevealed(_pollID, commitHash, _voteOption, _voter, msg.sender, p.votesFor, p.votesAgainst);
    }

    /**
    * @notice Reveals multiple votes. All input arrays must be the same length, and the four values at any given
    *         array index constitute the information required to reveal a single vote (see `_revealVote` params)
    * @param _pollIDs     Array of identifers associated with target polls
    * @param _voters      Array of voter addresses
    * @param _voteOptions Array of vote choices (each 0 or 1)
    * @param _salts       Array of secret numbers that were used to generate the vote commitment
    */
    function _revealVotes(bytes32[] _pollIDs, address[] _voters, uint[] _voteOptions, uint[] _salts) internal {
        // Make sure the array lengths are all the same
        uint l = _pollIDs.length;
        require(l == _voteOptions.length);
        require(l == _salts.length);
        require(l == _voters.length);

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
    * @param _commitDuration Length of desired commit period in seconds
    * @param _revealDuration Length of desired reveal period in seconds
    */
    function _startPoll(bytes32 _pollID, uint _commitDuration, uint _revealDuration) internal 
    returns (bytes32 pollID)
    {
        require(!pollExists(_pollID), "no such poll");
        require(_commitDuration > 0 && _commitDuration <= MAX_COMMIT_DURATION_IN_SECONDS, "0 < commitDuration <= 365 days");
        require(_revealDuration > 0 && _revealDuration <= MAX_REVEAL_DURATION_IN_SECONDS, "0 < revealDuration <= 365 days");
        uint commitDeadline = block.timestamp.add(_commitDuration);
        uint revealDeadline = commitDeadline.add(_revealDuration);
        assert(commitDeadline > 0); // Redundant "Double Check" because we rely on a non-zero value implying poll existence

        pollMap[_pollID] = Poll({
            commitDeadline: commitDeadline, // Invariant: all existing (active or inactive) Polls have a non-zero commitDeadline
            commitsHaltedAt: 0, 
            revealDuraton: _revealDuration,
            revealDeadline: revealDeadline,
            revealsHaltedAt: 0,
            votesFor: 0,
            votesAgainst: 0,
            votesCommittedButNotRevealed: 0,
            voters: new address[](0)
        });

        emit PollCreated(_pollID, msg.sender, commitDeadline, revealDeadline);
        return _pollID;
    }

    /**
    * @dev Closes the commit period, or reverts if it is not currently open. Adjsuts the deadline for
    * the reveal period to keep the reveal period duration unchanged.
    * @param _pollID Bytes32 identifier associated with target poll
    */
    function _haltCommitPeriod(bytes32 _pollID) internal 
    {
        require(commitPeriodActive(_pollID));
        Poll storage p = pollMap[_pollID];
        p.commitsHaltedAt = block.timestamp;
        p.revealDeadline = block.timestamp.add(p.revealDuraton);
        emit CommitPeriodHalted(_pollID, msg.sender, block.timestamp);
    }

    /**
    * @dev Closes the reveal period, or reverts if it is not currently open
    * @param _pollID Bytes32 identifier associated with target poll
    */
    function _haltRevealPeriod(bytes32 _pollID) internal 
    {
        require(revealPeriodActive(_pollID));
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
    function getVoters(bytes32 _pollID) view public returns (address[] voters) {
        return pollMap[_pollID].voters; 
    }

    /**
    * @notice Determines if poll is over
    * @dev Checks isExpired for specified poll's revealDeadline
    * @return Boolean indication of whether polling period is over
    */
    function pollEnded(bytes32 _pollID) view public returns (bool ended) {
        return !commitPeriodActive(_pollID) && !revealPeriodActive(_pollID);
    }

    /**
    * @notice Checks if the commit period is still active for the specified poll
    * @dev Checks the specified poll's commitDeadline, and for earlier manual halting of commits
    * @param _pollID Identifer associated with target poll
    * @return Boolean indication of isCommitPeriodActive for target poll
    */
    function commitPeriodActive(bytes32 _pollID) view public returns (bool active) {
        require(pollExists(_pollID));
        Poll memory p = pollMap[_pollID];
        bool endedEarly = (p.commitsHaltedAt != 0);
        return !endedEarly && !isExpired(p.commitDeadline);
    }

    /**
    * @notice Checks if the reveal period is still active for the specified poll
    * @dev Checks the specified poll's revealDeadline, and for earlier manual halting of reveals
    * @param _pollID Identifer associated with target poll
    */
    function revealPeriodActive(bytes32 _pollID) view public returns (bool active) {
        require(pollExists(_pollID));
        Poll memory p = pollMap[_pollID];
        bool endedEarly = (p.revealsHaltedAt != 0);
        return !endedEarly && !isExpired(p.revealDeadline) && !commitPeriodActive(_pollID);
    }

    /**
    * @dev Checks if user has committed for specified poll
    * @param _pollID Identifier associated with target poll
    * @param _voter Address of user to check
    * @return Boolean indication of whether user has committed
    */
    function didCommit(bytes32 _pollID, address _voter) view public returns (bool committed) {
        require(pollExists(_pollID));
        return pollMap[_pollID].commitHashes[_voter] != bytes32(0);
    }

    /**
    @dev Checks if user has already committed and revealed for specified poll.
    @param _pollID Identifier associated with target poll
    @param _voter Address of user to check
    @return Boolean indication of whether user has revealed
    */
    function didReveal(bytes32 _pollID, address _voter) view public returns (bool revealed) {
        require(pollExists(_pollID));
        return pollMap[_pollID].didReveal[_voter];
    }

    /**
    * @dev Returns user's revealed vote value in a specified poll. Reverts if they did not
    *      commit a vote or if they failed to reveal it.
    * @param _pollID Identifier associated with target poll
    * @param _voter Address of user to check
    * @return Whether the user has voted, revealed and the vote itself
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
        return (_pollID != 0) && (pollMap[_pollID].commitDeadline > 0);
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
    * @dev Checks if an expiration date has been reached
    * @param _terminationDate Integer timestamp of date to compare current timestamp with
    * @return expired Boolean indication of whether the terminationDate has passed
    */
    function isExpired(uint _terminationDate) view public returns (bool expired) {
        return (block.timestamp > _terminationDate);
    }
}
