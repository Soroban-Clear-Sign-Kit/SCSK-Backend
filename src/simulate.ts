import {
  rpc,
  Transaction,
  FeeBumpTransaction,
  xdr,
  Address,
  contract,
} from "@stellar/stellar-sdk";
import { WarningCode } from "./errors.js";
import { DisplayValue } from "./types.js";
import { RPC_TIMEOUT_MS, DEFAULT_FEE_WARNING_MULTIPLIER } from "./limits.js";
import { loadSpec, SpecLoaderOptions, SAC_FUNCTIONS } from "./spec.js";
import { decodeScVal } from "./scval.js";
import { unwrap, getSwitchName } from "./accessors.js";

export interface SimulateOptions extends SpecLoaderOptions {
  rpcUrl: string;
  feeWarningMultiplier?: number | undefined;
}

export interface SimulationResult {
  status: "success" | "failed" | "needs-restore" | "unavailable" | "skipped";
  minResourceFee?: string | undefined;
  error?: string | undefined;
  returnValue?: DisplayValue | undefined;
  latestLedger?: number | undefined;
  events?: xdr.DiagnosticEvent[] | undefined;
  auth?: xdr.SorobanAuthorizationEntry[] | undefined;
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
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "RPC unreachable or timed out";
    warnings.push({
      code: "SIMULATION_UNAVAILABLE",
      message: message || "RPC unreachable or timed out",
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
    const respRecord = response as unknown as Record<string, unknown>;
    const latestLedger =
      typeof respRecord.latestLedger === "number" ? respRecord.latestLedger : 0;
    return {
      status: "failed",
      error: response.error,
      warnings,
      latestLedger,
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
      let returnType: xdr.ScSpecTypeDef | null = null;
      let spec: contract.Spec | null = null;

      const op = innerTx.operations[0];
      if (op && op.type === "invokeHostFunction" && op.func) {
        const f = op.func as unknown as Record<string, unknown>;
        const funcSwitch = getSwitchName(f);
        if (funcSwitch === "hostFunctionTypeInvokeContract") {
          const invokeArgs =
            unwrap<Record<string, unknown>>(f.invokeContract) ?? f;
          const contractAddressObj = unwrap(invokeArgs.contractAddress);
          const contractId = Address.fromScAddress(
            contractAddressObj as xdr.ScAddress,
          ).toString();
          const rawFn = unwrap<string | { toString: () => string }>(
            invokeArgs.functionName,
          );
          const functionName =
            typeof rawFn === "string"
              ? rawFn
              : typeof (rawFn as { toString?: unknown })?.toString ===
                  "function"
                ? (rawFn as { toString: () => string }).toString()
                : String(rawFn ?? "");

          const specResult = await loadSpec(contractId, opts);
          if (specResult.spec) {
            spec = specResult.spec;
            const funcEntry = spec.getFunc(functionName);
            if (funcEntry && funcEntry.outputs.length > 0) {
              returnType = funcEntry.outputs[0] ?? null;
            }
          } else if (specResult.source === "sac-builtin") {
            const sacDef = SAC_FUNCTIONS[functionName];
            if (sacDef && sacDef.outputs && sacDef.outputs.length > 0) {
              returnType =
                (sacDef.outputs[0] as unknown as xdr.ScSpecTypeDef) ?? null;
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

    const result: SimulationResult = {
      status: "success",
      minResourceFee,
      latestLedger,
      events,
      auth,
      warnings,
      ...(returnValue !== undefined ? { returnValue } : {}),
    };
    return result;
  }

  warnings.push({
    code: "SIMULATION_UNAVAILABLE",
    message: "Unknown simulation response type",
  });
  return { status: "unavailable", warnings };
}
