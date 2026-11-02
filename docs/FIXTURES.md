# Test Fixtures & Re-Recording Guide

`@clearsign/core` tests its decoders, invocation analysis, auth trees, event extraction, and preview generator against real recorded transactions and simulation responses in `test/fixtures/`.

---

## Directory Structure

Every recorded fixture is a `.json` file containing:

- `captureInfo`: Provenance metadata explaining how and where the fixture was recorded.
- `xdr`: The raw base64 Stellar transaction envelope or fee-bump.
- `sim` (optional): The recorded Soroban RPC simulation response (`simulateTransaction`).

Beside each fixture is a reviewed and locked expected result file: `*.expected.json`.

```text
test/fixtures/
├── classic.json
├── classic.expected.json
├── expired_auth.json
├── expired_auth.expected.json
├── feebump.json
├── feebump.expected.json
├── fixture_forward.json
├── fixture_forward.expected.json
├── forward_with_meta.json
├── forward_with_meta.expected.json
├── mainnet_complex_0..5.json
├── mainnet_complex_0..5.expected.json
├── nested_auth.json
├── nested_auth.expected.json
├── restore_required.json
├── restore_required.expected.json
├── sac_transfer.json
├── sac_transfer.expected.json
├── simple_call.json
├── simple_call.expected.json
├── sim_fail_balance.json
├── sim_fail_balance.expected.json
├── transfer_auth.json
├── transfer_auth.expected.json
├── wrong_network.json
└── wrong_network.expected.json
```

---

## Fixture Provenance & Capture Notes

| Fixture File                | Network          | Provenance & Capture Method                                                                                    |
| :-------------------------- | :--------------- | :------------------------------------------------------------------------------------------------------------- |
| `sac_transfer.json`         | Testnet          | Stellar Asset Contract `transfer` invocation with emitted events and balance changes recorded via testnet RPC. |
| `sim_fail_balance.json`     | Testnet          | Simulation failure response triggered by transferring more tokens than the account balance.                    |
| `restore_required.json`     | Testnet          | Simulation response with non-empty `restorePreamble` for archived contract state.                              |
| `expired_auth.json`         | Testnet          | Soroban transaction with an expired `signatureExpirationLedger` in an authorization entry.                     |
| `nested_auth.json`          | Testnet          | Deeply nested multi-level Soroban authorization invocation tree.                                               |
| `transfer_auth.json`        | Testnet          | Authorization entries authorizing token transfer with address credentials.                                     |
| `feebump.json`              | Testnet          | Fee-bumped transaction envelope (`FeeBumpTransaction`) wrapping a Soroban invocation.                          |
| `classic.json`              | Testnet          | Classic Stellar operation (`payment`) transaction envelope.                                                    |
| `fixture_forward.json`      | Testnet          | Contract invocation of a router `forward()` function.                                                          |
| `forward_with_meta.json`    | Testnet          | Router call with simulation failure.                                                                           |
| `wrong_network.json`        | Public / Testnet | Envelope constructed for Stellar Public network presented against Testnet passphrase (`NETWORK_MISMATCH`).     |
| `mainnet_complex_0..5.json` | Mainnet          | Real mainnet multi-hop DeFi swaps, AMM liquidity deposits, and flash-loans captured from Horizon/RPC.          |

---

## Re-Recording Script (`scripts/record-fixture.js`)

To re-record a simulation against live testnet and inspect the diff:

```bash
# Preview diff without modifying the file on disk
node scripts/record-fixture.js sac_transfer --dry-run

# Re-record and update the fixture with live testnet response
node scripts/record-fixture.js sac_transfer
```

Environment variables:

- `STELLAR_RPC_URL`: Overrides the RPC endpoint (default: `https://soroban-testnet.stellar.org`).
- `STELLAR_NETWORK_PASSPHRASE`: Overrides the network passphrase (default: `Test SDF Network ; September 2015`).

---

## Regression Testing Against Reviewed Expected Outputs

The test suite in `test/unit/recorded-fixtures.test.ts` executes every fixture, generates its canonical summary output, and asserts strict deep equality against the companion `*.expected.json` file. Any deliberate or unintended change to output fields, warning codes, risk levels, or simulation statuses triggers an immediate test failure.
