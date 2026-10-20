# Soroban Clear-Sign Kit - Core Backend Engine (`@clearsign/core`)

The Core Engine of the **Soroban Clear-Sign Kit (SCSK)** provides robust, fail-closed XDR parsing, invocation decoding, argument AST extraction, diagnostic event resolution, and state override simulations for Stellar / Soroban transactions.

## Features

- **Envelope Parsing (`parseEnvelope`)**: Secure decoding of standard and fee-bump transaction envelopes with size bounds, time-bounds validation, network passphrase matching, and muxed account unwrapping.
- **Contract Invocation Inspection (`decodeInvocation`)**: Parses `invokeHostFunction` operations against contract specifications (parsed by a lightweight `xdr.ScSpecEntry`-based reader), including native support for built-in SEP-41 Stellar Asset Contracts (SAC) and arbitrary Soroban Wasm contracts.
- **ScVal AST Parser (`scval.ts`)**: Recursive conversion of Soroban `ScVal` representations into rich, human-readable `DisplayValue` structures with recursion depth limits to prevent stack exhaustion.
- **Event Decoder (`decodeEvent`)**: Decodes contract diagnostic and emission events against contract specs and raw fallback formatting.
- **State Overrides (`decodeLedgerEntry`)**: Analyzes `LedgerEntry` mutations (such as `contractData`) to provide clear visual diffs of state changes before transaction signing.
- **Security-First Architecture**: Strictly follows a "fail-closed" security policy where unsupported or malformed payloads produce clear `review` or `blocked` warnings rather than misleading approvals.

## Quick start

```ts
import { buildPreview } from "@clearsign/core";
import { Networks } from "@stellar/stellar-sdk";

const preview = await buildPreview({
  xdr, // base64 transaction or fee-bump envelope
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  signerAddress, // optional: highlights the signer's balance changes
});

if (preview.risk === "blocked") {
  // do not offer to sign
}
```

See [docs/API.md](docs/API.md) for every option and type.

## Installation

```bash
pnpm install
```

## Building

```bash
pnpm run build
```

## Testing

```bash
pnpm run test
pnpm run test:coverage
```
