**This is a work in progress - proceed with caution.**

`CommitRevealVoting` is a generalized imlempentation of a commit reveal voting scheme. Only binary votes (e.g. Yes or No) are currently supported.

A few differences from other commit-reveal implementations:

- We don't implement partial locking. We assume that some form of whitelisting will be used to protect against sybil attacks.
- `CommitRevealVoting` itself does not expose state changing functions (they are `internal`). We assume that these will be wrapped in an inheriting contract, and that the inheriting contract will also handle the whitelisting.
- We allow anyone to reveal a vote if they know the correct salt. This opens up possibilities for a centralised (e.g. trusted system operator) or distributed (e.g. Shamir's Secret Sharing) vote revelation.
- We index the contracts by a `bytes32` poll identifier. Inheriting contracts can use whatever index(es) they like and hash the ordered indexes into a unique `bytes32`.

`TestCommitRevealVoting` gives an example of how to use `CommitRevealVoting` with some naive whitelisting.
