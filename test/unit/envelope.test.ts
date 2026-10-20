import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseEnvelope } from "../../src/envelope.js";
import {
  TransactionBuilder,
  Networks,
  Keypair,
  Operation,
  Memo,
  Account,
  Asset,
  xdr,
  MuxedAccount,
  Address,
} from "@stellar/stellar-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createPrng(seed: number) {
  let state = seed | 0;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const source = Keypair.random();
const account = new Account(source.publicKey(), "1");

describe("parseEnvelope", () => {
  it("rejects empty input", () => {
    const res = parseEnvelope("   ");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe("ENVELOPE_MALFORMED");
  });

  it("rejects oversized input", () => {
    const large = "A".repeat(200001) + "=";
    const res = parseEnvelope(large);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe("ENVELOPE_TOO_LARGE");
  });

  it("rejects bad base64", () => {
    const res = parseEnvelope("not!base64?");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe("ENVELOPE_MALFORMED");
  });

  it("rejects truncated XDR", () => {
    const res = parseEnvelope("AAAAAA==");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe("ENVELOPE_MALFORMED");
  });

  it("rejects wrong passphrase", () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(0)
      .build();
    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET, Networks.PUBLIC);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.code).toBe("NETWORK_MISMATCH");
  });

  it("unwraps fee-bump transaction", () => {
    const inner = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(0)
      .build();
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      source,
      "200",
      inner,
      Networks.TESTNET,
    );

    const res = parseEnvelope(feeBump.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.envelope.feeBump).toBeDefined();
      expect(res.envelope.feeBump?.fee).toBe("400");
      expect(res.envelope.feeBump?.feeSource).toBe(source.publicKey());
      expect(res.envelope.fee).toBe("100");
    }
  });

  it("returns warnings for classic-only operations", () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(0)
      .build();
    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.warnings).toContainEqual(
        expect.objectContaining({ code: "CLASSIC_OP_NOT_DECODED" }),
      );
    }
  });

  it("rejects transactions with zero operations", () => {
    // This is a pre-generated valid TransactionEnvelope XDR base64 string that has an empty operations array (length = 0)
    const zeroOpsXdrBase64 =
      "AAAAAgAAAABE0aqUsSMVcuqT+BDRi0dLNpFG3EZx9gDSBCSB5OHoaAAAAGQAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const res = parseEnvelope(zeroOpsXdrBase64, Networks.TESTNET);
    expect(res.success).toBe(false);
    if (!res.success)
      expect(res.error.message).toBe("Transaction has no operations");
  });

  it("rejects transactions with multiple invokeHostFunction operations", () => {
    const invokeOp = Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(source.publicKey()).toScAddress(),
          functionName: "a",
          args: [],
        }),
      ),
      auth: [],
    });
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(invokeOp)
      .addOperation(invokeOp)
      .setTimeout(0)
      .build();
    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(false);
    if (!res.success)
      expect(res.error.message).toContain(
        "Multiple invokeHostFunction operations not supported",
      );
  });

  it("handles Muxed source account", () => {
    const muxedAcc = new MuxedAccount(account, "1234");
    const tx = new TransactionBuilder(muxedAcc, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(0)
      .build();
    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.envelope.source).toContain("M");
      expect(res.envelope.source).toContain(source.publicKey());
    }
  });

  it("warns for expired time bounds", () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: "0", maxTime: "1" },
    })
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .build();
    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.warnings).toContainEqual(
        expect.objectContaining({ code: "TX_EXPIRED" }),
      );
    }
  });

  it("checks TX_EXPIRED before and after maxTime using options.now", () => {
    const maxTimeSeconds = 1700000000;
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: "0", maxTime: String(maxTimeSeconds) },
    })
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .build();

    // 1 second before maxTime: should not be expired
    const beforeRes = parseEnvelope(tx.toXDR(), Networks.TESTNET, undefined, {
      now: () => (maxTimeSeconds - 1) * 1000,
    });
    expect(beforeRes.success).toBe(true);
    if (beforeRes.success) {
      expect(beforeRes.warnings.some((w) => w.code === "TX_EXPIRED")).toBe(
        false,
      );
    }

    // 1 second after maxTime: should be expired
    const afterRes = parseEnvelope(tx.toXDR(), Networks.TESTNET, undefined, {
      now: () => (maxTimeSeconds + 1) * 1000,
    });
    expect(afterRes.success).toBe(true);
    if (afterRes.success) {
      expect(afterRes.warnings).toContainEqual(
        expect.objectContaining({ code: "TX_EXPIRED" }),
      );
    }
  });

  it("never throws for 500 seeded random strings", () => {
    const rng = createPrng(42);
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=!@#$%^&*()_+-=[]{}|;:,.<>?\n\r\t\0";
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rng() * 200);
      let str = "";
      for (let j = 0; j < len; j++) {
        str += chars[Math.floor(rng() * chars.length)]!;
      }
      expect(() => parseEnvelope(str)).not.toThrow();
    }
  });

  it("never throws for 2000 seeded mutations of real fixtures", () => {
    const rng = createPrng(999);
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=!@#$%^&*()_+-=[]{}|;:,.<>?\n\r\t\0";

    const fixturesDir = path.join(__dirname, "../fixtures");
    const fixtureFiles = fs
      .readdirSync(fixturesDir)
      .filter((f) => f.endsWith(".json"));
    const xdrs: string[] = [];
    for (const f of fixtureFiles) {
      const d = JSON.parse(fs.readFileSync(path.join(fixturesDir, f), "utf8"));
      if (d.xdr && typeof d.xdr === "string") {
        xdrs.push(d.xdr);
      }
    }
    expect(xdrs.length).toBeGreaterThan(0);

    const mutationTypes = [
      "flip",
      "truncate",
      "insert",
      "delete",
      "pad",
      "replace",
    ] as const;

    for (let i = 0; i < 2000; i++) {
      const base = xdrs[Math.floor(rng() * xdrs.length)]!;
      const mType = mutationTypes[Math.floor(rng() * mutationTypes.length)]!;
      let mutated = base;

      if (mType === "flip" && base.length > 0) {
        const idx = Math.floor(rng() * base.length);
        const replacement = chars[Math.floor(rng() * chars.length)]!;
        mutated = base.slice(0, idx) + replacement + base.slice(idx + 1);
      } else if (mType === "truncate") {
        const idx = Math.floor(rng() * base.length);
        mutated = base.slice(0, idx);
      } else if (mType === "insert") {
        const idx = Math.floor(rng() * base.length);
        const count = 1 + Math.floor(rng() * 10);
        let junk = "";
        for (let k = 0; k < count; k++) {
          junk += chars[Math.floor(rng() * chars.length)]!;
        }
        mutated = base.slice(0, idx) + junk + base.slice(idx);
      } else if (mType === "delete" && base.length > 5) {
        const start = Math.floor(rng() * (base.length - 4));
        const len = 1 + Math.floor(rng() * 4);
        mutated = base.slice(0, start) + base.slice(start + len);
      } else if (mType === "pad") {
        mutated =
          base.replace(/=/g, "") + "===".slice(0, Math.floor(rng() * 4));
      } else if (mType === "replace") {
        const idx = Math.floor(rng() * base.length);
        mutated = base.slice(0, idx) + "\0" + base.slice(idx + 1);
      }

      expect(() => parseEnvelope(mutated)).not.toThrow();
    }
  });

  it("ignores invalid Muxed source account gracefully", () => {
    // This base64 XDR contains a MuxedAccount source
    const mSourceBase64 =
      "AAAAAgAAAQAAAAAAAAAE0tsTvR/C/xyPPIEIjE4mPWcB+Q9YhYoWEfRmP/ZOuVY+AAAAZAAAAAAAAAACAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAANsTvR/C/xyPPIEIjE4mPWcB+Q9YhYoWEfRmP/ZOuVY+AAAAAAAAAAAF9eEAAAAAAAAAAAA=";

    // We mock MuxedAccount.fromAddress to throw an error, simulating a parse failure
    const spy = vi.spyOn(MuxedAccount, "fromAddress").mockImplementation(() => {
      throw new Error("Invalid address");
    });

    const res = parseEnvelope(mSourceBase64, Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      // It will just keep the original raw source string instead of appending the G-address
      expect(res.envelope.source.startsWith("M")).toBe(true);
      expect(res.envelope.source).not.toContain("(");
    }

    spy.mockRestore();
  });

  it("parses text, id, hash, and return memos correctly", () => {
    const memoTypes = [
      Memo.text("hello"),
      Memo.id("12345"),
      Memo.hash(
        "0000000000000000000000000000000000000000000000000000000000000000",
      ),
      Memo.return(
        "0000000000000000000000000000000000000000000000000000000000000000",
      ),
    ];

    for (const m of memoTypes) {
      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: source.publicKey(),
            asset: Asset.native(),
            amount: "10",
          }),
        )
        .addMemo(m)
        .setTimeout(0)
        .build();
      const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.envelope.memo).toBeDefined();
        expect(res.envelope.memo?.type).toBe(m.type);
      }
    }
  });

  it("marks signatureBound true for valid signed envelope", () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(0)
      .build();
    tx.sign(source);

    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.signatureBound).toBe(true);
      expect(res.warnings.some((w) => w.code === "SIGNATURE_INVALID")).toBe(
        false,
      );
    }
  });

  it("gives SIGNATURE_INVALID when signed on Testnet and parsed with Public passphrase", () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(0)
      .build();
    tx.sign(source);

    const res = parseEnvelope(tx.toXDR(), Networks.PUBLIC);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.signatureBound).toBe(false);
      expect(res.warnings).toContainEqual(
        expect.objectContaining({ code: "SIGNATURE_INVALID" }),
      );
    }
  });

  it("gives signatureBound false and no warning for unsigned transaction", () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(0)
      .build();

    const res = parseEnvelope(tx.toXDR(), Networks.TESTNET);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.signatureBound).toBe(false);
      expect(res.warnings.some((w) => w.code === "SIGNATURE_INVALID")).toBe(
        false,
      );
    }
  });

  it("verifies FeeBump transaction signatures correctly", () => {
    const inner = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(0)
      .build();
    inner.sign(source);

    const feeSource = Keypair.random();
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      "200",
      inner,
      Networks.TESTNET,
    );
    feeBump.sign(feeSource);

    const resValid = parseEnvelope(feeBump.toXDR(), Networks.TESTNET);
    expect(resValid.success).toBe(true);
    if (resValid.success) {
      expect(resValid.signatureBound).toBe(true);
      expect(
        resValid.warnings.some((w) => w.code === "SIGNATURE_INVALID"),
      ).toBe(false);
    }

    const resInvalid = parseEnvelope(feeBump.toXDR(), Networks.PUBLIC);
    expect(resInvalid.success).toBe(true);
    if (resInvalid.success) {
      expect(resInvalid.signatureBound).toBe(false);
      expect(resInvalid.warnings).toContainEqual(
        expect.objectContaining({ code: "SIGNATURE_INVALID" }),
      );
    }
  });
});
