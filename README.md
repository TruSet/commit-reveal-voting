This is a generalized imlempentation of a commit reveal voting scheme

A few differences from other implementations
- We don't implement partial locking, using a KYC'ed whitelist to protect against sybil attacks instead
- We allow anyone to reveal a vote if they have the correct salt, evetually planning to use Shamir's secret sharing to distribute the salts
- We index the contracts by a bytes32 poll identifier
