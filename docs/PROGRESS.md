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
- Created `events.ts` to decode contract events emitted in transactions. It parses topics and data leveraging `contract.Spec` when a matching event signature is found, and falls back to raw decoding.
- Created `state.ts` to parse Ledger Entry overrides and contract state modifications, resolving nested structure types.
- Exported all core modules through `index.ts`.
- 100% test pass rate for new logic (29/29 total tests passing for core).
- Committed Phase 3 to github.

## Phase 4
- Built `ClearSignProvider` React context to supply RPC and Network configs to child components.
- Developed the `useClearSign` hook for decoding envelopes and their internal contract invocations synchronously.
- Developed the `useSimulateTransaction` hook which queries the RPC server, executes the payload, and dynamically decodes resulting diagnostic events and ledger state mutations seamlessly into human-readable objects.
- Integrated Vitest with `jsdom` and React Testing Library to validate the components.
- Pushed Phase 4 to github.
