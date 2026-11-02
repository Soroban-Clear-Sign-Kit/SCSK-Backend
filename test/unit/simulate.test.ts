import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { simulateTransaction, summarizeSimulation } from "../../src/simulate";
import { decodeAuthEntries } from "../../src/auth";
import { decodeEvent } from "../../src/events";
import { decodeLedgerEntry } from "../../src/state";
import {
  Transaction,
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
  StrKey,
} from "@stellar/stellar-sdk";
import * as spec from "../../src/spec";
import { RPC_TIMEOUT_MS } from "../../src/limits";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
            return Promise.reject(
              (tx as any)._throw === true
                ? new Error("RPC Timeout")
                : (tx as any)._throw,
            );
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

    const sim = await simulateTransaction(tx as unknown as Transaction, {
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

  it("honours a custom timeoutMs", async () => {
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
        timeoutMs: 250,
      });
      await vi.advanceTimersByTimeAsync(250);
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

    const sim = await simulateTransaction(tx as unknown as Transaction, {
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

    const sim = await simulateTransaction(tx as unknown as Transaction, {
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

    const sim = await simulateTransaction(tx as unknown as Transaction, {
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

    const sim = await simulateTransaction(tx as unknown as Transaction, {
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

    const sim = await simulateTransaction(tx as unknown as Transaction, {
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

  it("handles simulation error as plain object with message or primitive", async () => {
    const tx1 = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .setTimeout(10)
      .build();
    (tx1 as any)._throw = { message: "Object error message" };

    const sim1 = await simulateTransaction(tx1, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });
    expect(sim1.status).toBe("unavailable");
    expect(sim1.warnings).toContainEqual(
      expect.objectContaining({ message: "Object error message" }),
    );

    const tx2 = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .setTimeout(10)
      .build();
    (tx2 as any)._throw = "Plain string failure";

    const sim2 = await simulateTransaction(tx2, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });
    expect(sim2.status).toBe("unavailable");
    expect(sim2.warnings).toContainEqual(
      expect.objectContaining({ message: "RPC unreachable or timed out" }),
    );
  });

  it("decodes retval with functionName having toString method", async () => {
    const tx = {
      fee: "100",
      operations: [
        {
          func: {
            switch: () => ({ name: "hostFunctionTypeInvokeContract" }),
            invokeContract: () => ({
              contractAddress: Address.contract(Buffer.alloc(32)).toScAddress(),
              functionName: { toString: () => "testWithToString" },
              args: [],
            }),
          },
        },
      ],

      _mockSim: {
        minResourceFee: "10",
        latestLedger: 100,
        events: [],
        result: {
          retval: xdr.ScVal.scvU32(42),
        },
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

    const sim = await simulateTransaction(tx as unknown as Transaction, {
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });
    expect(sim.status).toBe("success");
    expect(sim.returnValue).toEqual({ kind: "int", type: "u32", value: "42" });

    isSimulationErrorMock.mockRestore();
    isSimulationRestoreMock.mockRestore();
    isSimulationSuccessMock.mockRestore();
  });
});

describe("summarizeSimulation", () => {
  const fixturesDir = path.join(__dirname, "../fixtures");

  it("summarizes recorded testnet success fixture (sac_transfer.json) and feeds auth, events, and stateChanges", async () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "sac_transfer.json"), "utf8"),
    );
    const summary = summarizeSimulation(raw.sim);

    expect(summary.status).toBe("success");
    expect(summary.risk).toBe("ok");
    expect(summary.warnings).toEqual([]);
    expect(summary.latestLedger).toBe(5088282);
    expect(summary.minResourceFee).toBe("19306");
    expect(summary.resources).toEqual({
      instructions: 212317,
      readBytes: 124,
      writeBytes: 124,
      readEntries: 1,
      writeEntries: 1,
      resourceFee: "19306",
      footprint: {
        readOnly: [
          "contract_data:CABCGFWV66KHO5SLOEMOAE6YT2DEWEZL65ZX34DP3Q3556UYA3EKKTYF:ledger_key_contract_instance",
        ],
        readWrite: [
          "trustline:GDSIQKUJFBOV4XW6SSBYIPT5QUKVPBY4KHLNL3AS3CJIK7BRHZFUSQK2",
        ],
      },
    });
    expect(summary.auth).toHaveLength(1);
    expect(summary.events).toHaveLength(3);
    expect(summary.diagnosticEvents).toHaveLength(3);
    expect(summary.stateChanges).toHaveLength(1);
    expect(summary.stateChanges[0]?.type).toBe("updated");

    // Feeds decodeAuthEntries (B1)
    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: null,
      source: "sac-builtin",
      warnings: [],
    });
    const decodedAuth = await decodeAuthEntries(
      summary.auth,
      summary.latestLedger ?? 0,
      { rpcUrl: "", networkPassphrase: Networks.TESTNET },
    );
    expect(decodedAuth.auth).toHaveLength(1);
    expect(decodedAuth.auth[0]?.root.functionName).toBe("transfer");

    // Feeds decodeEvent
    const decodedEv = await decodeEvent(summary.events[1], { rpcUrl: "" });
    expect(decodedEv.type).toBe("contract");
    expect(decodedEv.eventName).toBe("mint");

    // Feeds decodeLedgerEntry
    const decodedAfter = await decodeLedgerEntry(
      summary.stateChanges[0]?.after,
      { rpcUrl: "" },
    );
    expect(decodedAfter.entryType).toBe("trustline");
  });

  it("summarizes recorded testnet error fixture (sim_fail_balance.json) as blocked", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "sim_fail_balance.json"), "utf8"),
    );
    const summary = summarizeSimulation(raw.sim);

    expect(summary.status).toBe("failed");
    expect(summary.risk).toBe("blocked");
    expect(summary.latestLedger).toBe(5088283);
    expect(summary.error).toContain("HostError: Error(Contract, #12)");
    expect(summary.events).toHaveLength(2);
    expect(summary.warnings).toEqual([
      expect.objectContaining({
        code: "SIMULATION_FAILED",
        severity: "blocked",
      }),
    ]);
  });

  it("summarizes recorded testnet restore-required fixture (restore_required.json) with affected footprint entries", async () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "restore_required.json"), "utf8"),
    );
    const summary = summarizeSimulation(raw.sim);

    expect(summary.status).toBe("needs-restore");
    expect(summary.risk).toBe("review");
    expect(summary.latestLedger).toBe(5091200);
    expect(summary.minResourceFee).toBe("24150");
    expect(summary.warnings).toContainEqual(
      expect.objectContaining({
        code: "RESTORE_REQUIRED",
        severity: "review",
      }),
    );
    expect(summary.restorePreamble).toEqual({
      minResourceFee: "58410",
      footprint: {
        readOnly: [],
        readWrite: [
          "contract_data:CBCPBJRLCRZZ3C4EHZPU4WWCYJVIP24XEKRQQKF2CDK7PKAUHEHQBXWL:ledger_key_contract_instance",
          "contract_code:df160cba7e557ab858d52c0f1c12155f0e78fb3270c464042e5accb46a1f49ce",
        ],
      },
      entries: [
        "contract_data:CBCPBJRLCRZZ3C4EHZPU4WWCYJVIP24XEKRQQKF2CDK7PKAUHEHQBXWL:ledger_key_contract_instance",
        "contract_code:df160cba7e557ab858d52c0f1c12155f0e78fb3270c464042e5accb46a1f49ce",
      ],
    });

    // State change feeds decodeLedgerEntry for contract_data
    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: null,
      source: "none",
      warnings: [],
    });
    const beforeState = await decodeLedgerEntry(
      summary.stateChanges[0]?.before,
      { rpcUrl: "" },
    );
    const afterState = await decodeLedgerEntry(summary.stateChanges[0]?.after, {
      rpcUrl: "",
    });
    expect(beforeState.entryType).toBe("contractData");
    expect(beforeState.val).toEqual({ kind: "int", type: "u32", value: "10" });
    expect(afterState.val).toEqual({ kind: "int", type: "u32", value: "11" });
  });

  it("handles malformed JSON strings, null, arrays, and empty objects by failing closed to blocked", () => {
    const badJson = summarizeSimulation("{malformed json");
    expect(badJson.status).toBe("unavailable");
    expect(badJson.risk).toBe("blocked");
    expect(badJson.warnings[0]?.code).toBe("SIMULATION_UNAVAILABLE");

    const arrResp = summarizeSimulation("[1, 2, 3]");
    expect(arrResp.status).toBe("unavailable");
    expect(arrResp.risk).toBe("blocked");

    const nullResp = summarizeSimulation(null);
    expect(nullResp.status).toBe("unavailable");
    expect(nullResp.risk).toBe("blocked");

    const emptyObj = summarizeSimulation({});
    expect(emptyObj.status).toBe("unavailable");
    expect(emptyObj.risk).toBe("blocked");
    expect(emptyObj.warnings[0]?.code).toBe("SIMULATION_UNAVAILABLE");
  });

  it("parses raw base64 XDR fields, XDR LedgerKeys, SorobanDataBuilder, and state change types", () => {
    const contractBytes = Buffer.alloc(32, 9);
    const contractId = StrKey.encodeContract(contractBytes);

    const lkContractData = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.contract(contractBytes).toScAddress(),
        key: xdr.ScVal.scvSymbol("k"),
        durability: xdr.ContractDataDurability.persistent,
      }),
    );
    const lkContractCode = xdr.LedgerKey.contractCode(
      new xdr.LedgerKeyContractCode({
        hash: Buffer.alloc(32, 5),
      }),
    );
    const lkAccount = xdr.LedgerKey.account(
      new xdr.LedgerKeyAccount({
        accountId: Keypair.random().xdrPublicKey(),
      }),
    );

    const txDataXdr = new xdr.SorobanTransactionData({
      ext: xdr.SorobanTransactionDataExt.v0(),
      resources: new xdr.SorobanResources({
        footprint: new xdr.LedgerFootprint({
          readOnly: [lkContractData, lkAccount],
          readWrite: [lkContractCode],
        }),
        instructions: 1000,
        diskReadBytes: 200,
        writeBytes: 300,
      }),
      resourceFee: xdr.Int64.fromString("4500"),
    });

    const contractEventObj = new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: contractBytes as unknown as xdr.ContractId,
      type: xdr.ContractEventType.contract,
      body: xdr.ContractEventBody.v0(
        new xdr.ContractEventV0({
          topics: [xdr.ScVal.scvSymbol("evt")],
          data: xdr.ScVal.scvU32(7),
        }),
      ),
    });

    const diagEventXdr = new xdr.DiagnosticEvent({
      inSuccessfulContractCall: true,
      event: new xdr.ContractEvent({
        ext: xdr.ExtensionPoint.v0(),
        contractId: null,
        type: xdr.ContractEventType.system,
        body: xdr.ContractEventBody.v0(
          new xdr.ContractEventV0({
            topics: [xdr.ScVal.scvSymbol("sys")],
            data: xdr.ScVal.scvU32(1),
          }),
        ),
      }),
    });

    const ledgerEntryXdr = new xdr.LedgerEntry({
      lastModifiedLedgerSeq: 10,
      data: xdr.LedgerEntryData.contractData(
        new xdr.ContractDataEntry({
          ext: xdr.ExtensionPoint.v0(),
          contract: Address.contract(contractBytes).toScAddress(),
          key: xdr.ScVal.scvSymbol("k"),
          durability: xdr.ContractDataDurability.persistent,
          val: xdr.ScVal.scvU32(99),
        }),
      ),
      ext: xdr.LedgerEntryExt.v0(),
    });

    const authEntryXdr = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function:
          xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
              contractAddress: Address.contract(contractBytes).toScAddress(),
              functionName: "fn",
              args: [],
            }),
          ),
        subInvocations: [],
      }),
    });

    const rawResponseJson = JSON.stringify({
      latestLedger: "555",
      transactionData: txDataXdr.toXDR("base64"),
      events: [diagEventXdr.toXDR("base64"), "not-valid-base64-xdr!!!"],
      results: [
        {
          auth: [authEntryXdr.toXDR("base64"), "fallback-raw-auth"],
          xdr: xdr.ScVal.scvU32(123).toXDR("base64"),
        },
      ],
      stateChanges: [
        {
          type: 1,
          key: lkContractData.toXDR("base64"),
          before: null,
          after: ledgerEntryXdr.toXDR("base64"),
        },
        {
          type: 3,
          key: { account: { account_id: "GABC" } },
          before: "not-valid-ledger-entry-xdr",
          after: null,
        },
        {
          type: 99,
          key: "raw_key_string",
          before: null,
          after: null,
        },
      ],
    });

    const summary = summarizeSimulation(rawResponseJson);
    expect(summary.status).toBe("success");
    expect(summary.risk).toBe("review"); // due to 1 invalid event XDR -> EVENT_SHAPE_UNKNOWN
    expect(summary.latestLedger).toBe(555);
    expect(summary.minResourceFee).toBe("4500");
    expect(summary.resources?.instructions).toBe(1000);
    expect(summary.resources?.readBytes).toBe(200);
    expect(summary.resources?.writeBytes).toBe(300);
    expect(summary.resources?.footprint.readOnly[0]).toBe(
      `contract_data:${contractId}`,
    );
    expect(summary.resources?.footprint.readWrite[0]).toBe(
      `contract_code:${Buffer.alloc(32, 5).toString("hex")}`,
    );
    expect(summary.auth).toHaveLength(2);
    expect(summary.stateChanges[0]?.type).toBe("created");
    expect(summary.stateChanges[1]?.type).toBe("deleted");
    expect(summary.stateChanges[2]?.type).toBe("unknown");

    // Also test SorobanDataBuilder-like object with .build() and unknown key object
    const builderResp = summarizeSimulation({
      minResourceFee: "100",
      events: [contractEventObj, diagEventXdr],
      transactionData: {
        build: () => txDataXdr,
      },
      restorePreamble: {
        transactionData: {
          resources: {
            footprint: {
              readOnly: [null, 42, { custom: true }],
              readWrite: [],
            },
          },
          resourceFee: "900",
        },
      },
    });
    expect(builderResp.status).toBe("needs-restore");
    expect(builderResp.restorePreamble?.minResourceFee).toBe("900");
    expect(builderResp.restorePreamble?.entries).toEqual([
      "unknown",
      "42",
      '{"custom":true}',
    ]);
  });
});
