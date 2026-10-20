import { xdr, Address, hash } from "@stellar/stellar-sdk";
import { Invocation, DecodedArg } from "./types.js";
import { loadSpec, SAC_FUNCTIONS, SpecLoaderOptions } from "./spec.js";
import { decodeScVal } from "./scval.js";
import { WarningCode } from "./errors.js";
import { unwrap, getSwitchName, getArray, toBuffer } from "./accessors.js";

export async function decodeInvocation(
  op: unknown,
  opts: SpecLoaderOptions,
): Promise<{
  invocation: Invocation;
  warnings: { code: WarningCode; message: string }[];
}> {
  const warnings: { code: WarningCode; message: string }[] = [];

  const opRecord = (op ?? {}) as Record<string, unknown>;
  let opType: string | undefined;
  let func: unknown; // could be xdr.HostFunction or parsed HostFunctionInvokeContract

  const opSwitchName = getSwitchName(opRecord);

  if (opRecord.type && !opRecord.body) {
    opType = String(opRecord.type);
    func = opRecord.func;
  } else if (
    (opSwitchName && opSwitchName.startsWith("hostFunctionType")) ||
    opRecord.hostFunction !== undefined ||
    opRecord.invokeContract !== undefined
  ) {
    opType = "invokeHostFunction";
    func = opRecord.hostFunction ?? op;
  } else {
    const body = unwrap<Record<string, unknown>>(opRecord.body);
    opType =
      getSwitchName(body) ??
      (typeof body?.type === "string" ? body.type : undefined);
    if (opType === "invokeHostFunction" && body) {
      const invokeOp = unwrap<Record<string, unknown>>(
        body.invokeHostFunction ?? body.value,
      );
      func = invokeOp ? unwrap(invokeOp.hostFunction) : undefined;
    } else {
      func = null;
    }
  }

  if (opType !== "invokeHostFunction") {
    warnings.push({
      code: "CLASSIC_OP_NOT_DECODED",
      message: "Operation is not invokeHostFunction",
    });
    return {
      invocation: {
        contractId: "",
        functionName: opType || "unknown",
        args: [],
        specSource: "none",
      },
      warnings,
    };
  }

  const funcSwitch = getSwitchName(func);

  if (funcSwitch === "hostFunctionTypeInvokeContract") {
    const funcRecord = (func ?? {}) as Record<string, unknown>;
    const invokeArgs =
      unwrap<Record<string, unknown>>(funcRecord.invokeContract) ?? funcRecord;

    const addrObj = unwrap(invokeArgs.contractAddress);
    const contractId =
      typeof addrObj === "string"
        ? addrObj
        : Address.fromScAddress(addrObj as xdr.ScAddress).toString();

    const rawFnName = unwrap<string | { toString: () => string }>(
      invokeArgs.functionName,
    );
    const functionName =
      typeof rawFnName === "string"
        ? rawFnName
        : typeof (rawFnName as { toString?: unknown })?.toString === "function"
          ? (rawFnName as { toString: () => string }).toString()
          : String(invokeArgs.functionName);

    const args = getArray<xdr.ScVal>(invokeArgs.args);

    const specResult = await loadSpec(contractId, opts);
    warnings.push(...specResult.warnings);

    let decodedArgs: DecodedArg[] = [];

    if (specResult.source === "sac-builtin") {
      const sacDef = SAC_FUNCTIONS[functionName];
      if (sacDef) {
        if (args.length !== sacDef.args.length) {
          warnings.push({
            code: "ARG_COUNT_MISMATCH",
            message: "Argument count does not match SAC definition",
          });
        }
        decodedArgs = args.map((arg: xdr.ScVal | unknown, i: number) => {
          const expected = sacDef.args[i];
          const res = decodeScVal(arg, null, null);
          warnings.push(...res.warnings);
          return {
            name: expected?.name || null,
            typeName: expected?.type || null,
            value: res.value,
          };
        });
      } else {
        decodedArgs = args.map((arg: xdr.ScVal | unknown) => {
          const res = decodeScVal(arg, null, null);
          warnings.push(...res.warnings);
          return { name: null, typeName: null, value: res.value };
        });
      }
    } else if (specResult.spec) {
      const spec = specResult.spec;
      const funcEntry = spec.getFunc(functionName);
      if (funcEntry) {
        const inputs = funcEntry.inputs;
        if (args.length !== inputs.length) {
          warnings.push({
            code: "ARG_COUNT_MISMATCH",
            message: "Argument count does not match contract spec",
          });
        }
        decodedArgs = args.map((arg: xdr.ScVal | unknown, i: number) => {
          const input = inputs[i];
          let name: string | null = null;
          if (input) {
            if (typeof input.name === "string") {
              name = input.name;
            } else if (
              Buffer.isBuffer(input.name) ||
              input.name instanceof Uint8Array
            ) {
              name = Buffer.from(input.name).toString("utf8");
            } else if (input.name) {
              name = String(input.name);
            }
          }
          const typeDef = input ? input.type : null;

          if (typeDef && arg && typeof arg === "object" && "type" in arg) {
            const expectedName = typeDef.type
              .replace("scSpecType", "")
              .toLowerCase();
            const actualName = String((arg as { type: string }).type)
              .replace("scv", "")
              .toLowerCase();

            // Simple type mismatch check for primitives
            const isPrimitive = [
              "u32",
              "i32",
              "u64",
              "i64",
              "u128",
              "i128",
              "u256",
              "i256",
              "bool",
              "void",
              "bytes",
              "string",
              "symbol",
              "address",
            ].includes(expectedName);
            if (isPrimitive && expectedName !== actualName) {
              if (
                !(expectedName === "timepoint" && actualName === "u64") &&
                !(expectedName === "duration" && actualName === "u64")
              ) {
                warnings.push({
                  code: "ARG_TYPE_MISMATCH",
                  message: `Expected ${expectedName}, got ${actualName}`,
                });
              }
            }
          }

          const res = decodeScVal(arg, spec, typeDef);
          warnings.push(...res.warnings);
          return {
            name,
            typeName: typeDef ? typeDef.type : null,
            value: res.value,
          };
        });
      } else {
        decodedArgs = args.map((arg: xdr.ScVal | unknown) => {
          const res = decodeScVal(arg, null, null);
          warnings.push(...res.warnings);
          return { name: null, typeName: null, value: res.value };
        });
      }
    } else {
      decodedArgs = args.map((arg: xdr.ScVal | unknown) => {
        const res = decodeScVal(arg, null, null);
        warnings.push(...res.warnings);
        return { name: null, typeName: null, value: res.value };
      });
    }

    return {
      invocation: {
        contractId,
        functionName,
        args: decodedArgs,
        specSource: specResult.source,
      },
      warnings,
    };
  } else if (
    funcSwitch === "hostFunctionTypeCreateContract" ||
    funcSwitch === "hostFunctionTypeCreateContractV2"
  ) {
    warnings.push({
      code: "CONTRACT_DEPLOYMENT",
      message: "Transaction deploys a contract",
    });

    let deployer = "Unknown";
    let salt = "";
    let executable = "";
    const constructorArgsDecoded: DecodedArg[] = [];

    if (funcSwitch === "hostFunctionTypeCreateContract") {
      const funcRecord = (func ?? {}) as Record<string, unknown>;
      const createArgs =
        unwrap<Record<string, unknown>>(funcRecord.value) ?? funcRecord;

      const pre = unwrap<Record<string, unknown>>(
        createArgs.contractIdPreimage,
      );
      const preType = getSwitchName(pre);
      if (
        pre &&
        (preType === "contractIdPreimageFromAddress" ||
          pre.type === "contractIdPreimageFromAddress")
      ) {
        const preImg = unwrap<Record<string, unknown>>(pre.value) ?? pre;
        const addressVal = unwrap(preImg.address);
        if (addressVal) {
          deployer =
            typeof addressVal === "string"
              ? addressVal
              : Address.fromScAddress(addressVal as xdr.ScAddress).toString();
        }
        const saltBuf = toBuffer(preImg.salt);
        if (saltBuf) salt = saltBuf.toString("hex");
      }

      const exec = unwrap<Record<string, unknown>>(createArgs.executable);
      const execType = getSwitchName(exec);
      if (
        exec &&
        (execType === "contractExecutableWasm" ||
          exec.type === "contractExecutableWasm")
      ) {
        const rawWasm = unwrap(exec.value);
        const wasmBuf = toBuffer(rawWasm);
        if (wasmBuf) executable = wasmBuf.toString("hex");
      } else if (
        exec &&
        (execType === "contractExecutableStellarAsset" ||
          exec.type === "contractExecutableStellarAsset")
      ) {
        executable = "Stellar Asset";
      }
    } else {
      // hostFunctionTypeCreateContractV2
      const funcRecord = (func ?? {}) as Record<string, unknown>;
      const createArgs =
        unwrap<Record<string, unknown>>(
          funcRecord.createContractV2 ??
            funcRecord.value ??
            (funcRecord as { _attributes?: unknown })._attributes,
        ) ?? funcRecord;

      const preimage = unwrap<Record<string, unknown>>(
        createArgs.contractIdPreimage,
      );
      const preType = getSwitchName(preimage);
      if (
        preimage &&
        (preType === "contractIdPreimageFromAddress" ||
          preimage.type === "contractIdPreimageFromAddress")
      ) {
        const preImg =
          unwrap<Record<string, unknown>>(preimage.value) ?? preimage;
        const addressVal = unwrap(preImg.address);
        if (addressVal) {
          deployer =
            typeof addressVal === "string"
              ? addressVal
              : Address.fromScAddress(addressVal as xdr.ScAddress).toString();
        }
        const saltBuf = toBuffer(preImg.salt);
        if (saltBuf) salt = saltBuf.toString("hex");
      }

      const exec = unwrap<Record<string, unknown>>(createArgs.executable);
      const execType = getSwitchName(exec);
      if (
        exec &&
        (execType === "contractExecutableWasm" ||
          exec.type === "contractExecutableWasm")
      ) {
        const rawWasm = unwrap(exec.wasmId ?? exec.value);
        const wasmBuf = toBuffer(rawWasm);
        if (wasmBuf) executable = wasmBuf.toString("hex");
      } else if (
        exec &&
        (execType === "contractExecutableStellarAsset" ||
          exec.type === "contractExecutableStellarAsset")
      ) {
        executable = "Stellar Asset";
      }

      const cArgs = getArray<xdr.ScVal>(createArgs.constructorArgs);
      for (const arg of cArgs) {
        const res = decodeScVal(arg, null, null);
        warnings.push(...res.warnings);
        constructorArgsDecoded.push({
          name: null,
          typeName: null,
          value: res.value,
        });
      }
    }

    const baseArgs: DecodedArg[] = [
      {
        name: "deployer",
        typeName: "address",
        value: {
          kind: "address",
          value: deployer,
          addressType: "account",
        },
      },
      {
        name: "salt",
        typeName: "bytes",
        value: {
          kind: "bytes",
          hex: salt,
          length: salt.length / 2,
          truncated: false,
        },
      },
      {
        name: "executable",
        typeName: "string",
        value: {
          kind: "string",
          value: executable,
          sanitized: false,
          truncated: false,
        },
      },
    ];

    if (funcSwitch === "hostFunctionTypeCreateContractV2") {
      constructorArgsDecoded.forEach((arg, i) => {
        baseArgs.push({
          name: `constructorArg[${i}]`,
          typeName: arg.typeName,
          value: arg.value,
        });
      });
    }

    return {
      invocation: {
        contractId: "Deploy",
        functionName: "Deploy contract",
        args: baseArgs,
        specSource: "none",
      },
      warnings,
    };
  } else if (funcSwitch === "hostFunctionTypeUploadContractWasm") {
    warnings.push({
      code: "WASM_UPLOAD",
      message: "Transaction uploads contract code",
    });

    const funcRecord = (func ?? {}) as Record<string, unknown>;
    const rawVal = unwrap(funcRecord.value);
    const wasmBytes = toBuffer(rawVal) ?? Buffer.alloc(0);
    const wasmHash = Buffer.from(hash(wasmBytes)).toString("hex");

    return {
      invocation: {
        contractId: "Upload",
        functionName: "Upload contract code",
        args: [
          {
            name: "length",
            typeName: "u32",
            value: {
              kind: "int",
              type: "u32",
              value: wasmBytes.length.toString(),
            },
          },
          {
            name: "hash",
            typeName: "bytes",
            value: {
              kind: "bytes",
              hex: wasmHash,
              length: 32,
              truncated: false,
            },
          },
        ],
        specSource: "none",
      },
      warnings,
    };
  }

  return {
    invocation: {
      contractId: "",
      functionName: "Unknown",
      args: [],
      specSource: "none",
    },
    warnings,
  };
}
