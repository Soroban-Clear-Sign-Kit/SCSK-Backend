# Core Engine API Reference

## Exports

### `buildPreview(input: BuildPreviewInput): Promise<ClearSignPreview>`

The primary orchestration function that runs the entire clear-sign pipeline: envelope parsing, invocation decoding, authorization decoding, RPC simulation, and risk engine analysis.

#### Parameters:

- `input.xdr` (string): The base64-encoded transaction or fee-bump envelope.
- `input.rpcUrl` (string): The Soroban RPC endpoint to simulate against.
- `input.networkPassphrase` (string): The exact network passphrase expected for this transaction.
- `input.signerAddress` (string, optional): The address of the user who is signing. Highlights balance changes and intent verification for this specific user.
- `input.intent` (Intent, optional): The structured app intent to verify against the decoded transaction.
- `input.specs` (Record<string, Buffer | Uint8Array>, optional): Injected contract Wasm bytes by contract ID to skip network fetches.
- `input.options` (object, optional):
  - `minAuthValidityLedgers` (number): Default 12. Warns if auth entries expire sooner than this.
  - `feeWarningMultiplier` (number): Default 10. Warns if envelope fee > multiplier * simulated minResourceFee.
  - `rpcTimeoutMs` (number): Default 10000. Timeout for RPC simulation calls.
  - `debug` (boolean): Default false. If true, includes the original XDR strings in the output structure.

#### Returns:

A `Promise` resolving to a `ClearSignPreview` object.

---

## Types

### `ClearSignPreview`

```typescript
interface ClearSignPreview {
  version: 1;
  risk: "ok" | "review" | "blocked";
  warnings: {
    code: WarningCode;
    severity: "review" | "blocked";
    message: string;
    path?: string;
  }[];
  network: { passphrase: string; verified: boolean };
  envelope: {
    source: string;
    sequence: string;
    fee: string;
    feeBump?: { feeSource: string; fee: string };
    memo?: { type: string; value: string };
    timeBounds?: { min: string; max: string };
    operations: { type: string; decoded: boolean }[];
  };
  invocation?: Invocation;
  auth: AuthEntry[];
  simulation: {
    status: "success" | "failed" | "needs-restore" | "unavailable" | "skipped";
    minResourceFee?: string;
    error?: string;
    returnValue?: DisplayValue;
    latestLedger?: number;
  };
  effects: BalanceDelta[];
  summary: string[];
  raw: { xdr: string };
}
```

### `Invocation`

```typescript
interface Invocation {
  contractId: string;
  functionName: string;
  args: DecodedArg[];
  specSource: "wasm" | "sac-builtin" | "injected" | "none";
}
```

### `DecodedArg`

```typescript
interface DecodedArg {
  name: string | null;
  typeName: string | null;
  value: DisplayValue;
}
```

### `AuthEntry`

```typescript
interface AuthEntry {
  credentials:
    | { type: "source-account" }
    | {
        type: "address";
        address: string;
        nonce: string;
        signatureExpirationLedger: number;
        signed: boolean;
      };
  root: AuthNode;
  requiresSigner?: boolean;
}
```

### `AuthNode`

```typescript
interface AuthNode {
  kind: "contract-fn" | "create-contract" | "create-contract-v2";
  contractId?: string;
  functionName?: string;
  args?: DecodedArg[];
  details?: Record<string, string>;
  children: AuthNode[];
  depth: number;
}
```

### `BalanceDelta`

```typescript
interface BalanceDelta {
  tokenContractId: string;
  account: string;
  delta: string; // decimal string, signed
  symbol?: string;
  decimals?: number;
  formatted?: string;
}
```

### `DisplayValue`

A structured, human-readable recursive representation of `ScVal`s:

```typescript
type DisplayValue =
  | { kind: "bool"; value: boolean }
  | { kind: "void" }
  | {
      kind: "int";
      type: "u32" | "i32" | "u64" | "i64" | "u128" | "i128" | "u256" | "i256";
      value: string;
    }
  | { kind: "timepoint" | "duration"; value: string }
  | { kind: "bytes"; hex: string; length: number; truncated: boolean }
  | {
      kind: "string" | "symbol";
      value: string;
      truncated: boolean;
      sanitized: boolean;
    }
  | {
      kind: "address";
      value: string;
      addressType: "account" | "contract" | "muxed" | "other";
    }
  | { kind: "vec"; items: DisplayValue[] }
  | { kind: "map"; entries: { key: DisplayValue; value: DisplayValue }[] }
  | {
      kind: "struct";
      name: string;
      fields: { name: string; value: DisplayValue }[];
    }
  | { kind: "enum"; name: string; variant: string; values: DisplayValue[] }
  | { kind: "option"; value: DisplayValue | null }
  | { kind: "raw"; scvalType: string; xdr: string };
```

