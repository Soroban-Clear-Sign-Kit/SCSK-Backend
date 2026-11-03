# ClearSign Core Examples

This directory contains standalone, zero-network, offline runnable scripts illustrating key clear-signing workflows using real testnet fixtures.

## Available Examples

### 1. `examples/decode-envelope.js`

Demonstrates offline parsing of a raw base64 Soroban transaction envelope and decoding its contract invocation (`invokeHostFunction` operation, contract ID, function name, and structured arguments) against built-in SEP-41 SAC specifications without making network calls.

```bash
node examples/decode-envelope.js
```

### 2. `examples/summarize-simulation.js`

Demonstrates normalizing a Soroban RPC transaction simulation payload into a structured `SimulationSummary`, inspecting resource fees, and decoding contract diagnostic events offline.

```bash
node examples/summarize-simulation.js
```

### 3. `examples/evaluate-policy.js`

Demonstrates running ClearSign's pluggable policy engine with built-in security rules against contract invocations. Compares a safe token transfer (passes with 0 warnings) against a high-risk unlimited allowance approval to an unrecognized spender (triggers `UNLIMITED_APPROVAL` and `APPROVAL_NEW_SPENDER` review warnings).

```bash
node examples/evaluate-policy.js
```

## Running All Examples

You can run all examples in sequence via:

```bash
pnpm run test:examples
```
