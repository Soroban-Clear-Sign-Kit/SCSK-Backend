# Warning Codes & Severity Reference

This document enumerates every warning code emitted by `@clearsign/core`, its fixed severity tier (`review` vs `blocked`), stable string identifier, and triggering condition.

---

## Warning Code Contract

All warning codes are defined as a TypeScript enum (`WarningCodeEnum`) and string union (`WarningCode`) in `src/errors.ts`, validated at runtime via `WarningSchema` in `src/schemas.ts`.

| Code Identifier              | Severity  | Trigger Description                                                                          | Source File                                                      |
| :--------------------------- | :-------- | :------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| `ENVELOPE_MALFORMED`         | `blocked` | Invalid Base64, bad padding, multiple operations, or not an envelope.                        | `src/envelope.ts`                                                |
| `ENVELOPE_TOO_LARGE`         | `blocked` | The XDR length exceeds `MAX_XDR_BASE64_LENGTH` (200,000 characters).                         | `src/envelope.ts`                                                |
| `NETWORK_MISMATCH`           | `blocked` | RPC network does not match the configured transaction passphrase.                            | `src/envelope.ts`, `src/preview.ts`                              |
| `TX_EXPIRED`                 | `blocked` | Timebounds on the transaction have expired relative to current time.                         | `src/envelope.ts`                                                |
| `SIGNATURE_INVALID`          | `blocked` | Envelope signature does not match envelope hash or specified network.                        | `src/envelope.ts`                                                |
| `CLASSIC_OP_NOT_DECODED`     | `review`  | The transaction contains non-Soroban operations.                                             | `src/envelope.ts`, `src/invocation.ts`                           |
| `CONTRACT_DEPLOYMENT`        | `review`  | The transaction deploys a new Soroban Wasm or Stellar Asset Contract.                        | `src/invocation.ts`                                              |
| `WASM_UPLOAD`                | `review`  | The transaction uploads executable Wasm code to the network.                                 | `src/invocation.ts`                                              |
| `SPEC_UNAVAILABLE`           | `review`  | The Wasm spec could not be downloaded, or no spec is available.                              | `src/spec.ts`, `src/policy.ts`                                   |
| `ARG_COUNT_MISMATCH`         | `blocked` | Contract spec input count does not match the provided argument count.                        | `src/invocation.ts`                                              |
| `ARG_TYPE_MISMATCH`          | `blocked` | The argument type at runtime conflicts with the contract spec type.                          | `src/invocation.ts`                                              |
| `UNSUPPORTED_SCVAL`          | `review`  | A non-standard ScVal type (e.g. ContractInstance) was passed as an argument.                 | `src/scval.ts`                                                   |
| `VALUE_TOO_DEEP`             | `review`  | Nested collections exceeded `MAX_SCVAL_DEPTH` (32).                                          | `src/scval.ts`                                                   |
| `AUTH_TREE_TOO_LARGE`        | `blocked` | Auth tree exceeds maximum nodes (256) or depth limits (16).                                  | `src/auth.ts`                                                    |
| `AUTH_EXPIRING`              | `review`  | Auth entry signature expiration is close to the current network ledger.                      | `src/auth.ts`                                                    |
| `AUTH_EXPIRED`               | `blocked` | Auth entry signature expiration has already passed the current ledger.                       | `src/auth.ts`                                                    |
| `AUTH_DUPLICATE_NONCE`       | `blocked` | Two separate auth entries exist for the same address and nonce.                              | `src/auth.ts`                                                    |
| `AUTH_UNKNOWN_CONTRACT`      | `review`  | The auth entry targets a contract we don't have a spec for.                                  | `src/auth.ts`                                                    |
| `AUTH_EXTRA_CONTRACT`        | `review`  | Auth entry authorizes a contract call that is not the top-level invoked contract.            | `src/auth.ts`                                                    |
| `AUTH_CREATES_CONTRACT`      | `review`  | The auth entry authorizes a contract deployment.                                             | `src/auth.ts`                                                    |
| `SIMULATION_FAILED`          | `blocked` | RPC simulation returned an execution failure status.                                         | `src/simulate.ts`                                                |
| `SIMULATION_UNAVAILABLE`     | `blocked` | The RPC endpoint timed out or was unreachable.                                               | `src/simulate.ts`, `src/tokens.ts`                               |
| `RESTORE_REQUIRED`           | `review`  | The contract's archived ledger state must be restored.                                       | `src/simulate.ts`                                                |
| `FEE_UNUSUALLY_HIGH`         | `review`  | The declared envelope fee is more than a configurable multiplier (10x) above minResourceFee. | `src/simulate.ts`                                                |
| `EVENT_SHAPE_UNKNOWN`        | `review`  | A balance transfer diagnostic event does not match expected layouts.                         | `src/effects.ts`, `src/events.ts`, `src/simulate.ts`             |
| `TOKEN_METADATA_UNAVAILABLE` | `review`  | Failed to retrieve token decimal/symbol metadata for balance updates.                        | `src/tokens.ts`                                                  |
| `INTENT_MISMATCH`            | `blocked` | Arguments, target, or function name mismatch against the app's declared Intent.              | `src/intent.ts`                                                  |
| `INTENT_SPEND_EXCEEDED`      | `blocked` | Negative token delta for the signer exceeds the maxSpend in the Intent.                      | `src/intent.ts`                                                  |
| `INTENT_UNEXPECTED_AUTH`     | `blocked` | Signer auth entry targets a contract not present in allowedContracts.                        | `src/intent.ts`                                                  |
| `INTENT_UNVERIFIABLE`        | `blocked` | App Intent requires named argument verification but contract spec is missing.                | `src/intent.ts`                                                  |
| `UNLIMITED_APPROVAL`         | `review`  | Token approval amount is at the `i128` maximum (`2^127 - 1`).                                | `src/policy.ts`                                                  |
| `APPROVAL_NEW_SPENDER`       | `review`  | Token approval targets a spender address not present in `knownSpenders`.                     | `src/policy.ts`                                                  |
| `TRANSFER_FROM`              | `review`  | Invocation executes `transfer_from` using a delegated token allowance.                       | `src/policy.ts`                                                  |
| `ADMIN_CHANGE`               | `blocked` | Invocation modifies contract administrator or ownership privileges.                          | `src/policy.ts`                                                  |
| `CONTRACT_WASM_UPDATE`       | `blocked` | Invocation updates or replaces executable contract Wasm code.                                | `src/policy.ts`                                                  |
| `INTERNAL_ERROR`             | `blocked` | Hard unhandled exception within the clear-sign build process.                                | `src/preview.ts`, `src/auth.ts`, `src/scval.ts`, `src/policy.ts` |
