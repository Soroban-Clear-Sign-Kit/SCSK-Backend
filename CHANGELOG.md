# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
