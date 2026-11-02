# Policy Layer & Built-In Rules

`@clearsign/core` provides a pluggable policy engine (`src/policy.ts`) that evaluates a decoded `Invocation` (or `PolicyContext`) against an ordered list of security rules and returns deterministically ordered warnings (`blocked` before `review`, preserving rule evaluation order within each severity tier).

---

## Core Interfaces

```typescript
export interface PolicyWarning {
  code: WarningCode;
  ruleId?: string;
  severity: "review" | "blocked";
  message: string;
  path?: string;
}

export interface PolicyContext {
  invocation: Invocation;
  knownSpenders?: ReadonlyArray<string> | ReadonlySet<string>;
  signerAddress?: string;
  auth?: ReadonlyArray<AuthEntry>;
  effects?: ReadonlyArray<BalanceDelta>;
}

export interface Rule {
  id: string;
  defaultSeverity?: "review" | "blocked";
  evaluate(ctx: PolicyContext): PolicyWarning[];
}
```

---

## Built-In Rules & Rationale

`BUILTIN_RULES` runs six built-in rules in canonical order:

| #   | Rule ID                    | Warning Code           | Default Severity | Trigger Condition                                                                                                                                      | Security Rationale                                                                                                                                                                    |
| --- | -------------------------- | ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `unlimited-approval`       | `UNLIMITED_APPROVAL`   | `review`         | `approve` or `increase_allowance` with `amount >= I128_MAX` ($2^{127} - 1 = \text{170141183460469231731687303715884105727}$) or raw undecodable amount | Granting an unbounded `i128::MAX` allowance exposes the user's entire current and future token balance to the spender contract if it is ever compromised.                             |
| 2   | `new-spender-approval`     | `APPROVAL_NEW_SPENDER` | `review`         | `approve` or `increase_allowance` (with non-zero amount) where `spender` is absent from `ctx.knownSpenders`                                            | Approving a previously unseen spender address is a primary phishing vector; failing closed when `knownSpenders` is empty or omitted forces explicit review of the recipient contract. |
| 3   | `transfer-from`            | `TRANSFER_FROM`        | `review`         | `functionName === "transfer_from"`                                                                                                                     | `transfer_from` spends a delegated token allowance on behalf of another address (`from`), which behaves differently from a direct `transfer` initiated by the token holder.           |
| 4   | `admin-change`             | `ADMIN_CHANGE`         | `blocked`        | `functionName` in `set_admin`, `transfer_admin`, `change_admin`, `update_admin`, `set_owner`, `transfer_ownership`, `grant_role`                       | Handing over administrative control or mint/clawback privileges is an irreversible governance action that standard user wallets should block unless explicitly overridden.            |
| 5   | `wasm-update`              | `CONTRACT_WASM_UPDATE` | `blocked`        | `functionName` in `update_current_contract_wasm`, `upgrade`, `upgrade_wasm`, `update_wasm`, `set_wasm`, or `contractId === "Upload"`                   | Replacing a live contract's Wasm executable code alters all future behavior of the contract and invalidates previously audited specs; blocked by default for end-user signing.        |
| 6   | `unknown-function-no-spec` | `SPEC_UNAVAILABLE`     | `review`         | `invocation.specSource === "none"` (for contract calls) or `functionName` is `"Unknown"` / empty                                                       | Without a verified contract spec (`wasm`, `injected`, or `sac-builtin`), argument names and user-defined types cannot be verified, so the user must review raw positional values.     |

---

## Policy Configuration & Override Semantics

`evaluatePolicy(input, config)` accepts an optional `PolicyConfig`:

```typescript
export interface PolicyConfig {
  rules?: ReadonlyArray<Rule>;
  severities?: Record<string, PolicySeverityOption | RuleOverride>;
  overrides?: Record<string, PolicySeverityOption | RuleOverride>;
  allowSeverityDowngrade?: boolean;
  allowUnsafeOverrides?: boolean;
  allowLoweringSeverity?: boolean;
  failClosed?: boolean;
}
```

1. **Adding Custom Rules**: Custom `Rule` objects passed in `config.rules` are evaluated after `BUILTIN_RULES`.
2. **Raising Severity (Always Permitted)**: Any rule with default severity `"review"` (such as `unlimited-approval` or `new-spender-approval`) can be raised to `"blocked"` via `config.severities` / `config.overrides` without any extra flag.
3. **Lowering Severity (Requires Explicit Override Flag)**:
   - Attempting to lower a rule's default severity (`"blocked"` -> `"review"`, or `"review"` / `"blocked"` -> `"ok"` / `"off"` / `enabled: false`) **without** `allowSeverityDowngrade: true` (or `allowUnsafeOverrides: true` / `allowLoweringSeverity: true`) **fails closed** and retains the rule's default severity.
   - When `allowSeverityDowngrade: true` is set (either globally on `PolicyConfig` or locally on the `RuleOverride` entry), the severity is lowered or suppressed as requested.
4. **Fail-Closed Default**:
   - By default (`failClosed: true`), if `evaluatePolicy` receives a `null`, `undefined`, or malformed invocation context, or if any rule throws an exception during `evaluate(ctx)`, it emits a `"blocked"` warning with code `"INTERNAL_ERROR"`.

---

## Pre-Existing & Policy Warning Inventory Across the Codebase

