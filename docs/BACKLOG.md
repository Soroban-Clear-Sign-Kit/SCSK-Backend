# Seed Backlog

These items are intended to be opened as scoped issues on the repository after the MVP is completed.

## 1. Human-readable labels for common SEP-41 read functions
- **Acceptance Criteria**: When a transaction simulates read functions like `balance()`, `decimals()`, `name()`, `symbol()`, or `allowance()`, the summary outputs a human-readable description (e.g., "Reads the balance of account X on token Y") instead of raw decoded args.
- **Files to Touch**: `packages/core/src/summary.ts`

## 2. Localization support for summary lines
- **Acceptance Criteria**: The summary generator accepts a `locale` argument. A static string table is provided for English (`en`). All generated summary texts fetch from this string table rather than hardcoded strings.
- **Files to Touch**: `packages/core/src/summary.ts`, `packages/core/src/locales/en.ts`

## 3. Optional Vue wrapper
- **Acceptance Criteria**: A new package `@clearsign/vue` is created containing a Vue 3 component `ClearSignModal.vue` and a `useClearSign` composable. It must provide identical props and functionality to the React version.
- **Files to Touch**: `packages/vue/*`, `pnpm-workspace.yaml`

## 4. Improve decoding display for `create-contract-v2`
- **Acceptance Criteria**: When decoding `create-contract-v2` constructor arguments, parse the `args` array into `DisplayValue` instead of rendering raw bytes, utilizing standard Soroban `scval` conversions if possible.
- **Files to Touch**: `packages/core/src/invocation.ts`

## 5. Additional mainnet fixtures
- **Acceptance Criteria**: Provide at least 5 new recorded fixtures of complex mainnet transactions (e.g., DeFi swaps, AMM liquidity provision) and unit tests asserting their successful decode and simulation using `buildPreview()`.
- **Files to Touch**: `packages/core/test/fixtures/*`, `packages/core/test/integration.test.ts`
