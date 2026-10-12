# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `options.rpcTimeoutMs` is now honoured by the network check, simulation, token metadata and latest-ledger calls.
- `timeoutMs` option on `simulateTransaction` and `resolveTokenMetadata`.
- `clearTokenMetadataCache()` and a 256-entry bound on the token metadata cache.
- `partitionWarnings()`, `withTimeout()` and `stripUndefined()` helpers.
- Coverage thresholds, Dependabot, `.editorconfig` and `check`/`format`/`lint:fix` scripts.

### Changed

- Internal error stacks are only logged when `options.debug` is true.
- Events with an invalid emitting contract ID now produce an `EVENT_SHAPE_UNKNOWN` warning instead of console output.

### Fixed

- Event contract IDs that are not 32 bytes are rejected rather than encoded into a bogus address.
- `getNetwork` and `getLatestLedger` can no longer hang `buildPreview` indefinitely.
- Security docs now describe the actual `ok` / `review` / `blocked` risk levels.

## [0.1.0] - 2026-10-08

### Added

- Initial open-source release of the Soroban Clear-Sign Kit backend engine (`@clearsign/core`).
- Support for safe parsing of Soroban XDR envelopes and fee-bumps.
- AST generation and `DisplayValue` mapping from raw `ScVal`s using Stellar contract specs.
- Secure event and token movement simulation via Soroban RPC.
- Deep nested authorization tree extraction.
- Intent verification and fail-closed risk analysis engine with 30 distinct warning codes.
