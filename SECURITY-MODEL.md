# Soroban Clear-Sign Kit (SCSK) Security Model

The Soroban Clear-Sign Kit (SCSK) is designed with a strict, fail-closed security architecture. The goal is to eliminate blind-signing on the Stellar network by providing a deterministic, type-safe, and verifiable summary of every transaction before it is submitted.

## Core Tenets

1. **Fail-Closed by Default**
   If the kit encounters any unknown elements, unrecognized opcodes, invalid XDR, or network mismatches, it must immediately abort and flag the transaction as undecodable. We never assume an unparsed buffer is safe.

2. **Network Isolation**
   Transactions are strictly bound to the network passphrase they were created for. The kit verifies the `networkPassphrase` of the incoming transaction and ensures all simulated state matches this environment. Cross-network replay attempts are blocked at the parsing layer.

3. **Cryptographic Verification of Intents**
   The kit does not just display information; it acts as an "Intent Verifier". For decentralized applications, the backend can compare the decoded `invocation` and `args` against expected intents (e.g., verifying that a `transfer` goes to the correct address for the exact amount).

4. **Zero-Trust Contract Specs**
   While contract specifications provide human-readable argument names and types, the kit does not trust them to dictate control flow. If a contract claims an argument is an integer but the XDR contains a symbol, the kit flags a severe mismatch.

5. **Simulated State Constraints**
   By wrapping `simulateTransaction` from the Soroban RPC, the kit inspects the real execution path of a transaction without submitting it. It strictly filters out events that do not stem from a successful contract call (`inSuccessfulContractCall: true`).

## Risk Engine & Heuristics

The SCSK risk engine evaluates the parsed envelope and simulated effects to assign a risk score:

- **Low Risk:** Standard token transfers, known DEX interactions, and operations conforming to standard Stellar interfaces (e.g., SEP-41).
- **Medium Risk:** Interactions with newly deployed, unverified contracts, or operations lacking complete contract specs.
- **High Risk:** Operations that generate warnings during decoding (e.g., excessive argument limits, mismatched types, auth expiration approaching).
- **Critical (Blocked):** Invalid XDR, unrecognized authentication credentials, cross-network transactions, or simulation failures indicating a revert.

## Threat Model Mitigation

| Threat                       | SCSK Mitigation                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Blind Signing Phishing**   | Enforces human-readable presentation of `hostFunctionTypeInvokeContract`.                                                    |
| **Malicious Spec Injection** | Validates `ScVal` types against XDR strictly; sanitizes strings.                                                             |
| **Fee-Bump Hijacking**       | Safely unrolls `FeeBumpTransaction` envelopes to inspect the inner transaction.                                              |
| **Auth Tree Masking**        | Recursively walks the `SorobanAuthorizationEntry` tree to enforce maximum depth constraints and expose all root invocations. |

## Bug Bounty & Auditing

(Placeholder for future auditing details and bug bounty programs).
