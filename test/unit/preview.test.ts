import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildPreview } from "../../src/preview";
import * as envelope from "../../src/envelope";
import * as simulate from "../../src/simulate";
import * as invocation from "../../src/invocation";
import * as auth from "../../src/auth";
import * as effects from "../../src/effects";
import * as intent from "../../src/intent";
import * as tokens from "../../src/tokens";
import * as risk from "../../src/risk";
import * as summary from "../../src/summary";
import {
  rpc,
  Keypair,
  TransactionBuilder,
  Account,
  Networks,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";

vi.mock("../../src/envelope");
vi.mock("../../src/simulate");
vi.mock("../../src/invocation");
vi.mock("../../src/auth");
vi.mock("../../src/effects");
vi.mock("../../src/intent");
vi.mock("../../src/tokens");
vi.mock("../../src/risk");
vi.mock("../../src/summary");
vi.mock("@stellar/stellar-sdk", async () => {
  const actual = (await vi.importActual("@stellar/stellar-sdk")) as any;
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getNetwork: vi.fn(),
        getLatestLedger: vi.fn(),
      })),
    },
  };
});

describe("buildPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns blocked on parse envelope failure", async () => {
    vi.mocked(envelope.parseEnvelope).mockReturnValue({
      success: false,
      error: { code: "ENVELOPE_MALFORMED", message: "malformed" },
    });

    const res = await buildPreview({
      xdr: "bad",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
    });

    expect(res.risk).toBe("blocked");
    expect(res.simulation.status).toBe("skipped");
    expect(res.warnings).toEqual([
      { code: "ENVELOPE_MALFORMED", message: "malformed", severity: "blocked" },
    ]);
  });

  it("returns blocked on network mismatch", async () => {
    vi.mocked(envelope.parseEnvelope).mockReturnValue({
      success: true,
      warnings: [{ code: "NETWORK_MISMATCH", message: "mismatch" }],
      envelope: { source: "", sequence: "", fee: "", operations: [] } as any,
      innerTransaction: { operations: [] } as any,
      signatureBound: false,
    });

    const res = await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
    });

    expect(res.risk).toBe("blocked");
    expect(res.simulation.status).toBe("skipped");
  });

  it("sets severities for warnings", async () => {
    vi.mocked(envelope.parseEnvelope).mockReturnValue({
      success: true,
      warnings: [],
      envelope: { source: "", sequence: "", fee: "", operations: [] } as any,
      innerTransaction: {
        operations: [{ type: "invokeHostFunction", func: {} }],
      } as any,
      signatureBound: false,
    });

    // Return a warning to trigger lines 142-144
    vi.mocked(invocation.decodeInvocation).mockResolvedValue({
      invocation: {
        contractId: "CC",
        functionName: "test",
        args: [],
        specSource: "none",
      },
      warnings: [{ code: "SPEC_UNAVAILABLE", message: "test" }],
    });

    vi.mocked(simulate.simulateTransaction).mockResolvedValue({
      status: "unavailable",
      warnings: [],
    });
    vi.mocked(effects.extractTokenEffects).mockReturnValue({
      effects: [],
      warnings: [],
    });
    vi.mocked(tokens.resolveTokenMetadata).mockResolvedValue({ warnings: [] });
    vi.mocked(auth.decodeAuthEntries).mockResolvedValue({
      auth: [],
      warnings: [],
    });
    vi.mocked(intent.verifyIntent).mockReturnValue({ warnings: [] });
    vi.mocked(summary.generateSummary).mockReturnValue([]);
    vi.mocked(risk.computeRisk).mockReturnValue("review");

    const res = await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
    });

    expect(res.warnings.length).toBe(1);
    expect(res.warnings[0]?.severity).toBe("review");
  });

  it("returns internal error on throw", async () => {
    vi.mocked(envelope.parseEnvelope).mockImplementation(() => {
      throw new Error("Something exploded");
    });

    const res = await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
    });

    expect(res.risk).toBe("blocked");
    expect(res.warnings.length).toBe(1);
    expect(res.warnings[0]?.code).toBe("INTERNAL_ERROR");
    expect(res.warnings[0]?.message).toBe("Something exploded");
    expect(res.warnings[0]?.severity).toBe("blocked");
  });

  it("does not log internal errors when options.debug is unset", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(envelope.parseEnvelope).mockImplementation(() => {
      throw new Error("hidden error");
    });

    const res = await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
    });

    expect(res.warnings[0]?.code).toBe("INTERNAL_ERROR");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs internal error stack when options.debug is true", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(envelope.parseEnvelope).mockImplementation(() => {
      throw new Error("visible error");
    });

    await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
      options: { debug: true },
    });

    expect(spy).toHaveBeenCalledWith(
      "INTERNAL_ERROR Stack:",
      expect.stringContaining("visible error"),
    );
    spy.mockRestore();
  });

  it("sets rpcMatches to false if getNetwork fails", async () => {
    vi.mocked(envelope.parseEnvelope).mockReturnValue({
      success: true,
      warnings: [],
      envelope: { source: "", sequence: "", fee: "", operations: [] } as any,
      innerTransaction: {
        operations: [{ type: "invokeHostFunction", func: {} }],
      } as any,
      signatureBound: false,
    });
    vi.mocked(invocation.decodeInvocation).mockResolvedValue({
      invocation: {
        contractId: "CC",
        functionName: "test",
        args: [],
        specSource: "none",
      },
      warnings: [],
    });
    vi.mocked(simulate.simulateTransaction).mockResolvedValue({
      status: "unavailable",
      warnings: [],
    });
    vi.mocked(effects.extractTokenEffects).mockReturnValue({
      effects: [],
      warnings: [],
    });
    vi.mocked(tokens.resolveTokenMetadata).mockResolvedValue({ warnings: [] });
    vi.mocked(auth.decodeAuthEntries).mockResolvedValue({
      auth: [],
      warnings: [],
    });
    vi.mocked(intent.verifyIntent).mockReturnValue({ warnings: [] });
    vi.mocked(summary.generateSummary).mockReturnValue([]);
    vi.mocked(risk.computeRisk).mockReturnValue("ok");

    const mockGetNetwork = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.mocked(rpc.Server).mockImplementation(
      () =>
        ({
          getNetwork: mockGetNetwork,
          getLatestLedger: vi.fn().mockResolvedValue({ sequence: 100 }),
        }) as any,
    );

    const res = await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
    });

    expect(res.network.rpcMatches).toBe(false);
    expect(res.network.passphrase).toBe("test");
  });

  it("prioritizes auth from transaction over simulation", async () => {
    vi.mocked(envelope.parseEnvelope).mockReturnValue({
      success: true,
      warnings: [],
      envelope: { source: "", sequence: "", fee: "", operations: [] } as any,
      innerTransaction: {
        operations: [{ type: "invokeHostFunction", auth: ["tx-auth"] }],
      } as any,
      signatureBound: false,
    });
    vi.mocked(invocation.decodeInvocation).mockResolvedValue({
      invocation: {
        contractId: "CC",
        functionName: "test",
        args: [],
        specSource: "none",
      },
      warnings: [],
    });
    vi.mocked(simulate.simulateTransaction).mockResolvedValue({
      status: "success",
      auth: ["sim-auth" as any],
      latestLedger: 100,
      warnings: [],
      events: [],
    });
    vi.mocked(effects.extractTokenEffects).mockReturnValue({
      effects: [],
      warnings: [],
    });
    vi.mocked(tokens.resolveTokenMetadata).mockResolvedValue({ warnings: [] });
    vi.mocked(auth.decodeAuthEntries).mockResolvedValue({
      auth: [],
      warnings: [],
    });
    vi.mocked(intent.verifyIntent).mockReturnValue({ warnings: [] });
    vi.mocked(summary.generateSummary).mockReturnValue([]);
    vi.mocked(risk.computeRisk).mockReturnValue("ok");

    const mockGetNetwork = vi.fn().mockResolvedValue({ passphrase: "test" });
    vi.mocked(rpc.Server).mockImplementation(
      () =>
        ({
          getNetwork: mockGetNetwork,
          getLatestLedger: vi.fn().mockResolvedValue({ sequence: 100 }),
        }) as any,
    );

    await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
    });

    expect(auth.decodeAuthEntries).toHaveBeenCalledWith(
      ["tx-auth"],
      expect.anything(),
      expect.anything(),
    );
  });

  it("includes memo, feeBump and timeBounds in the preview envelope", async () => {
    vi.mocked(envelope.parseEnvelope).mockReturnValue({
      success: true,
      warnings: [],
      envelope: {
        source: "S",
        sequence: "1",
        fee: "100",
        memo: { type: "text", value: "hello" },
        timeBounds: { min: "0", max: "0" },
        feeBump: { feeSource: "S", fee: "200" },
        operations: [],
      } as any,
      innerTransaction: { operations: [] } as any,
      signatureBound: false,
    });
    vi.mocked(invocation.decodeInvocation).mockResolvedValue({
      invocation: {
        contractId: "CC",
        functionName: "test",
        args: [],
        specSource: "none",
      },
      warnings: [],
    });
    vi.mocked(simulate.simulateTransaction).mockResolvedValue({
      status: "skipped",
      warnings: [],
    });
    vi.mocked(effects.extractTokenEffects).mockReturnValue({
      effects: [],
      warnings: [],
    });
    vi.mocked(tokens.resolveTokenMetadata).mockResolvedValue({ warnings: [] });
    vi.mocked(auth.decodeAuthEntries).mockResolvedValue({
      auth: [],
      warnings: [],
    });
    vi.mocked(intent.verifyIntent).mockReturnValue({ warnings: [] });
    vi.mocked(summary.generateSummary).mockReturnValue([]);
    vi.mocked(risk.computeRisk).mockReturnValue("ok");

    const mockGetNetwork = vi.fn().mockResolvedValue({ passphrase: "test" });
    vi.mocked(rpc.Server).mockImplementation(
      () =>
        ({
          getNetwork: mockGetNetwork,
          getLatestLedger: vi.fn().mockResolvedValue({ sequence: 100 }),
        }) as any,
    );

    const res = await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
    });

    expect(res.envelope.memo).toEqual({ type: "text", value: "hello" });
    expect(res.envelope.timeBounds).toEqual({ min: "0", max: "0" });
    expect(res.envelope.feeBump).toEqual({ feeSource: "S", fee: "200" });
  });

  it("passes options.now to envelope intake for TX_EXPIRED", async () => {
    let capturedOptions: any;
    vi.mocked(envelope.parseEnvelope).mockImplementation(
      (xdr, np, rp, opts) => {
        capturedOptions = opts;
        return {
          success: true,
          tx: {} as any,
          innerTransaction: {
            source: "S",
            sequence: "1",
            fee: "100",
            operations: [],
          } as any,
          envelope: {
            source: "S",
            sequence: "1",
            fee: "100",
            operations: [],
          },
          warnings: [],
          signatureBound: false,
        };
      },
    );

    const nowFn = () => 1700000000000;
    await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
      options: { now: nowFn },
    });

    expect(capturedOptions?.now).toBe(nowFn);
  });

  it("signed on Testnet, previewed as Public, gives SIGNATURE_INVALID", async () => {
    const actualEnvelope =
      await vi.importActual<typeof import("../../src/envelope")>(
        "../../src/envelope",
      );
    vi.mocked(envelope.parseEnvelope).mockImplementation(
      actualEnvelope.parseEnvelope,
    );

    const mockGetNetwork = vi
      .fn()
      .mockResolvedValue({ passphrase: Networks.PUBLIC });
    vi.mocked(rpc.Server).mockImplementation(
      () =>
        ({
          getNetwork: mockGetNetwork,
          getLatestLedger: vi.fn().mockResolvedValue({ sequence: 100 }),
        }) as any,
    );

    const kp = Keypair.random();
    const tx = new TransactionBuilder(new Account(kp.publicKey(), "1"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: kp.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(0)
      .build();
    tx.sign(kp);

    const res = await buildPreview({
      xdr: tx.toXDR(),
      rpcUrl: "http://mock",
      networkPassphrase: Networks.PUBLIC,
    });

    expect(res.risk).toBe("blocked");
    expect(res.network.signatureBound).toBe(false);
    expect(res.warnings).toContainEqual(
      expect.objectContaining({
        code: "SIGNATURE_INVALID",
        severity: "blocked",
      }),
    );
  });

  it("unsigned gives signatureBound false and no warning", async () => {
    const actualEnvelope =
      await vi.importActual<typeof import("../../src/envelope")>(
        "../../src/envelope",
      );
    vi.mocked(envelope.parseEnvelope).mockImplementation(
      actualEnvelope.parseEnvelope,
    );

    const mockGetNetwork = vi
      .fn()
      .mockResolvedValue({ passphrase: Networks.TESTNET });
    vi.mocked(rpc.Server).mockImplementation(
      () =>
        ({
          getNetwork: mockGetNetwork,
          getLatestLedger: vi.fn().mockResolvedValue({ sequence: 100 }),
        }) as any,
    );

    const kp = Keypair.random();
    const tx = new TransactionBuilder(new Account(kp.publicKey(), "1"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: kp.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(0)
      .build();

    vi.mocked(simulate.simulateTransaction).mockResolvedValue({
      status: "skipped",
      warnings: [],
    });
    vi.mocked(effects.extractTokenEffects).mockReturnValue({
      effects: [],
      warnings: [],
    });
    vi.mocked(tokens.resolveTokenMetadata).mockResolvedValue({ warnings: [] });
    vi.mocked(auth.decodeAuthEntries).mockResolvedValue({
      auth: [],
      warnings: [],
    });
    vi.mocked(intent.verifyIntent).mockReturnValue({ warnings: [] });
    vi.mocked(summary.generateSummary).mockReturnValue([]);
    vi.mocked(risk.computeRisk).mockReturnValue("ok");

    const res = await buildPreview({
      xdr: tx.toXDR(),
      rpcUrl: "http://mock",
      networkPassphrase: Networks.TESTNET,
    });

    expect(res.network.signatureBound).toBe(false);
    expect(res.warnings.some((w) => w.code === "SIGNATURE_INVALID")).toBe(
      false,
    );
  });
});

describe("buildPreview options", () => {
  const passingEnvelope = () =>
    vi.mocked(envelope.parseEnvelope).mockReturnValue({
      success: true,
      warnings: [],
      envelope: { source: "", sequence: "", fee: "", operations: [] } as any,
      innerTransaction: {
        source: "GSOURCE",
        operations: [{ type: "invokeHostFunction", func: {} }],
      } as any,
    });

  const arrange = (
    server: { getNetwork?: any; getLatestLedger?: any } = {},
  ) => {
    passingEnvelope();
    vi.mocked(invocation.decodeInvocation).mockResolvedValue({
      invocation: {
        contractId: "CC",
        functionName: "f",
        args: [],
        specSource: "none",
      },
      warnings: [],
    });
    vi.mocked(simulate.simulateTransaction).mockResolvedValue({
      status: "success",
      latestLedger: 100,
      events: [],
      auth: [],
      warnings: [],
    });
    vi.mocked(effects.extractTokenEffects).mockReturnValue({
      effects: [],
      warnings: [],
    });
    vi.mocked(tokens.resolveTokenMetadata).mockResolvedValue({ warnings: [] });
    vi.mocked(auth.decodeAuthEntries).mockResolvedValue({
      auth: [],
      warnings: [],
    });
    vi.mocked(intent.verifyIntent).mockReturnValue({ warnings: [] });
    vi.mocked(summary.generateSummary).mockReturnValue([]);
    vi.mocked(risk.computeRisk).mockReturnValue("ok");
    vi.mocked(rpc.Server).mockImplementation(
      () =>
        ({
          getNetwork: vi.fn().mockResolvedValue({ passphrase: "test" }),
          getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1 }),
          ...server,
        }) as any,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards rpcTimeoutMs to simulation", async () => {
    arrange();

    await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
      options: { rpcTimeoutMs: 1234 },
    });

    expect(simulate.simulateTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeoutMs: 1234 }),
    );
  });

  it("forwards rpcTimeoutMs to token metadata lookups", async () => {
    arrange();

    await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
      options: { rpcTimeoutMs: 4321 },
    });

    expect(tokens.resolveTokenMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeoutMs: 4321 }),
    );
  });

  it("omits timeoutMs when rpcTimeoutMs is not set", async () => {
    arrange();

    await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
    });

    const simOpts = vi.mocked(simulate.simulateTransaction).mock.calls[0]?.[1];
    expect(simOpts).toBeDefined();
    expect("timeoutMs" in simOpts!).toBe(false);
  });
});

