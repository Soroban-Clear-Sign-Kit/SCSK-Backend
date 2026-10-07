# Progress Log

## Phase 0
- Initialized git and pnpm workspace.
- Scaffolding `packages/core` and `packages/react`.
- Dependencies pinned and configured.
- Checked and confirmed SDK APIs.
- Pushed to github.

## Phase 1
- Created `envelope.ts`, `limits.ts`, `errors.ts`.
- Implemented robust envelope parsing, bounded XDR size, and extracted fee-bump properties.
- Wrote and passed comprehensive unit tests covering malformed base64, incorrect network passphrase, expired time bounds, and classic operations.
- Handled Muxed account parsing via `MuxedAccount` and `baseAccount`.
- Pushed Phase 1 commit to github.

## Phase 2
- Created `types.ts` defining `DisplayValue`, `DecodedArg`, and `Invocation`.
- Built `spec.ts` to fetch Wasm and parse `contract.Spec` with in-memory LRU caching per `networkPassphrase` + `wasmHash`.
- Added support for built-in SEP-41 SAC parsing without needing a network Spec.
- Implemented `scval.ts` robust AST decoder supporting full recursive `ScVal` to Native and `DisplayValue` mapped decoding, with protection against nested attacks via depth checks.
- Wrote `invocation.ts` to decode `invokeHostFunction` payloads against the parsed specs, extracting types and reporting type mismatches or unknown methods gracefully.
- All 25 Phase 2 tests passed on Vitest.
- Pushed Phase 2 commits to github.

## Phase 3
- Implemented `auth.ts` to decode `SorobanAuthorizationEntry` trees exactly as specified in the PDF, handling credentials, recursive sub-invocations, and node limits.
- Updated `types.ts` to include `AuthEntry` and `AuthNode`.
- Created basic unit test for `auth.ts`.
- Note: Previous iterations deviated from the PDF phases for Phase 3 and 4 by implementing `events.ts` and `state.ts`. We have realigned with the PDF and implemented `auth.ts` correctly as Phase 3.
- Committed and pushed Phase 3 to github.

## Phase 4
- Implemented `simulate.ts`, `effects.ts`, and `tokens.ts` for simulation and effects, fully replacing the invalid `Phase 4` that was out of sync with the PDF.
- Added `BalanceDelta` interface to `types.ts`.
- Simulated transactions with RPC timeouts, extracted fee, return values, and auth.
- Parsed SEP-41 token movements (`transfer`, `mint`, `burn`, `clawback`) from diagnostic events and aggregated balance deltas.
- Resolved decimals and symbols from cached read-only simulations and safely formatted token amounts using precise string math.
## Phase 5
- Implemented `risk.ts` to compute a single risk level from the full list of warnings, adhering to the fixed severity table mapping.
- Implemented `intent.ts` for intent verification, which compares normalized values (bigints, numbers, strings, addresses).
- Handled `INTENT_MISMATCH`, `INTENT_SPEND_EXCEEDED`, `INTENT_UNEXPECTED_AUTH`, and `INTENT_UNVERIFIABLE` checks.
- Created table-driven unit tests for risk calculation and intent verification, covering swapped recipients and amounts off by one.
- Pushed Phase 5 to github.
