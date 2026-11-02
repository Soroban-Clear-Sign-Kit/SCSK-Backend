# Architecture and Implementation Decisions

## Soroban SDK Types and Method Mappings

During implementation, the following API mappings were recorded from `@stellar/stellar-sdk` compared to the original specification:

- The specification asked for `rpc.Api.isSimulationError` and `rpc.Api.isSimulationSuccess` which have actually been deprecated or changed in recent SDKs to `rpc.Api.isSimulationError` / `rpc.Api.isSimulationRestore` and `rpc.Api.SimulateTransactionResponse` structure checking.
- The React hooks were refactored from `ClearSignProvider` to directly exposing a drop-in `ClearSignModal` that can be plugged anywhere since it reduces boilerplate.
- The spec mentioned `contract.Spec` which is loaded via `contract.Spec.fromWasm` and cached in a 64-entry LRU cache keyed by `networkPassphrase`, `contractId`, and `wasmHash` (fetched via `getContractInstance` to detect contract upgrades) to avoid redundant RPC round-trips.

## Handling of Strict TS Rules

- `exactOptionalPropertyTypes: true` forced us to rewrite object constructions to strip `undefined` keys rather than passing them implicitly, particularly in the RPC simulation options and invocation decoder inputs.

## CSS and Asset Handling

- We implemented raw CSS variables instead of depending on styled-components or Tailwind to ensure maximum compatibility for developers dropping `ClearSignModal` into diverse codebases.

## Repository Layout Deviation

- The user requested strict separation of packages into \SCSK-Backend\ and \SCSK-Frontend\ directories instead of a single monorepo at \clearsign/\.
