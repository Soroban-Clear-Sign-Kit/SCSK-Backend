import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadSpec,
  resolveContractSpec,
  extractContractSpecSection,
  _specCache,
  _wasmHashCache,
  _resolvedSpecTtlCache,
} from "../../src/spec.js";
import { rpc, contract, xdr } from "@stellar/stellar-sdk";

vi.mock("@stellar/stellar-sdk", async () => {
  const actual: any = await vi.importActual("@stellar/stellar-sdk");
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn(),
    },
    contract: {
      ...actual.contract,
      Spec: {
        fromWasm: vi.fn(() => ({})), // Mock Spec instance
      },
    },
  };
});

describe("spec caching", () => {
  beforeEach(() => {
    // hack to clear caches for test
    (_specCache as any).cache = new Map();
    (_wasmHashCache as any).cache = new Map();
    vi.clearAllMocks();
  });

  it("fetches once and uses cache for subsequent calls", async () => {
    const mockWasm = Buffer.alloc(10);
    const mockGetContractInstance = vi
      .fn()
      .mockResolvedValue({ executable: { wasmHash: "123" } });
    const mockGetContractWasmByContractId = vi.fn().mockResolvedValue(mockWasm);

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
          getContractWasmByContractId: mockGetContractWasmByContractId,
        };
      },
    );

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB";
    const opts = { rpcUrl: "http://localhost" };

    const res1 = await loadSpec(contractId, opts);
    expect(res1.source).toBe("wasm");
    expect(mockGetContractInstance).toHaveBeenCalledTimes(1);
    expect(mockGetContractWasmByContractId).toHaveBeenCalledTimes(1);

    const res2 = await loadSpec(contractId, opts);
    expect(res2.source).toBe("wasm");
    // Should call network again for instance to check hash
    expect(mockGetContractInstance).toHaveBeenCalledTimes(2);
    // But should NOT fetch the Wasm bytes again
    expect(mockGetContractWasmByContractId).toHaveBeenCalledTimes(1);
  });

  it("fetches new Wasm if the contract is upgraded (wasmHash changes)", async () => {
    const mockWasm1 = Buffer.alloc(10);
    const mockWasm2 = Buffer.alloc(20);

    let getInstCount = 0;
    const mockGetContractInstance = vi.fn().mockImplementation(() => {
      getInstCount++;
      return { executable: { wasmHash: getInstCount === 1 ? "123" : "456" } };
    });

    let getWasmCount = 0;
    const mockGetContractWasmByContractId = vi.fn().mockImplementation(() => {
      getWasmCount++;
      return getWasmCount === 1 ? mockWasm1 : mockWasm2;
    });

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
          getContractWasmByContractId: mockGetContractWasmByContractId,
        };
      },
    );

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB";
    const opts = { rpcUrl: "http://localhost" };

    const res1 = await loadSpec(contractId, opts);
    expect(res1.source).toBe("wasm");
    expect(mockGetContractInstance).toHaveBeenCalledTimes(1);
    expect(mockGetContractWasmByContractId).toHaveBeenCalledTimes(1);

    const res2 = await loadSpec(contractId, opts);
    expect(res2.source).toBe("wasm");
    expect(mockGetContractInstance).toHaveBeenCalledTimes(2);
    expect(mockGetContractWasmByContractId).toHaveBeenCalledTimes(2);
  });

  it("uses injected spec if available", async () => {
    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB";
    const opts = {
      rpcUrl: "http://localhost",
      specs: { [contractId]: new Uint8Array(10) },
    };

    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe("injected");
    expect(contract.Spec.fromWasm).toHaveBeenCalled();
  });

  it("handles invalid injected spec", async () => {
    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB";
    const opts = {
      rpcUrl: "http://localhost",
      specs: { [contractId]: new Uint8Array(10) },
    };

    (contract.Spec.fromWasm as any).mockImplementationOnce(() => {
      throw new Error("bad");
    });
    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe("none");
    expect(res.warnings[0]?.code).toBe("SPEC_UNAVAILABLE");
  });

  it("returns none if no RPC URL", async () => {
    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB";
    const opts = { rpcUrl: "" };

    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe("none");
  });

  it("handles SAC contracts natively and caches", async () => {
    const mockGetContractInstance = vi.fn().mockResolvedValue({
      executable: { switch: () => ({ name: "contractExecutableToken" }) },
    });

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
        };
      },
    );

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC";
    const opts = { rpcUrl: "http://localhost" };

    const res1 = await loadSpec(contractId, opts);
    expect(res1.source).toBe("sac-builtin");

    const res2 = await loadSpec(contractId, opts);
    expect(res2.source).toBe("sac-builtin");
    // Should call network again for instance to verify it is still SAC
    expect(mockGetContractInstance).toHaveBeenCalledTimes(2);
  });

  it("handles RPC errors", async () => {
    const mockGetContractInstance = vi
      .fn()
      .mockRejectedValue(new Error("Network fail"));

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
        };
      },
    );

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD";
    const opts = { rpcUrl: "http://localhost" };

    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe("none");
    expect(res.warnings[0]?.code).toBe("SPEC_UNAVAILABLE");
  });

  it("handles empty Wasm response from RPC", async () => {
    const mockGetContractInstance = vi
      .fn()
      .mockResolvedValue({ executable: { wasmHash: "123" } });
    const mockGetContractWasmByContractId = vi.fn().mockResolvedValue(null);

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
          getContractWasmByContractId: mockGetContractWasmByContractId,
        };
      },
    );

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB";
    const opts = { rpcUrl: "http://localhost" };

    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe("none");
    expect(res.warnings[0]?.message).toContain("No Wasm returned");
  });

  it("handles Wasm response missing wasmBytes", async () => {
    const mockGetContractInstance = vi
      .fn()
      .mockResolvedValue({ executable: { wasmHash: "123" } });
    const mockGetContractWasmByContractId = vi.fn().mockResolvedValue({}); // Missing wasmBytes

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
          getContractWasmByContractId: mockGetContractWasmByContractId,
        };
      },
    );

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB";
    const opts = { rpcUrl: "http://localhost" };

    const res = await loadSpec(contractId, opts);
    expect(res.source).toBe("none");
    expect(res.warnings[0]?.message).toContain(
      "Wasm response missing wasmBytes",
    );
  });

  it("handles contractExecutableWasm xdr type correctly", async () => {
    const mockGetContractInstance = vi.fn().mockResolvedValue({
      executable: {
        switch: () => ({ name: "contractExecutableWasm" }),
        wasmHash: () => Buffer.from("1234"),
      },
    });
    const mockGetContractWasmByContractId = vi
      .fn()
      .mockResolvedValue(Buffer.alloc(10));

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
          getContractWasmByContractId: mockGetContractWasmByContractId,
        };
      },
    );

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC";
    const opts = { rpcUrl: "http://localhost" };
    const res = await loadSpec(contractId, opts);

    expect(res.source).toBe("wasm");
  });

  it("LRU cache correctly evicts old items and updates existing items", () => {
    const lru = _specCache as any;
    // We mocked its cache map in beforeEach, so let's set it up to test its actual properties
    const RealLruCache = lru.constructor;
    const testLru = new RealLruCache(2);

    // Add two items
    testLru.set("a", 1);
    testLru.set("b", 2);
    expect(testLru.cache.size).toBe(2);

    // Update 'a'
    testLru.set("a", 10);
    expect(testLru.get("a")).toBe(10);

    // Add third item, should evict 'b' since 'a' was recently accessed/updated
    testLru.set("c", 3);
    expect(testLru.get("b")).toBeUndefined();
    expect(testLru.get("a")).toBe(10);
    expect(testLru.get("c")).toBe(3);
  });

  it("computes fallback hash if wasmHash is not available", async () => {
    const mockGetContractInstance = vi
      .fn()
      .mockResolvedValue({ executable: {} }); // No wasmHash
    const mockGetContractWasmByContractId = vi
      .fn()
      .mockResolvedValue(Buffer.alloc(10));

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
          getContractWasmByContractId: mockGetContractWasmByContractId,
        };
      },
    );

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC";
    const opts = { rpcUrl: "http://localhost" };
    const res = await loadSpec(contractId, opts);

    expect(res.source).toBe("wasm");
  });
});

