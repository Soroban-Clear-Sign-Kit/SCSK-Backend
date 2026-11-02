import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeLedgerEntry } from "../../src/state.js";
import { xdr, StrKey } from "@stellar/stellar-sdk";
import { loadSpec } from "../../src/spec.js";

vi.mock("../../src/spec.js", async () => {
  const actual: any = await vi.importActual("../../src/spec.js");
  return {
    ...actual,
    loadSpec: vi.fn(),
  };
});

const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
import { Address } from "@stellar/stellar-sdk";

describe("decodeLedgerEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decodes a contractData ledger entry", async () => {
    (loadSpec as any).mockResolvedValue({
      spec: null,
      source: "none",
      warnings: [],
    });

    const entry = new xdr.LedgerEntry({
      lastModifiedLedgerSeq: 123,
      data: xdr.LedgerEntryData.contractData(
        new xdr.ContractDataEntry({
          ext: xdr.ExtensionPoint.v0(),
          contract: Address.fromString(contractId).toScAddress(),
          key: xdr.ScVal.scvSymbol("Admin"),
          durability: xdr.ContractDataDurability.persistent,
          val: xdr.ScVal.scvAddress(
            Address.fromString(contractId).toScAddress(),
          ),
        }),
      ),
      ext: xdr.LedgerEntryExt.v0(),
    });

    const res = await decodeLedgerEntry(entry, { rpcUrl: "" });
    expect(res.contractId).toBe(contractId);
    expect(res.entryType).toBe("contractData");
    expect(res.key.kind).toBe("symbol");
    expect((res.key as any).value).toBe("Admin");
    expect(res.val.kind).toBe("address");
  });

  it("warns on unsupported ledger entry types", async () => {
    const entry = new xdr.LedgerEntry({
      lastModifiedLedgerSeq: 123,
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

    const res = await decodeLedgerEntry(entry, { rpcUrl: "" });
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_SCVAL" }),
    );
    expect(res.entryType).toBe("account");
  });

  it("decodes parsed JSON fixture contract_data and trustline ledger entries", async () => {
    (loadSpec as any).mockResolvedValue({
      spec: null,
      source: "none",
      warnings: [],
    });

    const contractDataJson = {
      last_modified_ledger_seq: 5088095,
      data: {
        contract_data: {
          contract: contractId,
          key: { symbol: "Balance" },
          durability: "persistent",
          val: { i128: "5000" },
        },
      },
      ext: "v0",
    };

    const res1 = await decodeLedgerEntry(contractDataJson, { rpcUrl: "" });
    expect(res1.entryType).toBe("contractData");
    expect(res1.contractId).toBe(contractId);
    expect(res1.key).toEqual({
      kind: "symbol",
      value: "Balance",
      sanitized: false,
      truncated: false,
    });
    expect(res1.val).toEqual({ kind: "int", type: "i128", value: "5000" });

    const trustlineJson = {
      last_modified_ledger_seq: 5088095,
      data: {
        trustline: {
          account_id:
            "GDSIQKUJFBOV4XW6SSBYIPT5QUKVPBY4KHLNL3AS3CJIK7BRHZFUSQK2",
          balance: "1000000000",
        },
      },
      ext: "v0",
    };

    const res2 = await decodeLedgerEntry(trustlineJson, { rpcUrl: "" });
    expect(res2.entryType).toBe("trustline");
    expect(res2.warnings).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_SCVAL" }),
    );
  });
});
