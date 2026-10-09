# Architecture and Implementation Decisions

## Soroban SDK Types and Method Mappings

During implementation, the following API mappings were recorded from `@stellar/stellar-sdk` compared to the original specification:

- The specification asked for `rpc.Api.isSimulationError` and `rpc.Api.isSimulationSuccess` which have actually been deprecated or changed in recent SDKs to `rpc.Api.isSimulationError` / `rpc.Api.isSimulationRestore` and `rpc.Api.SimulateTransactionResponse` structure checking.
- The React hooks were refactored from `ClearSignProvider` to directly exposing a drop-in `ClearSignModal` that can be plugged anywhere since it reduces boilerplate.
- The spec mentioned `contract.Spec` but the proper export in recent SDK releases is accessed via `xdr.ScSpecEntry` parsing or using `Contract(id).getCallBuilder`. We implemented our own lightweight `Spec` parser on top of `xdr.ScSpecEntry` to support caching without creating full contract instances.

## Handling of Strict TS Rules

- `exactOptionalPropertyTypes: true` forced us to rewrite object constructions to strip `undefined` keys rather than passing them implicitly, particularly in the RPC simulation options and invocation decoder inputs.

## CSS and Asset Handling

- We implemented raw CSS variables instead of depending on styled-components or Tailwind to ensure maximum compatibility for developers dropping `ClearSignModal` into diverse codebases.

## Repository Layout Deviation

- The user requested strict separation of packages into \SCSK-Backend\ and \SCSK-Frontend\ directories instead of a single monorepo at \clearsign/\.