function encodeLeb128U32(val: number): Buffer {
  const bytes: number[] = [];
  let v = val >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function buildWasmWithCustomSection(
  sectionName: string,
  payload: Uint8Array,
): Buffer {
  const header = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const nameBuf = Buffer.from(sectionName, "utf8");
  const nameLenBuf = encodeLeb128U32(nameBuf.byteLength);
  const sectionBody = Buffer.concat([
    nameLenBuf,
    nameBuf,
    Buffer.from(payload),
  ]);
  const sectionSizeBuf = encodeLeb128U32(sectionBody.byteLength);
  return Buffer.concat([
    header,
    Buffer.from([0x00]),
    sectionSizeBuf,
    sectionBody,
  ]);
}

function buildValidSpecEntryBytes(): Buffer {
  const entry = xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: "",
      name: "transfer",
      inputs: [
        new xdr.ScSpecFunctionInputV0({
          doc: "",
          name: "amount",
          type: xdr.ScSpecTypeDef.scSpecTypeI128(),
        }),
      ],
      outputs: [],
    }),
  );
  return Buffer.from(entry.toXDR());
}

describe("resolveContractSpec", () => {
  const VALID_CONTRACT_ID =
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const HTTPS_RPC = "https://soroban-testnet.stellar.org";

  beforeEach(() => {
    _resolvedSpecTtlCache.clear();
    vi.clearAllMocks();
  });

  it("resolves contract spec from Wasm contractspecv0 custom section and caches with injectable clock", async () => {
    const specEntryBytes = buildValidSpecEntryBytes();
    const validWasm = buildWasmWithCustomSection(
      "contractspecv0",
      specEntryBytes,
    );
    const wasmHashHex = "ab".repeat(32);

    const mockGetContractInstance = vi.fn().mockResolvedValue({
      executable: { wasmHash: wasmHashHex },
    });
    const mockGetContractWasmByContractId = vi
      .fn()
      .mockResolvedValue(validWasm);

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
          getContractWasmByContractId: mockGetContractWasmByContractId,
        };
      },
    );

    let currentTime = 1_000_000;
    const clock = () => currentTime;

    const res1 = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: HTTPS_RPC,
      ttlMs: 60_000,
      now: clock,
    });

    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.source).toBe("wasm");
      expect(res1.cached).toBe(false);
      expect(res1.wasmHash).toBe(wasmHashHex);
      expect(res1.entries).toHaveLength(1);
    }
    expect(mockGetContractInstance).toHaveBeenCalledTimes(1);
    expect(mockGetContractWasmByContractId).toHaveBeenCalledTimes(1);

    // Within TTL (t = 1_030_000): returns cached result without calling RPC
    currentTime = 1_030_000;
    const res2 = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: HTTPS_RPC,
      ttlMs: 60_000,
      now: clock,
    });
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.cached).toBe(true);
    }
    expect(mockGetContractInstance).toHaveBeenCalledTimes(1);

    // Past TTL (t = 1_061_000): cache expires and fetches fresh from RPC
    currentTime = 1_061_000;
    const res3 = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: HTTPS_RPC,
      ttlMs: 60_000,
      now: clock,
    });
    expect(res3.ok).toBe(true);
    if (res3.ok) {
      expect(res3.cached).toBe(false);
    }
    expect(mockGetContractInstance).toHaveBeenCalledTimes(2);
  });

  it("supports getLedgerEntries for contract instance and code ledger entries and short-circuits SAC", async () => {
    const specEntryBytes = buildValidSpecEntryBytes();
    const validWasm = buildWasmWithCustomSection(
      "contractspecv0",
      specEntryBytes,
    );
    const wasmHashHex = "cd".repeat(32);

    const mockGetLedgerEntries = vi
      .fn()
      .mockResolvedValueOnce({
        entries: [
          {
            val: {
              contractData: {
                val: {
                  instance: {
                    executable: { wasmHash: wasmHashHex },
                  },
                },
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        entries: [
          {
            val: {
              contractCode: {
                code: validWasm,
              },
            },
          },
        ],
      });

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getLedgerEntries: mockGetLedgerEntries,
        };
      },
    );

    const res = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: HTTPS_RPC,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe("wasm");
      expect(res.wasmHash).toBe(wasmHashHex);
    }
    expect(mockGetLedgerEntries).toHaveBeenCalledTimes(2);

    // SAC short-circuit via getLedgerEntries
    _resolvedSpecTtlCache.clear();
    const sacGetLedgerEntries = vi.fn().mockResolvedValueOnce({
      entries: [
        {
          val: {
            contractData: {
              val: {
                instance: {
                  executable: { stellarAsset: true },
                },
              },
            },
          },
        },
      ],
    });
    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getLedgerEntries: sacGetLedgerEntries,
        };
      },
    );

    const sacRes = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: HTTPS_RPC,
    });
    expect(sacRes.ok).toBe(true);
    if (sacRes.ok) {
      expect(sacRes.source).toBe("sac-builtin");
      expect(sacRes.spec).toBeNull();
    }
    expect(sacGetLedgerEntries).toHaveBeenCalledTimes(1);
  });

  it("handles missing contract without throwing (NOT_FOUND)", async () => {
    const mockGetContractInstance = vi
      .fn()
      .mockRejectedValue(new Error("Contract not found (404)"));

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
        };
      },
    );

    const res = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: HTTPS_RPC,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe("NOT_FOUND");
      expect(res.error.code).toBe("SPEC_UNAVAILABLE");
    }
  });

  it("[SM-04] rejects oversized Wasm binaries exceeding maxWasmBytes (WASM_TOO_LARGE)", async () => {
    const oversizedWasm = Buffer.alloc(2048, 0xaa);
    const mockGetContractInstance = vi.fn().mockResolvedValue({
      executable: { wasmHash: "11".repeat(32) },
    });
    const mockGetContractWasmByContractId = vi
      .fn()
      .mockResolvedValue(oversizedWasm);

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
          getContractWasmByContractId: mockGetContractWasmByContractId,
        };
      },
    );

    const res = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: HTTPS_RPC,
      maxWasmBytes: 1024,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe("WASM_TOO_LARGE");
      expect(res.error.code).toBe("SPEC_UNAVAILABLE");
    }
  });

  it("returns TIMEOUT when RPC request exceeds timeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const mockGetContractInstance = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 10_000)),
        );

      (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        function () {
          return {
            getContractInstance: mockGetContractInstance,
          };
        },
      );

      const pending = resolveContractSpec(VALID_CONTRACT_ID, {
        rpcUrl: HTTPS_RPC,
        timeoutMs: 250,
      });
      await vi.advanceTimersByTimeAsync(250);
      const res = await pending;

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.reason).toBe("TIMEOUT");
        expect(res.error.code).toBe("SIMULATION_UNAVAILABLE");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles malformed Wasm and missing or corrupt contractspecv0 section", async () => {
    // 1. Wasm missing contractspecv0 custom section
    const wasmWithoutSpec = buildWasmWithCustomSection(
      "othersection",
      Buffer.from([1, 2, 3, 4]),
    );
    const mockGetContractInstance = vi.fn().mockResolvedValue({
      executable: { wasmHash: "22".repeat(32) },
    });
    const mockGetWasm = vi
      .fn()
      .mockResolvedValueOnce(wasmWithoutSpec)
      .mockResolvedValueOnce(
        buildWasmWithCustomSection(
          "contractspecv0",
          Buffer.from([0xff, 0xff, 0xff, 0xff]),
        ),
      );

    (rpc.Server as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () {
        return {
          getContractInstance: mockGetContractInstance,
          getContractWasmByContractId: mockGetWasm,
        };
      },
    );

    const missingRes = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: HTTPS_RPC,
    });
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.error.reason).toBe("SPEC_SECTION_MISSING");
    }

    // 2. Wasm with corrupt XDR inside contractspecv0
    const malformedRes = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: HTTPS_RPC,
    });
    expect(malformedRes.ok).toBe(false);
    if (!malformedRes.ok) {
      expect(malformedRes.error.reason).toBe("MALFORMED_SPEC");
    }

    // 3. Direct extractContractSpecSection edge cases (short buffer, bad magic)
    expect(extractContractSpecSection(Buffer.from([1, 2])).ok).toBe(false);
    expect(
      extractContractSpecSection(Buffer.from([0, 0, 0, 0, 1, 0, 0, 0])).ok,
    ).toBe(false);
  });

  it("enforces https-only RPC URLs and optional allowlist", async () => {
    const httpRes = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: "http://soroban-testnet.stellar.org",
    });
    expect(httpRes.ok).toBe(false);
    if (!httpRes.ok) {
      expect(httpRes.error.reason).toBe("INVALID_RPC_URL");
    }

    const notAllowedRes = await resolveContractSpec(VALID_CONTRACT_ID, {
      rpcUrl: HTTPS_RPC,
      allowlist: ["https://trusted-rpc.example.com"],
    });
    expect(notAllowedRes.ok).toBe(false);
    if (!notAllowedRes.ok) {
      expect(notAllowedRes.error.reason).toBe("RPC_NOT_ALLOWED");
    }

    const badIdRes = await resolveContractSpec("GNOTACONTRACT", {
      rpcUrl: HTTPS_RPC,
    });
    expect(badIdRes.ok).toBe(false);
    if (!badIdRes.ok) {
      expect(badIdRes.error.reason).toBe("INVALID_CONTRACT_ID");
    }
  });
});