| Warning Code                 | Default Severity | Produced In                                                                                                                                |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENVELOPE_MALFORMED`         | `blocked`        | `src/envelope.ts` (`parseEnvelope`)                                                                                                        |
| `ENVELOPE_TOO_LARGE`         | `blocked`        | `src/envelope.ts` (`parseEnvelope`)                                                                                                        |
| `NETWORK_MISMATCH`           | `blocked`        | `src/envelope.ts` (`parseEnvelope`), `src/preview.ts` (`buildPreview`)                                                                     |
| `TX_EXPIRED`                 | `blocked`        | `src/envelope.ts` (`parseEnvelope`)                                                                                                        |
| `SIGNATURE_INVALID`          | `blocked`        | `src/envelope.ts` (`parseEnvelope`)                                                                                                        |
| `CLASSIC_OP_NOT_DECODED`     | `review`         | `src/envelope.ts` (`parseEnvelope`), `src/invocation.ts` (`decodeInvocation`)                                                              |
| `CONTRACT_DEPLOYMENT`        | `review`         | `src/invocation.ts` (`decodeInvocation`)                                                                                                   |
| `WASM_UPLOAD`                | `review`         | `src/invocation.ts` (`decodeInvocation`)                                                                                                   |
| `SPEC_UNAVAILABLE`           | `review`         | `src/spec.ts` (`loadSpec`), `src/policy.ts` (`unknownFunctionNoSpecRule`)                                                                  |
| `ARG_COUNT_MISMATCH`         | `blocked`        | `src/invocation.ts` (`decodeInvocation`)                                                                                                   |
| `ARG_TYPE_MISMATCH`          | `blocked`        | `src/invocation.ts` (`decodeInvocation`)                                                                                                   |
| `UNSUPPORTED_SCVAL`          | `review`         | `src/scval.ts` (`decodeScVal`)                                                                                                             |
| `VALUE_TOO_DEEP`             | `review`         | `src/scval.ts` (`decodeScVal`)                                                                                                             |
| `AUTH_TREE_TOO_LARGE`        | `blocked`        | `src/auth.ts` (`decodeAuthEntries`)                                                                                                        |
| `AUTH_EXPIRING`              | `review`         | `src/auth.ts` (`decodeAuthEntries`)                                                                                                        |
| `AUTH_EXPIRED`               | `blocked`        | `src/auth.ts` (`decodeAuthEntries`)                                                                                                        |
| `AUTH_DUPLICATE_NONCE`       | `blocked`        | `src/auth.ts` (`decodeAuthEntries`)                                                                                                        |
| `AUTH_UNKNOWN_CONTRACT`      | `review`         | `src/auth.ts` (`decodeAuthEntries`)                                                                                                        |
| `AUTH_EXTRA_CONTRACT`        | `review`         | `src/auth.ts` (`decodeAuthEntries`)                                                                                                        |
| `AUTH_CREATES_CONTRACT`      | `review`         | `src/auth.ts` (`decodeAuthEntries`)                                                                                                        |
| `SIMULATION_FAILED`          | `blocked`        | `src/simulate.ts` (`simulateTransaction`, `summarizeSimulation`)                                                                           |
| `SIMULATION_UNAVAILABLE`     | `blocked`        | `src/simulate.ts` (`simulateTransaction`, `summarizeSimulation`), `src/tokens.ts` (`resolveTokenMetadata`)                                 |
| `RESTORE_REQUIRED`           | `review`         | `src/simulate.ts` (`simulateTransaction`, `summarizeSimulation`)                                                                           |
| `FEE_UNUSUALLY_HIGH`         | `review`         | `src/simulate.ts` (`simulateTransaction`)                                                                                                  |
| `EVENT_SHAPE_UNKNOWN`        | `review`         | `src/effects.ts` (`extractTokenEffects`), `src/events.ts` (`decodeEvent`), `src/simulate.ts` (`summarizeSimulation`)                       |
| `TOKEN_METADATA_UNAVAILABLE` | `review`         | `src/tokens.ts` (`resolveTokenMetadata`)                                                                                                   |
| `INTENT_MISMATCH`            | `blocked`        | `src/intent.ts` (`verifyIntent`)                                                                                                           |
| `INTENT_SPEND_EXCEEDED`      | `blocked`        | `src/intent.ts` (`verifyIntent`)                                                                                                           |
| `INTENT_UNEXPECTED_AUTH`     | `blocked`        | `src/intent.ts` (`verifyIntent`)                                                                                                           |
| `INTENT_UNVERIFIABLE`        | `blocked`        | `src/intent.ts` (`verifyIntent`)                                                                                                           |
| `UNLIMITED_APPROVAL`         | `review`         | `src/policy.ts` (`unlimitedApprovalRule`)                                                                                                  |
| `APPROVAL_NEW_SPENDER`       | `review`         | `src/policy.ts` (`newSpenderApprovalRule`)                                                                                                 |
| `TRANSFER_FROM`              | `review`         | `src/policy.ts` (`transferFromRule`)                                                                                                       |
| `ADMIN_CHANGE`               | `blocked`        | `src/policy.ts` (`adminChangeRule`)                                                                                                        |
| `CONTRACT_WASM_UPDATE`       | `blocked`        | `src/policy.ts` (`wasmUpdateRule`)                                                                                                         |
| `INTERNAL_ERROR`             | `blocked`        | `src/preview.ts` (`buildPreview`), `src/auth.ts` (`decodeAuthEntries`), `src/scval.ts` (`decodeScVal`), `src/policy.ts` (`evaluatePolicy`) |
