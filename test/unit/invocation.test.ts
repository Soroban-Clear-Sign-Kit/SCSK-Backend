import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeInvocation } from "../../src/invocation.js";
import * as spec from "../../src/spec.js";
import * as scval from "../../src/scval.js";
import { xdr, Address, Keypair } from "@stellar/stellar-sdk";

vi.mock("../../src/spec.js", async () => {
  const actual: any = await vi.importActual("../../src/spec.js");
  return {
    ...actual,
    loadSpec: vi.fn(),
  };
});
vi.mock("../../src/scval.js");

describe("decodeInvocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decodes classic operations with warnings", async () => {
    const op = { type: "payment", func: null };
    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.warnings).toContainEqual({
      code: "CLASSIC_OP_NOT_DECODED",
      message: "Operation is not invokeHostFunction",
    });
    expect(res.invocation.functionName).toBe("payment");
  });

  it("decodes sac-builtin with arg count mismatch", async () => {
    const keypair = Keypair.random();
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeInvokeContract" }),
            invokeContract: () => ({
              contractAddress: () =>
                Address.fromString(keypair.publicKey()).toScAddress(),
              functionName: "transfer",
              args: () => [1, 2, 3, 4], // Transfer takes 3 args
            }),
          }),
        }),
      }),
    };

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: null,
      source: "sac-builtin",
      warnings: [],
    });
    vi.mocked(scval.decodeScVal).mockReturnValue({
      value: { kind: "int", type: "u32", value: "1" } as any,
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.warnings).toContainEqual({
      code: "ARG_COUNT_MISMATCH",
      message: "Argument count does not match SAC definition",
    });
    expect(res.invocation.args.length).toBe(4);
  });

  it("decodes spec with missing func matching", async () => {
    const keypair = Keypair.random();
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeInvokeContract" }),
            invokeContract: () => ({
              contractAddress: () =>
                Address.fromString(keypair.publicKey()).toScAddress(),
              functionName: "unknown",
              args: () => [1],
            }),
          }),
        }),
      }),
    };

    const mockSpec = {
      getFunc: (name: string) => undefined,
    };

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: mockSpec as any,
      source: "wasm",
      warnings: [],
    });
    vi.mocked(scval.decodeScVal).mockReturnValue({
      value: { kind: "int", type: "u32", value: "1" } as any,
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.invocation.args.length).toBe(1);
    expect(res.invocation.args[0]?.name).toBeNull();
  });

  it("decodes spec with arg count mismatch and type mismatch", async () => {
    const keypair = Keypair.random();
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeInvokeContract" }),
            invokeContract: () => ({
              contractAddress: () =>
                Address.fromString(keypair.publicKey()).toScAddress(),
              functionName: "swap",
              args: () => [{ type: "scvI32" }],
            }),
          }),
        }),
      }),
    };

    const mockSpec = {
      getFunc: (name: string) => ({
        inputs: [
          { name: "amount", type: { type: "scSpecTypeU32" } },
          { name: "to", type: { type: "scSpecTypeAddress" } },
        ],
      }),
    };

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: mockSpec as any,
      source: "wasm",
      warnings: [],
    });
    vi.mocked(scval.decodeScVal).mockReturnValue({
      value: { kind: "int", type: "u32", value: "1" } as any,
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.warnings).toContainEqual({
      code: "ARG_COUNT_MISMATCH",
      message: "Argument count does not match contract spec",
    });
    expect(res.warnings).toContainEqual({
      code: "ARG_TYPE_MISMATCH",
      message: "Expected u32, got i32",
    });
    expect(res.invocation.args.length).toBe(1);
  });

  it("decodes sac-builtin with missing function definition", async () => {
    const keypair = Keypair.random();
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeInvokeContract" }),
            invokeContract: () => ({
              contractAddress: () =>
                Address.fromString(keypair.publicKey()).toScAddress(),
              functionName: "unknown_sac_func",
              args: () => [1],
            }),
          }),
        }),
      }),
    };

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: null,
      source: "sac-builtin",
      warnings: [],
    });
    vi.mocked(scval.decodeScVal).mockReturnValue({
      value: { kind: "int", type: "u32", value: "1" } as any,
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.invocation.args.length).toBe(1);
    expect(res.invocation.args[0]?.name).toBeNull();
  });

  it("decodes with no spec available", async () => {
    const keypair = Keypair.random();
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeInvokeContract" }),
            invokeContract: () => ({
              contractAddress: () =>
                Address.fromString(keypair.publicKey()).toScAddress(),
              // Test functionName with toString()
              functionName: { toString: () => "my_func" },
              args: () => [1],
            }),
          }),
        }),
      }),
    };

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: null,
      source: "none",
      warnings: [],
    });
    vi.mocked(scval.decodeScVal).mockReturnValue({
      value: { kind: "int", type: "u32", value: "1" } as any,
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.invocation.functionName).toBe("my_func");
    expect(res.invocation.specSource).toBe("none");
    expect(res.invocation.args.length).toBe(1);
    expect(res.invocation.args[0]?.name).toBeNull();
  });

  it("decodes with function name missing toString", async () => {
    const keypair = Keypair.random();

    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeInvokeContract" }),
            invokeContract: () => ({
              contractAddress: () =>
                Address.fromString(keypair.publicKey()).toScAddress(),
              // Test functionName with null, which lacks toString but String(null) === 'null'
              functionName: null,
              args: () => [1],
            }),
          }),
        }),
      }),
    };

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: null,
      source: "none",
      warnings: [],
    });
    vi.mocked(scval.decodeScVal).mockReturnValue({
      value: { kind: "int", type: "u32", value: "1" } as any,
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.invocation.functionName).toBe("null");
  });

  it("decodes create contract v1 with stellar asset", async () => {
    const keypair = Keypair.random();
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeCreateContract" }),
            value: {
              contractIdPreimage: {
                type: "contractIdPreimageFromAddress",
                value: {
                  address: Address.fromString(
                    keypair.publicKey(),
                  ).toScAddress(),
                  salt: Buffer.alloc(32),
                },
              },
              executable: {
                type: "contractExecutableStellarAsset",
              },
            },
          }),
        }),
      }),
    };

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.warnings).toContainEqual({
      code: "CONTRACT_DEPLOYMENT",
      message: "Transaction deploys a contract",
    });
    expect(res.invocation.contractId).toBe("Deploy");
    expect((res.invocation.args[0]?.value as any)?.value).toBe(
      keypair.publicKey(),
    );
    expect((res.invocation.args[2]?.value as any)?.value).toBe("Stellar Asset");
  });

  it("decodes create contract v2", async () => {
    const keypair = Keypair.random();
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeCreateContractV2" }),
            createContractV2: () => ({
              contractIdPreimage: () => ({
                switch: () => ({ name: "contractIdPreimageFromAddress" }),
                value: () => ({
                  address: () =>
                    Address.fromString(keypair.publicKey()).toScAddress(),
                  salt: () => Buffer.alloc(32),
                }),
              }),
              executable: () => ({
                switch: () => ({ name: "contractExecutableStellarAsset" }),
              }),
              constructorArgs: () => [{}],
            }),
          }),
        }),
      }),
    };

    vi.mocked(scval.decodeScVal).mockReturnValue({
      value: { kind: "int", type: "u32", value: "1" } as any,
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.warnings).toContainEqual({
      code: "CONTRACT_DEPLOYMENT",
      message: "Transaction deploys a contract",
    });
    expect(res.invocation.contractId).toBe("Deploy");
    expect((res.invocation.args[0]?.value as any)?.value).toBe(
      keypair.publicKey(),
    );
    expect((res.invocation.args[2]?.value as any)?.value).toBe("Stellar Asset");
    expect(res.invocation.args[3]?.name).toBe("constructorArg[0]");
  });

  it("decodes upload wasm", async () => {
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeUploadContractWasm" }),
            value: Buffer.alloc(100),
          }),
        }),
      }),
    };

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.warnings).toContainEqual({
      code: "WASM_UPLOAD",
      message: "Transaction uploads contract code",
    });
    expect(res.invocation.contractId).toBe("Upload");
    expect((res.invocation.args[0]?.value as any)?.value).toBe("100");
  });

  it("handles unknown invoke function", async () => {
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "unknown" }),
          }),
        }),
      }),
    };

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.invocation.contractId).toBe("");
    expect(res.invocation.functionName).toBe("Unknown");
  });

  it("decodes create contract v1 with wasm executable", async () => {
    const keypair = Keypair.random();
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeCreateContract" }),
            value: {
              contractIdPreimage: {
                type: "contractIdPreimageFromAddress",
                value: {
                  address: Address.fromString(
                    keypair.publicKey(),
                  ).toScAddress(),
                  salt: Buffer.alloc(32),
                },
              },
              executable: {
                type: "contractExecutableWasm",
                value: Buffer.alloc(32),
              },
            },
          }),
        }),
      }),
    };

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.warnings).toContainEqual({
      code: "CONTRACT_DEPLOYMENT",
      message: "Transaction deploys a contract",
    });
    expect(res.invocation.contractId).toBe("Deploy");
    expect((res.invocation.args[2]?.value as any)?.value).toHaveLength(64); // 32 bytes hex
  });

  it("decodes create contract v2 with wasm executable", async () => {
    const keypair = Keypair.random();
    const op = {
      body: () => ({
        switch: () => ({ name: "invokeHostFunction" }),
        invokeHostFunction: () => ({
          hostFunction: () => ({
            switch: () => ({ name: "hostFunctionTypeCreateContractV2" }),
            createContractV2: () => ({
              contractIdPreimage: () => ({
                switch: () => ({ name: "contractIdPreimageFromAddress" }),
                value: () => ({
                  address: () =>
                    Address.fromString(keypair.publicKey()).toScAddress(),
                  salt: () => Buffer.alloc(32),
                }),
              }),
              executable: () => ({
                switch: () => ({ name: "contractExecutableWasm" }),
                wasmId: () => Buffer.alloc(32),
              }),
              constructorArgs: () => [{}],
            }),
          }),
        }),
      }),
    };

    vi.mocked(scval.decodeScVal).mockReturnValue({
      value: { kind: "int", type: "u32", value: "1" } as any,
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.warnings).toContainEqual({
      code: "CONTRACT_DEPLOYMENT",
      message: "Transaction deploys a contract",
    });
    expect(res.invocation.contractId).toBe("Deploy");
    expect((res.invocation.args[2]?.value as any)?.value).toHaveLength(64); // 32 bytes hex
    expect(res.invocation.args[3]?.name).toBe("constructorArg[0]");
  });

  it("handles sac-builtin with unknown function name", async () => {
    const op = {
      switch: () => ({ name: "invokeHostFunction" }),
      invokeHostFunctionOp: () => ({
        hostFunction: () => ({
          switch: () => ({ name: "hostFunctionTypeInvokeContract" }),
          invokeContract: () => ({
            contractAddress: Address.contract(Buffer.alloc(32)).toScAddress(),
            functionName: "unknownBuiltin",
            args: [xdr.ScVal.scvU32(1)],
          }),
        }),
        auth: () => [],
      }),
    } as any;

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: null,
      source: "sac-builtin",
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.invocation.args[0]?.name ?? null).toBeNull();
  });

  it("handles invocation without spec", async () => {
    const op = {
      switch: () => ({ name: "invokeHostFunction" }),
      invokeHostFunctionOp: () => ({
        hostFunction: () => ({
          switch: () => ({ name: "hostFunctionTypeInvokeContract" }),
          invokeContract: () => ({
            contractAddress: Address.contract(Buffer.alloc(32)).toScAddress(),
            functionName: "someFunc",
            args: [xdr.ScVal.scvU32(1)],
          }),
        }),
        auth: () => [],
      }),
    } as any;

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: null,
      source: "none",
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.invocation.args[0]?.name ?? null).toBeNull();
  });

  it("handles functionName fallback when string coercion is needed", async () => {
    const op = {
      switch: () => ({ name: "invokeHostFunction" }),
      invokeHostFunctionOp: () => ({
        hostFunction: () => ({
          switch: () => ({ name: "hostFunctionTypeInvokeContract" }),
          invokeContract: () => ({
            contractAddress: Address.contract(Buffer.alloc(32)).toScAddress(),
            functionName: {}, // POJO
            args: [],
          }),
        }),
        auth: () => [],
      }),
    } as any;

    vi.mocked(spec.loadSpec).mockResolvedValue({
      spec: null,
      source: "none",
      warnings: [],
    });

    const res = await decodeInvocation(op, {
      rpcUrl: "",
      networkPassphrase: "",
    });
    expect(res.invocation.functionName).toBe("unknown");
  });
});
