# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pluggable policy layer (`evaluatePolicy`, `Rule`, `PolicyConfig`, `BUILTIN_RULES`) in `src/policy.ts` and `docs/RULES.md` with built-in rules for unlimited `i128` approvals (`UNLIMITED_APPROVAL`), approvals to a new spender (`APPROVAL_NEW_SPENDER`), `transfer_from` (`TRANSFER_FROM`), admin changes (`ADMIN_CHANGE`), contract Wasm updates (`CONTRACT_WASM_UPDATE`), and unknown functions with no spec (`SPEC_UNAVAILABLE`).
- `summarizeSimulation(response)` and `SimulationSummary` (plus `SimulationResourceUsage`, `SimulationRestorePreamble`, and `SimulationStateChange`) to normalize RPC simulation responses, resource usage, restore preambles, authorization entries, events, and state changes, with JSON simulation payload support in `decodeEvent` and `decodeLedgerEntry`.
- `network.rpcMatches` and `network.signatureBound` verification flags on `ClearSignPreview`, plus `SIGNATURE_INVALID` warning code for mismatched envelope signatures.
- `options.now` support on `parseEnvelope` and `buildPreview` for deterministic `TX_EXPIRED` checks.
- Typed XDR accessor module (`src/accessors.ts`) for safe navigation of `js-xdr` and parsed simulation payloads.
- Package metadata (`license`, `engines`, `sideEffects`, `keywords`) and `check`, `format`, `lint:fix`, and `prepublishOnly` scripts.
- Seeded PRNG mutation fuzz tests for `parseEnvelope`, fixture-backed `buildPreview` tests, and expanded unit coverage across `accessors`, `auth`, `effects`, `invocation`, and `simulate`.

### Changed

- Moved `@stellar/stellar-sdk` (`17.2.1`) to `peerDependencies` and `devDependencies` to avoid duplicate SDK instances in consumer bundles.
- Internal error stacks in `buildPreview` are logged only when `options.debug` is `true`.
- Live testnet integration suite is gated on `STELLAR_RPC_URL`.

### Fixed

- Unwrapped `createContract` and `_attributes` payloads in `decodeInvocation` for `hostFunctionTypeCreateContract`.
- Aligned `SECURITY-MODEL.md`, `README.md`, `docs/API.md`, `docs/DECISIONS.md`, and `docs/BACKLOG.md` with the current implementation.

## [0.1.0] - 2026-10-08

### Added

- Initial open-source release of the Soroban Clear-Sign Kit backend engine (`@clearsign/core`).
- Support for safe parsing of Soroban XDR envelopes and fee-bumps.
- AST generation and `DisplayValue` mapping from raw `ScVal`s using Stellar contract specs.
- Secure event and token movement simulation via Soroban RPC.
- Deep nested authorization tree extraction.
- Intent verification and fail-closed risk analysis engine with 30 distinct warning codes.
