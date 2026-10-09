import {
  rpc,
  Transaction,
  FeeBumpTransaction,
  xdr,
  Address,
} from "@stellar/stellar-sdk";
import { WarningCode } from "./errors.js";
import { DisplayValue } from "./types.js";
import { RPC_TIMEOUT_MS, DEFAULT_FEE_WARNING_MULTIPLIER } from "./limits.js";
import { loadSpec, SpecLoaderOptions, SAC_FUNCTIONS } from "./spec.js";
import { decodeScVal } from "./scval.js";

export interface SimulateOptions extends SpecLoaderOptions {
  rpcUrl: string;
  feeWarningMultiplier?: number;
}

export interface SimulationResult {
  status: "success" | "failed" | "needs-restore" | "unavailable" | "skipped";
  minResourceFee?: string;
  error?: string;
  returnValue?: DisplayValue;
  latestLedger?: number;
  events?: xdr.DiagnosticEvent[];
  auth?: xdr.SorobanAuthorizationEntry[];
  warnings: { code: WarningCode; message: string }[];
}

export async function simulateTransaction(
  tx: Transaction | FeeBumpTransaction,
  opts: SimulateOptions,
): Promise<SimulationResult> {
  const warnings: { code: WarningCode; message: string }[] = [];
  const innerTx = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;

  let response: rpc.Api.SimulateTransactionResponse;
  const server = new rpc.Server(opts.rpcUrl, {
    allowHttp: opts.rpcUrl.startsWith("http://"),
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const simulatePromise = server.simulateTransaction(innerTx);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error("RPC Timeout")),
        RPC_TIMEOUT_MS,
      );
    });
    response = await Promise.race([simulatePromise, timeoutPromise]);
  } catch (err: any) {
    warnings.push({
      code: "SIMULATION_UNAVAILABLE",
      message: err.message || "RPC unreachable or timed out",
    });
    return { status: "unavailable", warnings };
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (rpc.Api.isSimulationError(response)) {
    warnings.push({
      code: "SIMULATION_FAILED",
      message: response.error || "Simulation failed",
    });
    return {
      status: "failed",
      error: response.error,
      warnings,
      latestLedger: (response as any).latestLedger || 0,
    };
  }

  if (rpc.Api.isSimulationRestore(response)) {
    warnings.push({
      code: "RESTORE_REQUIRED",
      message: "Archived state must be restored first",
    });
    return { status: "needs-restore", warnings };
  }

  if (rpc.Api.isSimulationSuccess(response)) {
    const minResourceFee = response.minResourceFee;
    const latestLedger = response.latestLedger;
    const events = response.events;

    let returnValue: DisplayValue | undefined;
    let auth: xdr.SorobanAuthorizationEntry[] = [];

    if (response.result && response.result.auth) {
      auth = response.result.auth;
    }

    if (response.result && response.result.retval) {
      const retScVal = response.result.retval;

      // find the invoke operation to get spec
      let returnType: any = null;
      let spec: any = null;

      const op = innerTx.operations[0];
      if (op && op.type === "invokeHostFunction" && op.func) {
        const f: any = op.func;
        const funcSwitch =
          f && typeof f.switch === "function" ? f.switch().name : f.type;
        if (funcSwitch === "hostFunctionTypeInvokeContract") {
          const invokeArgs =
            typeof f.invokeContract === "function"
              ? f.invokeContract()
              : f.invokeContract;
          const contractAddressObj =
            typeof invokeArgs.contractAddress === "function"
              ? invokeArgs.contractAddress()
              : invokeArgs.contractAddress;
          const contractId =
            Address.fromScAddress(contractAddressObj).toString();
          const rawFn =
            typeof invokeArgs.functionName === "function"
              ? invokeArgs.functionName()
              : invokeArgs.functionName;
          const functionName =
            typeof rawFn === "string" ? rawFn : rawFn.toString();

          const specResult = await loadSpec(contractId, opts);
          if (specResult.spec) {
            spec = specResult.spec;
            const funcEntry = spec.getFunc(functionName);
            if (funcEntry && funcEntry.outputs.length > 0) {
              returnType = funcEntry.outputs[0];
            }
          } else if (specResult.source === "sac-builtin") {
            const sacDef: any = SAC_FUNCTIONS[functionName];
            if (sacDef && sacDef.outputs && sacDef.outputs.length > 0) {
              returnType = sacDef.outputs[0];
            }
          }
        }
      }

      const res = decodeScVal(retScVal, spec, returnType);
      warnings.push(...res.warnings);
      returnValue = res.value;
    }

    const declaredFee = BigInt(tx.fee);
    const simFee = BigInt(minResourceFee || "0");
    const requested = opts.feeWarningMultiplier;
    const multiplier =
      requested !== undefined && Number.isFinite(requested) && requested > 0
        ? requested
        : DEFAULT_FEE_WARNING_MULTIPLIER;
    // Compare in hundredths so fractional multipliers (e.g. 1.5) work with BigInt math.
    const multiplierHundredths = BigInt(Math.round(multiplier * 100));

    if (declaredFee * 100n > simFee * multiplierHundredths) {
      warnings.push({
        code: "FEE_UNUSUALLY_HIGH",
        message: "Declared fee is unusually high compared to simulated fee",
      });
    }

    const result: any = {
      status: "success",
      minResourceFee,
      latestLedger,
      events,
      auth,
      warnings,
    };
    if (returnValue !== undefined) {
      result.returnValue = returnValue;
    }
    return result;
  }

  warnings.push({
    code: "SIMULATION_UNAVAILABLE",
    message: "Unknown simulation response type",
  });
  return { status: "unavailable", warnings };
}
