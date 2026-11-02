# Soroban Clear-Sign Kit (SCSK) Security Model

The Soroban Clear-Sign Kit (SCSK) is designed with a strict, fail-closed security architecture. The goal is to eliminate blind-signing on the Stellar network by providing a deterministic, type-safe, and verifiable summary of every transaction before it is submitted.

Every security claim in this model has a permanent identifier (`SM-01`, `SM-02`, etc.) and is verified by automated unit and property-based regression tests. Compliance is strictly enforced in CI via `pnpm run check:security-model`.

---

## Security Claims Catalog

| Claim ID  | Title                                                      | Summary & Enforcement                                                                                                                                                                                                                                                                                                                             | Covering Tests                                                                                                                                                                                                                                 |
| :-------- | :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SM-01** | **Fail-Closed by Default**                                 | Any unknown elements, malformed envelopes, invalid XDR, truncated payloads, or recursion limits abort immediately and return a non-ok, unapproved status. The system never throws uncaught exceptions on hostile remote data or assumes unparsed buffers are safe.                                                                                | [`test/unit/envelope.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/envelope.test.ts), [`test/unit/fuzz.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/fuzz.test.ts)       |
| **SM-02** | **Network Isolation & Replay Protection**                  | Transactions are strictly bound to their intended `networkPassphrase`. Any mismatch flags `NETWORK_MISMATCH` with severity `blocked`. Cross-network replay attacks are halted at the parsing layer.                                                                                                                                               | [`test/unit/envelope.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/envelope.test.ts), [`test/unit/preview.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/preview.test.ts) |
| **SM-03** | **Cryptographic Intent Verification**                      | Decoded contract invocations and arguments are validated against user-expected application intents (`contractId`, `functionName`, `args`). Discrepancies raise `INTENT_MISMATCH` (`blocked`). Verified intents can only downgrade `SPEC_UNAVAILABLE`, `VALUE_TOO_DEEP`, and `RESTORE_REQUIRED`; they never clear or downgrade `blocked` warnings. | [`test/unit/intent.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/intent.test.ts), [`test/unit/risk.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/risk.test.ts)           |
| **SM-04** | **Zero-Trust Contract Specs & RPC Boundaries**             | RPC-sourced data and contract specs are unauthenticated metadata. Remote resolution enforces `https://` URLs, respects optional domain allowlists, bounds Wasm sizes (`MAX_WASM_BYTES`), enforces request timeouts (`RPC_TIMEOUT_MS`), and safely handles malformed specs without throwing.                                                       | [`test/unit/spec.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/spec.test.ts)                                                                                                                                |
| **SM-05** | **Spec Validation & Anti-Spoofing**                        | If contract spec argument types or counts disagree with signed XDR `ScVal` structures, the kit raises `ARG_TYPE_MISMATCH` or `ARG_COUNT_MISMATCH` (`blocked`). Remote specs cannot misrepresent or disguise the signed contract parameters.                                                                                                       | [`test/unit/invocation.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/invocation.test.ts)                                                                                                                    |
| **SM-06** | **Simulated State & Successful Event Filtering**           | Simulation wrapper safely inspects execution paths without submitting. It strictly filters out events that do not stem from successful contract calls (`inSuccessfulContractCall: true`), surfaces auth requirements, and raises `SIMULATION_FAILED` when execution fails.                                                                        | [`test/unit/simulate.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/simulate.test.ts)                                                                                                                        |
| **SM-07** | **Deterministic Risk Derivation**                          | Overall risk is strictly derived from warning severities: `ok` (zero warnings), `review` (no blocked warnings, at least one review), `blocked` (at least one blocked warning). Default policy fails closed.                                                                                                                                       | [`test/unit/risk.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/risk.test.ts), [`test/unit/policy.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/policy.test.ts)           |
| **SM-08** | **Human-Readable Presentation & Blind-Signing Mitigation** | Clear-signing presentation unpacks `hostFunctionTypeInvokeContract` functions and parameters into sanitized display values, eliminating blind signing of raw bytes.                                                                                                                                                                               | [`test/unit/invocation.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/invocation.test.ts), [`test/unit/scval.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/scval.test.ts) |
| **SM-09** | **Fee-Bump Envelope Unrolling**                            | Safely unrolls `FeeBumpTransaction` envelopes, validating fee bounds and outer fee-bump signatures while enforcing identical security decoding on the inner transaction.                                                                                                                                                                          | [`test/unit/envelope.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/envelope.test.ts)                                                                                                                        |
| **SM-10** | **Auth Tree Traversal & Recursion Limits**                 | Recursively walks `SorobanAuthorizationEntry` trees to expose all authorized calls while enforcing maximum recursion depth constraints (`MAX_AUTH_DEPTH`) to prevent stack overflow and masking.                                                                                                                                                  | [`test/unit/auth.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/auth.test.ts)                                                                                                                                |

---

## Detailed Model & Threat Mitigation

### SM-01: Fail-Closed by Default

If the kit encounters any unknown elements, unrecognized opcodes, invalid XDR, or network mismatches, it must immediately abort and flag the transaction as undecodable. We never assume an unparsed buffer is safe.

- **Tests**: [`test/unit/envelope.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/envelope.test.ts), [`test/unit/fuzz.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/fuzz.test.ts)

### SM-02: Network Isolation

Transactions are strictly bound to the network passphrase they were created for. The kit verifies the `networkPassphrase` of the incoming transaction and ensures all simulated state matches this environment. Cross-network replay attempts are blocked at the parsing layer.

- **Tests**: [`test/unit/envelope.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/envelope.test.ts), [`test/unit/preview.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/preview.test.ts)

### SM-03: Cryptographic Verification of Intents

The kit acts as an "Intent Verifier". Applications can compare the decoded `invocation` and `args` against expected intents (e.g., verifying that a `transfer` goes to the correct address for the exact amount). A verified app-provided `Intent` can downgrade only `SPEC_UNAVAILABLE`, `VALUE_TOO_DEEP`, and `RESTORE_REQUIRED`. It never clears a `blocked` warning.

- **Tests**: [`test/unit/intent.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/intent.test.ts), [`test/unit/risk.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/risk.test.ts)

### SM-04: Zero-Trust Contract Specs & RPC Trust Boundary

While contract specifications and RPC responses provide human-readable argument names, types, and simulated state, the kit treats RPC-sourced data as unauthenticated metadata and never trusts it to override the signed XDR payload:

- `resolveContractSpec` enforces `https://` endpoints (with an optional RPC `allowlist`), caps Wasm payload sizes (`MAX_WASM_BYTES`), enforces request timeouts (`RPC_TIMEOUT_MS`), and parses the `contractspecv0` custom section without throwing on malformed remote bytes.
- An untrusted RPC node cannot alter the signed `ScVal` values, target contract ID, function symbol, or authorization entries embedded in the envelope XDR.
- **Tests**: [`test/unit/spec.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/spec.test.ts)

### SM-05: Spec Type & Count Validation

If a remote spec claims an argument is an integer when the XDR contains a symbol, or if argument counts differ, the kit flags `ARG_TYPE_MISMATCH` / `ARG_COUNT_MISMATCH` (`blocked`).

- **Tests**: [`test/unit/invocation.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/invocation.test.ts)

### SM-06: Simulated State Constraints

By wrapping `simulateTransaction` from the Soroban RPC, the kit inspects the real execution path of a transaction without submitting it. It strictly filters out events that do not stem from a successful contract call (`inSuccessfulContractCall: true`).

- **Tests**: [`test/unit/simulate.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/simulate.test.ts)

### SM-07: Risk Engine & Derivation

Every decoding step contributes warnings. Each warning code has a fixed severity (`review` or `blocked`, see `WARNING_SEVERITY`), and the overall `risk` is derived from them:

- **`ok`:** No warnings. Nothing the kit could not decode or verify.
- **`review`:** At least one `review` warning and no `blocked` warnings.
- **`blocked`:** At least one `blocked` warning. Wallets should not offer to sign.
- **Tests**: [`test/unit/risk.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/risk.test.ts), [`test/unit/policy.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/policy.test.ts)

### SM-08: Human-Readable Presentation & Blind Signing Mitigation

Enforces human-readable presentation of `hostFunctionTypeInvokeContract` invocations and arguments.

- **Tests**: [`test/unit/invocation.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/invocation.test.ts), [`test/unit/scval.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/scval.test.ts)

### SM-09: Fee-Bump Envelope Unrolling

Safely unrolls `FeeBumpTransaction` envelopes to inspect the inner transaction.

- **Tests**: [`test/unit/envelope.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/envelope.test.ts)

### SM-10: Auth Tree Traversal & Recursion Limits

Recursively walks the `SorobanAuthorizationEntry` tree to enforce maximum depth constraints and expose all root invocations.

- **Tests**: [`test/unit/auth.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/auth.test.ts)

---

## Threat Model Mitigation Matrix

| Threat                       | SCSK Claim   | SCSK Mitigation                                                                                                              | Covering Tests                                                                                                                                                                                                                                 |
| :--------------------------- | :----------- | :--------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blind Signing Phishing**   | SM-08        | Enforces human-readable presentation of `hostFunctionTypeInvokeContract`.                                                    | [`test/unit/invocation.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/invocation.test.ts), [`test/unit/scval.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/scval.test.ts) |
| **Malicious Spec Injection** | SM-04, SM-05 | Validates `ScVal` types against XDR strictly; sanitizes strings.                                                             | [`test/unit/spec.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/spec.test.ts), [`test/unit/invocation.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/invocation.test.ts)   |
| **Fee-Bump Hijacking**       | SM-09        | Safely unrolls `FeeBumpTransaction` envelopes to inspect the inner transaction.                                              | [`test/unit/envelope.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/envelope.test.ts)                                                                                                                        |
| **Auth Tree Masking**        | SM-10        | Recursively walks the `SorobanAuthorizationEntry` tree to enforce maximum depth constraints and expose all root invocations. | [`test/unit/auth.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/auth.test.ts)                                                                                                                                |
| **Cross-Network Replay**     | SM-02        | Verifies transaction `networkPassphrase` matches expected network.                                                           | [`test/unit/envelope.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/envelope.test.ts), [`test/unit/preview.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/preview.test.ts) |
| **Hostile Malformed Input**  | SM-01        | Rejects unknown opcodes, invalid XDR, and mutated bytes without uncaught exceptions.                                         | [`test/unit/envelope.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/envelope.test.ts), [`test/unit/fuzz.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/fuzz.test.ts)       |
| **Untrusted RPC Server**     | SM-04        | Treats RPC data as unauthenticated metadata; enforces timeout, size cap, and https allowlist.                                | [`test/unit/spec.test.ts`](file:///c:/Users/ADMIN/OneDrive/Documents/Drips/SCSK-Backend/test/unit/spec.test.ts)                                                                                                                                |
