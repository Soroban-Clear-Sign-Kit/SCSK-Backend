import { describe, it, expect, vi } from "vitest";
import { simulateTransaction } from "../../src/simulate";
import {
  TransactionBuilder,
  Networks,
  rpc,
  Account,
  Keypair,
  xdr,
  Operation,
  Asset,
  FeeBumpTransaction,
  Address,
} from "@stellar/stellar-sdk";
import * as spec from "../../src/spec";
import { RPC_TIMEOUT_MS } from "../../src/limits";

vi.mock("../../src/spec", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    loadSpec: vi.fn(),
  };
});

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: class MockServer {
        simulateTransaction(tx: any) {
          if ((tx as any)._throw) {
            return Promise.reject(new Error("RPC Timeout"));
          }
          if ((tx as any)._timeout) {
            return new Promise((resolve) => setTimeout(resolve, 20000));
          }
          return Promise.resolve((tx as any)._mockSim);
        }
      },
    },
  };
});

describe("simulateTransaction", () => {
  const account = new Account(Keypair.random().publicKey(), "0");

  it("returns unavailable on error", async () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .setTimeout(10)
      .build();
    (tx as any)._throw = true;

    const sim = await simulateTransaction(tx, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });
    expect(sim.status).toBe("unavailable");
    expect(sim.warnings[0]?.code).toBe("SIMULATION_UNAVAILABLE");
  });

  it("returns unavailable when the RPC call exceeds the timeout", async () => {
    vi.useFakeTimers();
    try {
      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .setTimeout(10)
        .build();
      (tx as any)._timeout = true;

      const pending = simulateTransaction(tx, {
        rpcUrl: "http://mock",
        networkPassphrase: Networks.TESTNET,
      });
      await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS);
      const sim = await pending;

      expect(sim.status).toBe("unavailable");
      expect(sim.warnings[0]?.message).toBe("RPC Timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout timer once the RPC call settles", async () => {
    vi.useFakeTimers();
    try {
      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .setTimeout(10)
        .build();
      (tx as any)._throw = true;

      await simulateTransaction(tx, {
        rpcUrl: "http://mock",
        networkPassphrase: Networks.TESTNET,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns failed on simulation error", async () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .setTimeout(10)
      .build();
    (tx as any)._mockSim = { error: "Failed", _isSimulationError: true };

    const isSimulationErrorMock = vi
      .spyOn(rpc.Api, "isSimulationError")
      .mockReturnValue(true);

    const sim = await simulateTransaction(tx, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });
    expect(sim.status).toBe("failed");
    expect(sim.error).toBe("Failed");
    expect(sim.warnings[0]?.code).toBe("SIMULATION_FAILED");

    isSimulationErrorMock.mockRestore();
  });

  it("returns needs-restore on restore", async () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .setTimeout(10)
      .build();
    (tx as any)._mockSim = { restore: true };

    const isSimulationErrorMock = vi
      .spyOn(rpc.Api, "isSimulationError")
      .mockReturnValue(false);
    const isSimulationRestoreMock = vi
      .spyOn(rpc.Api, "isSimulationRestore")
      .mockReturnValue(true);

    const sim = await simulateTransaction(tx, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });
    expect(sim.status).toBe("needs-restore");
    expect(sim.warnings[0]?.code).toBe("RESTORE_REQUIRED");

    isSimulationErrorMock.mockRestore();
    isSimulationRestoreMock.mockRestore();
  });

  it("returns success on success with high fee warning", async () => {
    const tx = new TransactionBuilder(account, {
      fee: "1000000000",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: account.accountId(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(10)
      .build();
    (tx as any)._mockSim = {
      minResourceFee: "10",
      latestLedger: 100,
      events: [],
    };

    const isSimulationErrorMock = vi
      .spyOn(rpc.Api, "isSimulationError")
      .mockReturnValue(false);
    const isSimulationRestoreMock = vi
      .spyOn(rpc.Api, "isSimulationRestore")
      .mockReturnValue(false);
    const isSimulationSuccessMock = vi
      .spyOn(rpc.Api, "isSimulationSuccess")
      .mockReturnValue(true);

    const sim = await simulateTransaction(tx, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
      feeWarningMultiplier: 2,
    });
    expect(sim.status).toBe("success");
    expect(sim.warnings.some((w) => w.code === "FEE_UNUSUALLY_HIGH")).toBe(
      true,
    );

    isSimulationErrorMock.mockRestore();
    isSimulationRestoreMock.mockRestore();
    isSimulationSuccessMock.mockRestore();
  });

  describe("feeWarningMultiplier", () => {
    const simulateWithFee = async (
      fee: string,
      feeWarningMultiplier?: number,
    ) => {
      const tx = new TransactionBuilder(account, {
        fee,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: account.accountId(),
            asset: Asset.native(),
            amount: "10",
          }),
        )
        .setTimeout(10)
        .build();
      (tx as any)._mockSim = {
        minResourceFee: "100",
        latestLedger: 100,
        events: [],
      };

      const spies = [
        vi.spyOn(rpc.Api, "isSimulationError").mockReturnValue(false),
        vi.spyOn(rpc.Api, "isSimulationRestore").mockReturnValue(false),
        vi.spyOn(rpc.Api, "isSimulationSuccess").mockReturnValue(true),
      ];
      try {
        const opts =
          feeWarningMultiplier === undefined
            ? { rpcUrl: "http://mock", networkPassphrase: Networks.TESTNET }
            : {
                rpcUrl: "http://mock",
                networkPassphrase: Networks.TESTNET,
                feeWarningMultiplier,
              };
        return await simulateTransaction(tx, opts);
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
    };
    const hasFeeWarning = (sim: { warnings: { code: string }[] }) =>
      sim.warnings.some((w) => w.code === "FEE_UNUSUALLY_HIGH");

    it("supports fractional multipliers without throwing", async () => {
      const over = await simulateWithFee("151", 1.5);
      expect(over.status).toBe("success");
      expect(hasFeeWarning(over)).toBe(true);

      const atLimit = await simulateWithFee("150", 1.5);
      expect(atLimit.status).toBe("success");
      expect(hasFeeWarning(atLimit)).toBe(false);
    });

    it("falls back to the default multiplier for invalid values", async () => {
      for (const invalid of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(hasFeeWarning(await simulateWithFee("1000", invalid))).toBe(
          false,
        );
        expect(hasFeeWarning(await simulateWithFee("1001", invalid))).toBe(
          true,
        );
      }
    });

    it("uses the default multiplier when none is provided", async () => {
      expect(hasFeeWarning(await simulateWithFee("1000"))).toBe(false);
      expect(hasFeeWarning(await simulateWithFee("1001"))).toBe(true);
    });
  });

  it("handles fee bump transactions", async () => {
    const inner = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: account.accountId(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(10)
      .build();
    (inner as any)._throw = true;
    const feeBump = Object.create(FeeBumpTransaction.prototype);
    Object.defineProperty(feeBump, "innerTransaction", {
      value: inner,
      writable: true,
    });

    const sim = await simulateTransaction(feeBump, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });
    expect(sim.status).toBe("unavailable");
  });

  it("parses auth and retval for host functions", async () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: Address.contract(Buffer.alloc(32)).toScAddress(),
              functionName: "test",
              args: [],
            }),
          ),
          auth: [],
        }),
      )
      .setTimeout(10)
      .build();

    (tx as any)._mockSim = {
      minResourceFee: "10",
      latestLedger: 100,
      events: [],
      result: {
        auth: [{ credentials: { type: "address" } }], // Mock auth
        retval: xdr.ScVal.scvU32(42),
      },
    };

    const isSimulationErrorMock = vi
      .spyOn(rpc.Api, "isSimulationError")
      .mockReturnValue(false);
    const isSimulationRestoreMock = vi
      .spyOn(rpc.Api, "isSimulationRestore")
      .mockReturnValue(false);
    const isSimulationSuccessMock = vi
      .spyOn(rpc.Api, "isSimulationSuccess")
      .mockReturnValue(true);

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: { getFunc: () => ({ outputs: ["u32"] }) } as any,
      source: "wasm",
      warnings: [],
    });

    const sim = await simulateTransaction(tx, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });
    expect(sim.status).toBe("success");
    expect(sim.auth?.length).toBe(1);
    expect(sim.returnValue).toEqual({ kind: "int", type: "u32", value: "42" });

    isSimulationErrorMock.mockRestore();
    isSimulationRestoreMock.mockRestore();
    isSimulationSuccessMock.mockRestore();
  });

  it("falls through unknown simulation response", async () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .setTimeout(10)
      .build();
    (tx as any)._mockSim = {};

    const isSimulationErrorMock = vi
      .spyOn(rpc.Api, "isSimulationError")
      .mockReturnValue(false);
    const isSimulationRestoreMock = vi
      .spyOn(rpc.Api, "isSimulationRestore")
      .mockReturnValue(false);
    const isSimulationSuccessMock = vi
      .spyOn(rpc.Api, "isSimulationSuccess")
      .mockReturnValue(false);

    const sim = await simulateTransaction(tx, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });
    expect(sim.status).toBe("unavailable");

    isSimulationErrorMock.mockRestore();
    isSimulationRestoreMock.mockRestore();
    isSimulationSuccessMock.mockRestore();
  });

  it("parses retval for sac-builtin functions", async () => {
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: Address.contract(Buffer.alloc(32)).toScAddress(),
              functionName: "balance", // sac-builtin function
              args: [],
            }),
          ),
          auth: [],
        }),
      )
      .setTimeout(10)
      .build();

    (tx as any)._mockSim = {
      minResourceFee: "10",
      latestLedger: 100,
      events: [],
      result: {
        retval: xdr.ScVal.scvI128(
          new xdr.Int128Parts({
            lo: xdr.Uint64.fromString("100"),
            hi: xdr.Int64.fromString("0"),
          }),
        ),
      },
    };

    const isSimulationErrorMock = vi
      .spyOn(rpc.Api, "isSimulationError")
      .mockReturnValue(false);
    const isSimulationRestoreMock = vi
      .spyOn(rpc.Api, "isSimulationRestore")
      .mockReturnValue(false);
    const isSimulationSuccessMock = vi
      .spyOn(rpc.Api, "isSimulationSuccess")
      .mockReturnValue(true);

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: null,
      source: "sac-builtin",
      warnings: [],
    });

    const sim = await simulateTransaction(tx, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });
    expect(sim.status).toBe("success");
    expect(sim.returnValue).toEqual({
      kind: "int",
      type: "i128",
      value: "100",
    });

    isSimulationErrorMock.mockRestore();
    isSimulationRestoreMock.mockRestore();
    isSimulationSuccessMock.mockRestore();
  });
});
