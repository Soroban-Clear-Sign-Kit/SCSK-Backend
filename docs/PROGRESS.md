# Progress Log

## Phase 0: Environment and Repository Bootstrap

- **Status:** Complete
- **What was built:** Initialized monorepo with `core` and `react` workspaces using pnpm. Configured `tsup`, `vitest`, `eslint`, and strict TypeScript. Added GitHub Actions CI. Confirmed `@stellar/stellar-sdk` types.

## Phase 1: Safe Envelope Intake

- **Status:** Complete
- **What was built:** Implemented `parseEnvelope` in `envelope.ts` to decode standard and fee-bump transactions, validate timebounds, and check the network passphrase. Implemented constants in `limits.ts` and warning codes in `errors.ts`.

## Phase 2: Invocation and Argument Decoding

- **Status:** Complete
- **What was built:** Created `scval.ts` for recursive ScVal AST to DisplayValue mapping, `invocation.ts` for decoding `invokeHostFunction`, and `spec.ts` for fetching and caching contract Wasm specs.

## Phase 3: Authorization Tree

- **Status:** Complete
- **What was built:** Implemented `auth.ts` to recursively decode `SorobanAuthorizationEntry` trees, verifying expirations, duplicates, and marking entries that require the transaction signer's signature.

## Phase 4: Simulation and Effects

- **Status:** Complete
- **What was built:** Created `simulate.ts` to run transactions through the RPC simulation endpoint. Added `effects.ts` to extract token movements from diagnostic events, and `tokens.ts` to resolve symbol/decimals metadata.

## Phase 5: Risk Engine and Intent Verification

- **Status:** Complete
- **What was built:** Built `intent.ts` to compare normalized app-provided intents against parsed arguments. Added `risk.ts` to derive a final `ok | review | blocked` risk level from warnings.

## Phase 6: Sanitization, Summary, and buildPreview

- **Status:** Complete
- **What was built:** Implemented `sanitize.ts` to strip control characters and bidi overrides. Added `summary.ts` to generate plain-English explanations. Orchestrated all phases in `preview.ts` (`buildPreview`).

## Phase 7: React Package

- **Status:** Complete
- **What was built:** Created `@clearsign/react` providing `useClearSign`, `withClearSign`, and the drop-in `ClearSignModal` component with CSS modules and accessibility features.

## Phase 8: Fixture Contract and Testnet Integration

- **Status:** Complete
- **What was built:** Deployed a Rust test contract to Soroban Testnet. Generated transaction fixtures and mocked RPC responses for tests. CI tests run perfectly against them.

## Phase 9: Documentation, Demo, and Release

- **Status:** Complete
- **What was built:** Wrote full documentation (`API.md`, `SECURITY-MODEL.md`), setup repository files (`CONTRIBUTING.md`, etc.), implemented a Vite demo application, and successfully executed the final QA checklist. Code is fully typed and ready for publication.

## Seed Backlog

- **Status:** Complete
- **What was built:** Added decoding of create-contract-v2 constructor arguments, implemented Vue wrapper in frontend, fetched mainnet fixtures, localized summaries.