---

## Warning Code Table

| Code                         | Severity  | Description                                                                                            |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `ENVELOPE_MALFORMED`         | `blocked` | Invalid Base64, padding, multiple operations, or not an Envelope.                                      |
| `ENVELOPE_TOO_LARGE`         | `blocked` | The XDR length exceeds the defined memory safety limits.                                               |
| `NETWORK_MISMATCH`           | `blocked` | RPC network does not match the provided passphrase.                                                    |
| `TX_EXPIRED`                 | `blocked` | Timebounds on the transaction have already expired relative to current time.                           |
| `CLASSIC_OP_NOT_DECODED`     | `review`  | The transaction contains non-Soroban operations.                                                       |
| `CONTRACT_DEPLOYMENT`        | `review`  | The transaction deploys a new Soroban Wasm or Stellar Asset Contract.                                  |
| `WASM_UPLOAD`                | `review`  | The transaction uploads executable Wasm code to the network.                                           |
| `SPEC_UNAVAILABLE`           | `review`  | The Wasm spec could not be downloaded or was missing from cache. Arguments are raw.                    |
| `ARG_COUNT_MISMATCH`         | `blocked` | Contract spec input count does not match the provided argument count.                                  |
| `ARG_TYPE_MISMATCH`          | `blocked` | The argument type at runtime conflicts with the contract spec type.                                    |
| `UNSUPPORTED_SCVAL`          | `review`  | A non-standard ScVal type (e.g. ContractInstance) was passed as an argument.                           |
| `VALUE_TOO_DEEP`             | `review`  | Nested collections exceeded the defined MAX recursion depth.                                           |
| `AUTH_TREE_TOO_LARGE`        | `blocked` | Auth tree exceeds maximum nodes or recursion depth limits.                                             |
| `AUTH_EXPIRING`              | `review`  | Auth entry signature expiration is close to the current network ledger.                                |
| `AUTH_EXPIRED`               | `blocked` | Auth entry signature expiration has already passed the current ledger.                                 |
| `AUTH_DUPLICATE_NONCE`       | `blocked` | Two separate auth entries exist for the same address and nonce.                                        |
| `AUTH_UNKNOWN_CONTRACT`      | `review`  | The auth entry targets a contract we don't have a spec for.                                            |
| `AUTH_EXTRA_CONTRACT`        | `review`  | Auth entry authorizes a contract call that is not the top-level invoked contract.                      |
| `AUTH_CREATES_CONTRACT`      | `review`  | The auth entry authorizes a contract deployment.                                                       |
| `SIMULATION_FAILED`          | `blocked` | RPC simulation returned an execution failure status.                                                   |
| `SIMULATION_UNAVAILABLE`     | `blocked` | The RPC endpoint timed out or was unreachable.                                                         |
| `RESTORE_REQUIRED`           | `review`  | The contract's archived ledger state must be restored before the invocation can succeed.               |
| `FEE_UNUSUALLY_HIGH`         | `review`  | The declared envelope fee is more than a configurable multiplier (10x) above simulated minResourceFee. |
| `EVENT_SHAPE_UNKNOWN`        | `review`  | A balance transfer diagnostic event does not match expected layouts.                                   |
| `TOKEN_METADATA_UNAVAILABLE` | `review`  | Failed to retrieve token decimal/symbol metadata for balance updates.                                  |
| `INTENT_MISMATCH`            | `blocked` | Arguments, target, or function name mismatch against the app's declared Intent.                        |
| `INTENT_SPEND_EXCEEDED`      | `blocked` | Negative token delta for the signer exceeds the maxSpend in the Intent.                                |
| `INTENT_UNEXPECTED_AUTH`     | `blocked` | Signer auth entry targets a contract not present in allowedContracts.                                  |
| `INTENT_UNVERIFIABLE`        | `blocked` | App Intent requires named argument verification but contract spec is missing.                          |
| `INTERNAL_ERROR`             | `blocked` | Hard unhandled exception within the clear-sign build process.                                          |
