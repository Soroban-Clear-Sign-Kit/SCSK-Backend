import { describe, it, expect } from "vitest";
import {
  unwrap,
  getSwitchName,
  toContractId,
  toBuffer,
  getArray,
  getDiagnosticEventInfo,
  getAuthContractFnInfo,
  getInvokeContractInfo,
  getCreateContractInfo,
  getSimulationResultInfo,
} from "../../src/accessors.js";
import { xdr, Address, StrKey } from "@stellar/stellar-sdk";

describe("typed XDR accessors", () => {
  const contractBytes = Buffer.alloc(32, 7);
  const contractId = StrKey.encodeContract(contractBytes);

  it("unwrap handles null, undefined, primitives, getters, and objects", () => {
    expect(unwrap(null)).toBeUndefined();
    expect(unwrap(undefined)).toBeUndefined();
    expect(unwrap(123)).toBe(123);
    expect(unwrap(() => "hello")).toBe("hello");
    expect(unwrap({ a: 1 })).toEqual({ a: 1 });
  });

  it("getSwitchName handles string, objects with switch(), type, or name", () => {
    expect(getSwitchName(null)).toBeUndefined();
    expect(getSwitchName("custom")).toBe("custom");
    expect(getSwitchName({ switch: () => "arm1" })).toBe("arm1");
    expect(getSwitchName({ switch: () => ({ name: "arm2" }) })).toBe("arm2");
    expect(getSwitchName({ type: "scvVoid" })).toBe("scvVoid");
    expect(getSwitchName({ name: "namedType" })).toBe("namedType");
  });

  it("toContractId handles C... string, 64-char hex, Uint8Array, Buffer, and ScAddress", () => {
    expect(toContractId(null)).toBeNull();
    expect(toContractId(contractId)).toBe(contractId);
    expect(toContractId(contractBytes.toString("hex"))).toBe(contractId);
    expect(toContractId("invalid-hex-non-64")).toBeNull();
    expect(toContractId(contractBytes)).toBe(contractId);
    expect(toContractId(new Uint8Array(contractBytes))).toBe(contractId);
    expect(toContractId(Buffer.alloc(10))).toBeNull(); // not 32 bytes

    const scAddress = Address.contract(contractBytes).toScAddress();
    expect(toContractId(scAddress)).toBe(contractId);
  });

  it("toBuffer handles Buffer, Uint8Array, hex, and utf8 string", () => {
    expect(toBuffer(null)).toBeNull();
    const buf = Buffer.from("test");
    expect(toBuffer(buf)).toBe(buf);
    expect(toBuffer(new Uint8Array([1, 2, 3]))).toEqual(Buffer.from([1, 2, 3]));
    expect(toBuffer("01020304")).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(toBuffer("non-hex-string")).toEqual(
      Buffer.from("non-hex-string", "utf8"),
    );
  });

  it("getArray handles null, undefined, function getter, and array", () => {
    expect(getArray(null)).toEqual([]);
    expect(getArray([1, 2])).toEqual([1, 2]);
    expect(getArray(() => [3, 4])).toEqual([3, 4]);
  });

  it("getDiagnosticEventInfo parses diagnostic event shapes", () => {
    expect(getDiagnosticEventInfo(null)).toBeNull();

    const scAddress = Address.contract(contractBytes).toScAddress();
    const diag = {
      inSuccessfulContractCall: true,
      event: {
        type: { switch: () => ({ name: "contractEventTypeContract" }) },
        contractId: scAddress,
        body: {
          v0: {
            topics: [xdr.ScVal.scvSymbol("transfer")],
            data: xdr.ScVal.scvU32(10),
          },
        },
      },
    };

    const info = getDiagnosticEventInfo(diag);
    expect(info).not.toBeNull();
    expect(info?.isSuccess).toBe(true);
    expect(info?.type).toBe("contractEventTypeContract");
    expect(info?.contractId).toBe(contractId);
    expect(info?.topics).toHaveLength(1);
    expect(info?.data).toBeDefined();
  });

  it("getAuthContractFnInfo parses contract_fn structure", () => {
    expect(getAuthContractFnInfo(null)).toBeNull();
    expect(getAuthContractFnInfo({})).toBeNull();

    const fnInfo = getAuthContractFnInfo({
      contractFn: {
        contractAddress: contractId,
        functionName: "swap",
        args: [1, 2],
      },
    });

    expect(fnInfo).not.toBeNull();
    expect(fnInfo?.contractId).toBe(contractId);
    expect(fnInfo?.functionName).toBe("swap");
    expect(fnInfo?.args).toEqual([1, 2]);
  });

  it("getInvokeContractInfo parses invokeContract structure", () => {
    expect(getInvokeContractInfo(null)).toBeNull();
    expect(getInvokeContractInfo({})).toBeNull();

    const inv = getInvokeContractInfo({
      invokeContract: {
        contractAddress: contractId,
        functionName: "deposit",
        args: [100],
      },
    });

    expect(inv).not.toBeNull();
    expect(inv?.contractId).toBe(contractId);
    expect(inv?.functionName).toBe("deposit");
    expect(inv?.args).toEqual([100]);
  });

  it("getCreateContractInfo parses v1 and v2 createContract", () => {
    expect(getCreateContractInfo(null)).toBeNull();
    expect(getCreateContractInfo({})).toBeNull();

    const v1 = getCreateContractInfo({
      createContract: {
        contractIdPreimage: {
          salt: Buffer.alloc(32, 1),
        },
        executable: {
          switch: () => "contractExecutableWasm",
          wasmHash: Buffer.alloc(32, 2),
        },
      },
    });

    expect(v1).not.toBeNull();
    expect(v1?.isV2).toBe(false);
    expect(v1?.executableType).toBe("wasm");
    expect(v1?.salt).toBe(Buffer.alloc(32, 1).toString("hex"));
    expect(v1?.wasmHash).toBe(Buffer.alloc(32, 2).toString("hex"));

    const v2 = getCreateContractInfo({
      createContractV2: {
        contractIdPreimage: {},
        executable: { token: true },
        constructorArgs: [1, 2],
      },
    });

    expect(v2).not.toBeNull();
    expect(v2?.isV2).toBe(true);
    expect(v2?.executableType).toBe("sac");
    expect(v2?.constructorArgs).toEqual([1, 2]);
  });

  it("getSimulationResultInfo parses simulation response", () => {
    expect(getSimulationResultInfo(null)).toBeNull();

    const sim = getSimulationResultInfo({
      minResourceFee: "1500",
      latestLedger: 12345,
      events: [{ id: 1 }],
      result: {
        auth: [{ a: 1 }],
        retval: "ok",
      },
    });

    expect(sim).not.toBeNull();
    expect(sim?.minResourceFee).toBe("1500");
    expect(sim?.latestLedger).toBe(12345);
    expect(sim?.events).toHaveLength(1);
    expect(sim?.auth).toHaveLength(1);
    expect(sim?.retval).toBe("ok");

    const simStringLedger = getSimulationResultInfo({
      latestLedger: "9999",
      result: null,
    });
    expect(simStringLedger?.latestLedger).toBe(9999);
    expect(simStringLedger?.auth).toEqual([]);
  });

  it("getAuthContractFnInfo handles invalid contract address and alias", () => {
    expect(
      getAuthContractFnInfo({
        contract_fn: {
          contract_address: "invalid",
          function_name: 123,
        },
      }),
    ).toBeNull();

    const ok = getAuthContractFnInfo({
      contract_fn: {
        contract_address: contractId,
        function_name: 123,
      },
    });
    expect(ok?.functionName).toBe("123");
  });

  it("getInvokeContractInfo handles invalid contract address and alias", () => {
    expect(
      getInvokeContractInfo({
        invoke_contract: {
          contract_address: "invalid",
          function_name: 123,
        },
      }),
    ).toBeNull();

    const ok = getInvokeContractInfo({
      invoke_contract: {
        contract_address: contractId,
        function_name: 123,
      },
    });
    expect(ok?.functionName).toBe("123");
  });

  it("getCreateContractInfo handles aliases and unknown executable", () => {
    const info = getCreateContractInfo({
      switch: () => "hostFunctionTypeCreateContractV2",
      create_contract_v2: {
        executable: {
          wasm_hash: Buffer.alloc(32, 3),
        },
      },
    });
    expect(info?.isV2).toBe(true);
    expect(info?.executableType).toBe("wasm");

    const unknownExec = getCreateContractInfo({
      create_contract: {
        executable: {},
      },
    });
    expect(unknownExec?.executableType).toBe("unknown");
  });
});