describe("buildPreview RPC timeouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not hang when getNetwork never settles", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(envelope.parseEnvelope).mockReturnValue({
        success: true,
        warnings: [],
        envelope: { source: "", sequence: "", fee: "", operations: [] } as any,
        innerTransaction: { operations: [] } as any,
      });
      vi.mocked(auth.decodeAuthEntries).mockResolvedValue({
        auth: [],
        warnings: [],
      });
      vi.mocked(intent.verifyIntent).mockReturnValue({ warnings: [] });
      vi.mocked(summary.generateSummary).mockReturnValue([]);
      vi.mocked(risk.computeRisk).mockReturnValue("ok");
      vi.mocked(rpc.Server).mockImplementation(
        () =>
          ({
            getNetwork: vi.fn().mockReturnValue(new Promise(() => {})),
            getLatestLedger: vi.fn().mockResolvedValue({ sequence: 5 }),
          }) as any,
      );

      const pending = buildPreview({
        xdr: "ok",
        rpcUrl: "http://mock",
        networkPassphrase: "test",
        options: { rpcTimeoutMs: 500 },
      });
      await vi.advanceTimersByTimeAsync(500);
      const res = await pending;

      expect(res.network.verified).toBe(false);
      expect(res.risk).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildPreview debug logging", () => {
  const explode = () =>
    vi.mocked(envelope.parseEnvelope).mockImplementation(() => {
      throw new Error("kaboom");
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rpc.Server).mockImplementation(
      () =>
        ({
          getNetwork: vi.fn().mockResolvedValue({ passphrase: "test" }),
          getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1 }),
        }) as any,
    );
  });

  it("stays quiet about internal errors by default", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    explode();

    const res = await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
    });

    expect(res.warnings[0]?.code).toBe("INTERNAL_ERROR");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs the stack of internal errors when options.debug is true", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    explode();

    await buildPreview({
      xdr: "ok",
      rpcUrl: "http://mock",
      networkPassphrase: "test",
      options: { debug: true },
    });

    expect(spy).toHaveBeenCalledWith(
      "INTERNAL_ERROR Stack:",
      expect.stringContaining("kaboom"),
    );
    spy.mockRestore();
  });
});
