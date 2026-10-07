# Security Model

This library proves what a transaction does according to the provided simulation and contract specifications.
It does NOT verify the correctness of the RPC server or the contract source code.

Risk is fail-closed: anything the library cannot decode or verify is flagged as blocked or review, never shown as safe.
