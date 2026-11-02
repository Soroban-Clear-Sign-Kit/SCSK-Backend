import { bench, describe } from "vitest";
import { parseEnvelope } from "../../src/envelope.js";
import { decodeScVal } from "../../src/scval.js";
import { decodeLedgerEntry } from "../../src/state.js";
import {
  xdr,
  Networks,
  Keypair,
  Account,
  TransactionBuilder,
  Operation,
  Asset,
  Address,
} from "@stellar/stellar-sdk";

// Setup test payloads of varying sizes: small, medium, large

// 1. parseEnvelope payloads
const source = Keypair.random();
const account = new Account(source.publicKey(), "1000");

// Small: simple classic payment
const smallTx = new TransactionBuilder(account, {
  fee: "100",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: "10",
    }),
  )
  .setTimeout(300)
  .build();
smallTx.sign(source);
const smallEnvelopeXdr = smallTx.toXDR();

// Medium: invokeHostFunction with 5 parameters
const contractAddress = Address.contract(Buffer.alloc(32, 1));
const mediumTx = new TransactionBuilder(account, {
  fee: "2000",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: contractAddress.toScAddress(),
          functionName: "complex_call",
          args: [
            xdr.ScVal.scvString("test-string-argument-medium"),
            xdr.ScVal.scvI128(
              new xdr.Int128Parts({
                hi: xdr.Int64.fromString("0"),
                lo: xdr.Uint64.fromString("50000000"),
              }),
            ),
            xdr.ScVal.scvVec([
              xdr.ScVal.scvU32(1),
              xdr.ScVal.scvU32(2),
              xdr.ScVal.scvU32(3),
            ]),
            xdr.ScVal.scvBool(true),
            xdr.ScVal.scvAddress(
              Address.fromString(source.publicKey()).toScAddress(),
            ),
          ],
        }),
      ),
      auth: [],
    }),
  )
  .setTimeout(300)
  .build();
mediumTx.sign(source);
const mediumEnvelopeXdr = mediumTx.toXDR();

// Large: Transaction with 50 operations
const largeTxBuilder = new TransactionBuilder(account, {
  fee: "50000",
  networkPassphrase: Networks.TESTNET,
});
for (let i = 0; i < 50; i++) {
  largeTxBuilder.addOperation(
    Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: "1",
    }),
  );
}
const largeTx = largeTxBuilder.setTimeout(300).build();
largeTx.sign(source);
const largeEnvelopeXdr = largeTx.toXDR();

// 2. decodeScVal payloads
// Small: primitive scvU64
const smallScVal = xdr.ScVal.scvU64(xdr.Uint64.fromString("123456789"));

// Medium: Vec of 10 items (nested strings, numbers, addresses)
const mediumScVal = xdr.ScVal.scvVec([
  xdr.ScVal.scvString("alpha"),
  xdr.ScVal.scvU32(42),
  xdr.ScVal.scvBool(false),
  xdr.ScVal.scvSymbol("transfer"),
  xdr.ScVal.scvAddress(Address.fromString(source.publicKey()).toScAddress()),
  xdr.ScVal.scvBytes(Buffer.from("0123456789abcdef0123456789abcdef", "hex")),
  xdr.ScVal.scvI32(-100),
  xdr.ScVal.scvTimepoint(1700000000n),
  xdr.ScVal.scvDuration(3600n),
  xdr.ScVal.scvVoid(),
]);

// Large: Map of 20 key-value entries with nested vectors
const mapEntries: xdr.ScMapEntry[] = [];
for (let i = 0; i < 20; i++) {
  mapEntries.push(
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol(`key_${i}`),
      val: xdr.ScVal.scvVec([
        xdr.ScVal.scvU32(i),
        xdr.ScVal.scvString(`value_${i}_data_string`),
        xdr.ScVal.scvBool(i % 2 === 0),
      ]),
    }),
  );
}
const largeScVal = xdr.ScVal.scvMap(mapEntries);

// 3. decodeLedgerEntry payloads
const opts = { rpcUrl: "https://mock", networkPassphrase: Networks.TESTNET };

// Small: Account entry
const smallLedgerEntry = new xdr.LedgerEntry({
  lastModifiedLedgerSeq: 1000,
  data: xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId: xdr.PublicKey.publicKeyTypeEd25519(Buffer.alloc(32)),
      balance: 1000n,
      seqNum: 1n,
      numSubEntries: 0,
      inflationDest: null,
      flags: 0,
      homeDomain: "",
      thresholds: Buffer.alloc(4),
      signers: [],
      ext: xdr.AccountEntryExt.v0(),
    }),
  ),
  ext: xdr.LedgerEntryExt.v0(),
});

// Medium: ContractData entry with basic key and struct value
const mediumLedgerEntry = new xdr.LedgerEntry({
  lastModifiedLedgerSeq: 1050,
  data: xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(),
      contract: contractAddress.toScAddress(),
      key: xdr.ScVal.scvSymbol("Admin"),
      durability: xdr.ContractDataDurability.persistent,
      val: xdr.ScVal.scvAddress(
        Address.fromString(source.publicKey()).toScAddress(),
      ),
    }),
  ),
  ext: xdr.LedgerEntryExt.v0(),
});

// Large: ContractData entry with large map
const largeLedgerEntry = new xdr.LedgerEntry({
  lastModifiedLedgerSeq: 1100,
  data: xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(),
      contract: contractAddress.toScAddress(),
      key: xdr.ScVal.scvSymbol("StateRegistry"),
      durability: xdr.ContractDataDurability.persistent,
      val: largeScVal,
    }),
  ),
  ext: xdr.LedgerEntryExt.v0(),
});

describe("Benchmark: parseEnvelope", () => {
  bench("parseEnvelope - small (single classic payment)", () => {
    parseEnvelope(smallEnvelopeXdr, Networks.TESTNET);
  });

  bench("parseEnvelope - medium (invokeHostFunction with 5 args)", () => {
    parseEnvelope(mediumEnvelopeXdr, Networks.TESTNET);
  });

  bench("parseEnvelope - large (50 classic operations)", () => {
    parseEnvelope(largeEnvelopeXdr, Networks.TESTNET);
  });
});

describe("Benchmark: decodeScVal", () => {
  bench("decodeScVal - small (u64)", () => {
    decodeScVal(smallScVal);
  });

  bench("decodeScVal - medium (vector of 10 mixed items)", () => {
    decodeScVal(mediumScVal);
  });

  bench("decodeScVal - large (map of 20 entries with vectors)", () => {
    decodeScVal(largeScVal);
  });
});

describe("Benchmark: decodeLedgerEntry", () => {
  bench("decodeLedgerEntry - small (account)", async () => {
    await decodeLedgerEntry(smallLedgerEntry, opts);
  });

  bench(
    "decodeLedgerEntry - medium (contractData symbol -> address)",
    async () => {
      await decodeLedgerEntry(mediumLedgerEntry, opts);
    },
  );

  bench(
    "decodeLedgerEntry - large (contractData symbol -> large map)",
    async () => {
      await decodeLedgerEntry(largeLedgerEntry, opts);
    },
  );
});
