# Soroban Clear-Sign Kit - Core Backend Engine (`@clearsign/core`)

The Core Engine of the **Soroban Clear-Sign Kit (SCSK)** provides robust, fail-closed XDR parsing, invocation decoding, argument AST extraction, diagnostic event resolution, and state override simulations for Stellar / Soroban transactions.

## Features

- **Envelope Parsing (`parseEnvelope`)**: Secure decoding of standard and fee-bump transaction envelopes with size bounds, time-bounds validation, network passphrase matching, and muxed account unwrapping.
- **Contract Invocation Inspection (`decodeInvocation`)**: Parses `invokeHostFunction` operations against contract specifications (`contract.Spec`), including native support for built-in SEP-41 Stellar Asset Contracts (SAC) and arbitrary Soroban Wasm contracts.
- **ScVal AST Parser (`scval.ts`)**: Recursive conversion of Soroban `ScVal` representations into rich, human-readable `DisplayValue` structures with recursion depth limits to prevent stack exhaustion.
- **Event Decoder (`decodeEvent`)**: Decodes contract diagnostic and emission events against contract specs and raw fallback formatting.
- **State Overrides (`decodeLedgerEntry`)**: Analyzes `LedgerEntry` mutations (such as `contractData`) to provide clear visual diffs of state changes before transaction signing.
- **Security-First Architecture**: Strictly follows a "fail-closed" security policy where unsupported or malformed payloads produce clear `review` or `blocked` warnings rather than misleading approvals.

## Quick Start

### 1. Offline Transaction Decoding

Decode any base64 transaction envelope and its Soroban host function invocation completely offline:

```ts
import { parseEnvelope, decodeInvocation } from "@clearsign/core";
import { Networks } from "@stellar/stellar-sdk";

const xdr =
  "AAAAAgAAAACKHGoJlvcC+kPnIKPhQhxFVRDWaCjhBF0UQT9QsWnc9QAAJxAATaEeAAAADQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABAiMW1feUd3ZLcRjgE9iehksTK/dzffBv3Dfe+pgGyKUAAAAIdHJhbnNmZXIAAAADAAAAEgAAAAAAAAAAihxqCZb3AvpD5yCj4UIcRVUQ1mgo4QRdFEE/ULFp3PUAAAASAAAAAAAAAADkiCqJKF1eXt6Ug4Q+fYUVV4ccUdbV7BLYkoV8MT5LSQAAAAoAAAAAAAAAAAAAAAAAAABkAAAAAAAAAAAAAAAA";

// 1. Parse envelope (checks bounds, network passphrase, muxed accounts)
const parsed = parseEnvelope(xdr, Networks.TESTNET);
if (!parsed.success) {
  throw new Error(`Parse failed: ${parsed.error.message}`);
}

console.log("Source Account :", parsed.envelope.source);
console.log("Sequence Number:", parsed.envelope.sequence);
console.log("Fee (stroops)  :", parsed.envelope.fee);

// 2. Decode the invocation against built-in SEP-41 SAC specs offline
const op = parsed.innerTransaction.operations[0];
const decoded = await decodeInvocation(op, {
  networkPassphrase: Networks.TESTNET,
});

console.log("Function Name  :", decoded.invocation.functionName); // "transfer"
console.log("Arguments Count:", decoded.invocation.args.length); // 3
for (const arg of decoded.invocation.args) {
  console.log(`- ${arg.name ?? "arg"}:`, arg.value);
}
```

### 2. Full Simulation Preview & Risk Analysis

Run the complete clear-sign pipeline against a Soroban RPC node with fail-closed security guarantees:

```ts
import { buildPreview } from "@clearsign/core";
import { Networks } from "@stellar/stellar-sdk";

const preview = await buildPreview({
  xdr, // base64 transaction or fee-bump envelope
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  signerAddress: "GCFBY2QJS33QF6SD44QKHYKCDRCVKEGWNAUOCBC5CRAT6UFRNHOPK34B",
});

console.log("Overall Risk:", preview.risk); // "ok" | "review" | "blocked"
console.log("Summary:", preview.summary.description);

if (preview.risk === "blocked") {
  console.warn(
    "Blocked reasons:",
    preview.warnings.map((w) => w.message),
  );
  // Refuse or disable the signing button
}
```

See [docs/API.md](docs/API.md) for full parameter docs and run `pnpm run docs:api` for the generated TypeDoc HTML reference.

## Examples

The repository includes runnable, zero-network offline scripts in `examples/` backed by testnet fixtures:

- **`examples/decode-envelope.js`**: Decodes a raw transaction envelope and its host function arguments offline.
- **`examples/summarize-simulation.js`**: Normalizes a simulation payload and decodes contract events.
- **`examples/evaluate-policy.js`**: Runs policy checks for unlimited approvals and unknown spenders.

Run all examples anytime with:

```bash
pnpm run test:examples
```

## Installation

Install `@clearsign/core` along with its peer dependency `@stellar/stellar-sdk`:

```bash
# Using npm
npm install @clearsign/core @stellar/stellar-sdk

# Using pnpm
pnpm add @clearsign/core @stellar/stellar-sdk

# Using yarn
yarn add @clearsign/core @stellar/stellar-sdk
```

The package provides dual ESM and CommonJS exports with full TypeScript typings out of the box:

```ts
// ESM
import { buildPreview, parseEnvelope, computeRisk } from "@clearsign/core";

// CommonJS
const { buildPreview, parseEnvelope, computeRisk } = require("@clearsign/core");
```

## Local Development

```bash
pnpm install
```

## Building

```bash
pnpm run build
```

## Documentation

- **[docs/API.md](docs/API.md)**: Handwritten architectural and API design documentation.
- **TypeDoc API Reference**: Generate full HTML API documentation by running `pnpm run docs:api` (outputs to `docs/api/`).
- **[docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md)**: Security claims catalog (`SM-01` through `SM-10`) and test mappings.
- **[docs/RULES.md](docs/RULES.md)**: Policy engine built-in rules, severity levels, and configuration.
- **[docs/WARNINGS.md](docs/WARNINGS.md)**: Exhaustive list of all 36 ClearSign warning codes and triggers.
- **[docs/FIXTURES.md](docs/FIXTURES.md)**: Guide to recorded fixtures and recording script.

## Testing & Quality Checks

```bash
# Run unit test suite
pnpm run test

# Run offline examples
pnpm run test:examples

# Run full quality check (types, lint, format, security claims, packaging, tests)
pnpm run check

# Generate typedoc API reference
pnpm run docs:api
```
