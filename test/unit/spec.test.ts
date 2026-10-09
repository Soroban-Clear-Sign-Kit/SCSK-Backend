import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadSpec, _specCache, _wasmHashCache } from "../../src/spec.js";
import { rpc, contract } from "@stellar/stellar-sdk";

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
