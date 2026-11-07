import {
  rpc,
  Transaction,
  FeeBumpTransaction,
  xdr,
  Address,
  contract,
} from "@stellar/stellar-sdk";
import { WarningCode, WARNING_SEVERITY } from "./errors.js";
import { DisplayValue } from "./types.js";
import { RPC_TIMEOUT_MS, DEFAULT_FEE_WARNING_MULTIPLIER } from "./limits.js";
import { loadSpec, SpecLoaderOptions, SAC_FUNCTIONS } from "./spec.js";
import { decodeScVal } from "./scval.js";
import { withTimeout } from "./timeout.js";
import {
  unwrap,
  getSwitchName,
  toContractId,
  toBuffer,
  getArray,
} from "./accessors.js";

export interface SimulateOptions extends SpecLoaderOptions {
  rpcUrl: string;
  feeWarningMultiplier?: number;
  /** Milliseconds to wait for the RPC before reporting the simulation as unavailable. */
  timeoutMs?: number;
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

export interface SimulationResourceUsage {
  instructions: number;
  readBytes: number;
  writeBytes: number;
  readEntries: number;
  writeEntries: number;
  resourceFee?: string | undefined;
  footprint: {
    readOnly: string[];
    readWrite: string[];
  };
}

export interface SimulationRestorePreamble {
  minResourceFee: string;
  footprint: {
    readOnly: string[];
    readWrite: string[];
  };
  entries: string[];
}

export interface SimulationStateChange {
  type: "created" | "updated" | "deleted" | "unknown";
  key: unknown;
  before: xdr.LedgerEntry | unknown | null;
  after: xdr.LedgerEntry | unknown | null;
}

export interface SimulationSummary {
  status: "success" | "failed" | "needs-restore" | "unavailable";
  risk: "ok" | "review" | "blocked";
  latestLedger?: number | undefined;
  minResourceFee?: string | undefined;
  error?: string | undefined;
  returnValue?: xdr.ScVal | unknown;
  resources?: SimulationResourceUsage | undefined;
  restorePreamble?: SimulationRestorePreamble | undefined;
  auth: (xdr.SorobanAuthorizationEntry | unknown)[];
  events: (xdr.ContractEvent | unknown)[];
  diagnosticEvents: (xdr.DiagnosticEvent | unknown)[];
  stateChanges: SimulationStateChange[];
  warnings: {
    code: WarningCode;
    severity: "review" | "blocked";
    message: string;
  }[];
}

function formatFootprintKey(key: unknown): string {
  if (!key) return "unknown";
  if (typeof key === "string") return key;
  const kObj = unwrap<Record<string, unknown>>(key);
  if (!kObj || typeof kObj !== "object") return String(key);

  if (typeof (kObj as { toXDR?: unknown }).toXDR === "function") {
    const sw = getSwitchName(kObj);
    if (sw === "contractData") {
      const cd = unwrap<Record<string, unknown>>(kObj.contractData);
      const cid = cd ? toContractId(cd.contract) : null;
      if (cid) return `contract_data:${cid}`;
    } else if (sw === "contractCode") {
      const cc =
        unwrap<Record<string, unknown>>(kObj.contractCode) ??
        unwrap<Record<string, unknown>>(kObj._value);
      const ccAttrs = unwrap<Record<string, unknown>>(cc?._attributes) ?? cc;
      const rawHash = unwrap<Record<string, unknown>>(ccAttrs?.hash);
      const hashBuf = toBuffer(rawHash?.value ?? rawHash);
      if (hashBuf) {
        return `contract_code:${hashBuf.toString("hex")}`;
      }
    }
    return (kObj as { toXDR: (fmt: string) => string }).toXDR("base64");
  }

  if ("contract_data" in kObj || "contractData" in kObj) {
    const cd = unwrap<Record<string, unknown>>(
      kObj.contract_data ?? kObj.contractData,
    );
    const contract = cd?.contract ? String(cd.contract) : "unknown";
    const keyPart =
      typeof cd?.key === "string"
        ? `:${cd.key}`
        : cd?.key && typeof cd.key === "object"
          ? `:${JSON.stringify(cd.key)}`
          : "";
    return `contract_data:${contract}${keyPart}`;
  }

  if ("contract_code" in kObj || "contractCode" in kObj) {
    const cc = unwrap<Record<string, unknown>>(
      kObj.contract_code ?? kObj.contractCode,
    );
    const hash = cc?.hash ? String(cc.hash) : "unknown";
    return `contract_code:${hash}`;
  }

  if ("trustline" in kObj) {
    const tl = unwrap<Record<string, unknown>>(kObj.trustline);
    const acc = tl?.account_id ?? tl?.accountId ?? "unknown";
    return `trustline:${String(acc)}`;
  }

  if ("account" in kObj) {
    const acc = unwrap<Record<string, unknown>>(kObj.account);
    const id = acc?.account_id ?? acc?.accountId ?? "unknown";
    return `account:${String(id)}`;
  }

  return JSON.stringify(kObj);
}

function parseTransactionDataResources(
  txDataInput: unknown,
): SimulationResourceUsage | undefined {
  if (!txDataInput) return undefined;

  let txData: unknown = txDataInput;
  if (typeof txData === "string") {
    try {
      txData = xdr.SorobanTransactionData.fromXDR(txData, "base64");
    } catch {
      return undefined;
    }
  } else if (
    typeof txData === "object" &&
    txData !== null &&
    typeof (txData as { build?: unknown }).build === "function"
  ) {
    try {
      txData = (txData as { build: () => unknown }).build();
    } catch {
      // fallback to inspecting raw object
    }
  }

  const dataObj = unwrap<Record<string, unknown>>(txData);
  if (!dataObj || typeof dataObj !== "object") return undefined;

  const inner =
    unwrap<Record<string, unknown>>(dataObj._data) ??
    unwrap<Record<string, unknown>>(dataObj._attributes) ??
    dataObj;

  const resourcesObj = unwrap<Record<string, unknown>>(inner.resources);
  if (!resourcesObj || typeof resourcesObj !== "object") return undefined;

  const fpObj = unwrap<Record<string, unknown>>(resourcesObj.footprint);
  const rawReadOnly = fpObj ? getArray(fpObj.readOnly ?? fpObj.read_only) : [];
  const rawReadWrite = fpObj
    ? getArray(fpObj.readWrite ?? fpObj.read_write)
    : [];

  const readOnly = rawReadOnly.map(formatFootprintKey);
  const readWrite = rawReadWrite.map(formatFootprintKey);

  const instructions = Number(unwrap(resourcesObj.instructions) ?? 0);
  const readBytes = Number(
    unwrap(
      resourcesObj.readBytes ??
        resourcesObj.diskReadBytes ??
        resourcesObj.disk_read_bytes ??
        resourcesObj.read_bytes,
    ) ?? 0,
  );
  const writeBytes = Number(
    unwrap(resourcesObj.writeBytes ?? resourcesObj.write_bytes) ?? 0,
  );

  const rawFee = unwrap(inner.resourceFee ?? inner.resource_fee);
  const resourceFee = rawFee !== undefined ? String(rawFee) : undefined;

  return {
    instructions,
    readBytes,
    writeBytes,
    readEntries: readOnly.length,
    writeEntries: readWrite.length,
    ...(resourceFee !== undefined ? { resourceFee } : {}),
    footprint: {
      readOnly,
      readWrite,
    },
  };
}

function normalizeStateChangeType(
  rawType: unknown,
): "created" | "updated" | "deleted" | "unknown" {
  const sw = getSwitchName(rawType);
  const val: unknown = sw ?? unwrap<unknown>(rawType);
  if (
    val === 1 ||
    val === "created" ||
    val === "ledgerEntryCreated" ||
    val === "LEDGER_ENTRY_CREATED"
  ) {
    return "created";
  }
  if (
    val === 2 ||
    val === "updated" ||
    val === "ledgerEntryUpdated" ||
    val === "LEDGER_ENTRY_UPDATED"
  ) {
    return "updated";
  }
  if (
    val === 3 ||
    val === "deleted" ||
    val === "removed" ||
    val === "ledgerEntryRemoved" ||
    val === "LEDGER_ENTRY_REMOVED"
  ) {
    return "deleted";
  }
  return "unknown";
}

function decodeMaybeLedgerEntry(
  val: unknown,
): xdr.LedgerEntry | unknown | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") {
    try {
      return xdr.LedgerEntry.fromXDR(val, "base64");
    } catch {
      return val;
    }
  }
  return val;
}

/**
 * Converts a parsed or raw Soroban RPC simulation response into a structured SimulationSummary.
 */
export function summarizeSimulation(response: unknown): SimulationSummary {
  const warnings: {
    code: WarningCode;
    severity: "review" | "blocked";
    message: string;
  }[] = [];

  const pushWarning = (code: WarningCode, message: string) => {
    warnings.push({ code, severity: WARNING_SEVERITY[code], message });
  };

  let parsedInput: unknown = response;
  if (typeof response === "string") {
    try {
      parsedInput = JSON.parse(response);
    } catch {
      pushWarning("SIMULATION_UNAVAILABLE", "Malformed simulation JSON");
      return {
        status: "unavailable",
        risk: "blocked",
        auth: [],
        events: [],
        diagnosticEvents: [],
        stateChanges: [],
        warnings,
      };
    }
  }

  if (
    !parsedInput ||
    typeof parsedInput !== "object" ||
    Array.isArray(parsedInput)
  ) {
    pushWarning("SIMULATION_UNAVAILABLE", "Malformed simulation response");
    return {
      status: "unavailable",
      risk: "blocked",
      auth: [],
      events: [],
      diagnosticEvents: [],
      stateChanges: [],
      warnings,
    };
  }

  const obj = parsedInput as Record<string, unknown>;

  const latestLedger =
    typeof obj.latestLedger === "number" && Number.isFinite(obj.latestLedger)
      ? obj.latestLedger
      : typeof obj.latestLedger === "string" && /^\d+$/.test(obj.latestLedger)
        ? parseInt(obj.latestLedger, 10)
        : undefined;

  // Extract diagnostic events and inner ContractEvents
  const rawEvents = getArray(obj.events);
  const diagnosticEvents: (xdr.DiagnosticEvent | unknown)[] = [];
  const events: (xdr.ContractEvent | unknown)[] = [];

  for (const rawEv of rawEvents) {
    if (typeof rawEv === "string") {
      try {
        const diag = xdr.DiagnosticEvent.fromXDR(rawEv, "base64");
        diagnosticEvents.push(diag);
        events.push(unwrap(diag.event) ?? diag);
      } catch {
        pushWarning(
          "EVENT_SHAPE_UNKNOWN",
          "Failed to decode base64 diagnostic event XDR",
        );
      }
    } else if (rawEv && typeof rawEv === "object") {
      diagnosticEvents.push(rawEv);
      const evRecord = rawEv as Record<string, unknown>;
      const innerEvent = unwrap(evRecord.event);
      events.push(innerEvent ?? rawEv);
    }
  }

  // 1. Error response -> blocked
  const isError =
    (typeof rpc?.Api?.isSimulationError === "function" &&
      rpc.Api.isSimulationError(
        parsedInput as rpc.Api.SimulateTransactionResponse,
      )) ||
    (typeof obj.error === "string" && obj.error.length > 0) ||
    (obj.error !== undefined && obj.error !== null && obj.error !== false);

  if (isError) {
    const errorMsg =
      typeof obj.error === "string" && obj.error.length > 0
        ? obj.error
        : "Simulation failed";
    pushWarning("SIMULATION_FAILED", errorMsg);
    return {
      status: "failed",
      risk: "blocked",
      error: errorMsg,
      ...(latestLedger !== undefined ? { latestLedger } : {}),
      auth: [],
      events,
      diagnosticEvents,
      stateChanges: [],
      warnings,
    };
  }

  // Extract resources & minResourceFee
  const resources = parseTransactionDataResources(obj.transactionData);
  const minResourceFee =
    obj.minResourceFee !== undefined && obj.minResourceFee !== null
      ? String(obj.minResourceFee)
      : resources?.resourceFee;

  // Extract auth & returnValue from result or results[0]
  const rawResult = unwrap<Record<string, unknown>>(obj.result);
  const rawResultsArr = getArray<Record<string, unknown>>(obj.results);
  const firstRawResult = rawResultsArr[0];

  const rawAuthList = rawResult
    ? getArray(rawResult.auth)
    : firstRawResult
      ? getArray(firstRawResult.auth)
      : [];

  const auth: (xdr.SorobanAuthorizationEntry | unknown)[] = rawAuthList.map(
    (entry) => {
      if (typeof entry === "string") {
        try {
          return xdr.SorobanAuthorizationEntry.fromXDR(entry, "base64");
        } catch {
          return entry;
        }
      }
      return entry;
    },
  );

  let returnValue: xdr.ScVal | unknown;
  if (rawResult && "retval" in rawResult) {
    returnValue = unwrap(rawResult.retval);
  } else if (firstRawResult && typeof firstRawResult.xdr === "string") {
    try {
      returnValue = xdr.ScVal.fromXDR(firstRawResult.xdr, "base64");
    } catch {
      returnValue = firstRawResult.xdr;
    }
  }

  // Extract stateChanges
  const rawStateChanges = getArray<Record<string, unknown>>(obj.stateChanges);
  const stateChanges: SimulationStateChange[] = rawStateChanges
    .filter((sc) => sc && typeof sc === "object")
    .map((sc) => {
      const changeType = normalizeStateChangeType(sc.type);
      let key: unknown = unwrap(sc.key);
      if (typeof key === "string") {
        try {
          key = xdr.LedgerKey.fromXDR(key, "base64");
        } catch {
          // keep string if not valid XDR
        }
      }
      const before = decodeMaybeLedgerEntry(unwrap(sc.before));
      const after = decodeMaybeLedgerEntry(unwrap(sc.after));
      return {
        type: changeType,
        key,
        before,
        after,
      };
    });

  // 2. Restore preamble -> needs-restore & review
  const rawPreamble = unwrap<Record<string, unknown>>(obj.restorePreamble);
  const hasRestorePreamble =
    (typeof rpc?.Api?.isSimulationRestore === "function" &&
      rpc.Api.isSimulationRestore(
        parsedInput as rpc.Api.SimulateTransactionResponse,
      )) ||
    Boolean(
      rawPreamble &&
      typeof rawPreamble === "object" &&
      (rawPreamble.transactionData !== undefined ||
        rawPreamble.minResourceFee !== undefined),
    );

  if (hasRestorePreamble) {
    const preambleResources = parseTransactionDataResources(
      rawPreamble?.transactionData,
    );
    const footprint = preambleResources?.footprint ?? {
      readOnly: [],
      readWrite: [],
    };
    const entries = [...footprint.readOnly, ...footprint.readWrite];
    const restoreFee =
      rawPreamble?.minResourceFee !== undefined
        ? String(rawPreamble.minResourceFee)
        : (preambleResources?.resourceFee ?? "0");

    pushWarning(
      "RESTORE_REQUIRED",
      "Restore required: archived ledger state must be restored before invocation",
    );

    const hasBlocked = warnings.some((w) => w.severity === "blocked");

    return {
      status: "needs-restore",
      risk: hasBlocked ? "blocked" : "review",
      ...(latestLedger !== undefined ? { latestLedger } : {}),
      ...(minResourceFee !== undefined ? { minResourceFee } : {}),
      ...(returnValue !== undefined ? { returnValue } : {}),
      ...(resources !== undefined ? { resources } : {}),
      restorePreamble: {
        minResourceFee: restoreFee,
        footprint,
        entries,
      },
      auth,
      events,
      diagnosticEvents,
      stateChanges,
      warnings,
    };
  }

  // 3. Success response
  const isSuccess =
    (typeof rpc?.Api?.isSimulationSuccess === "function" &&
      rpc.Api.isSimulationSuccess(
        parsedInput as rpc.Api.SimulateTransactionResponse,
      )) ||
    minResourceFee !== undefined ||
    resources !== undefined ||
    rawResult !== undefined ||
    firstRawResult !== undefined;

  if (!isSuccess) {
    pushWarning(
      "SIMULATION_UNAVAILABLE",
      "Unknown or incomplete simulation response",
    );
    return {
      status: "unavailable",
      risk: "blocked",
      ...(latestLedger !== undefined ? { latestLedger } : {}),
      auth: [],
      events,
      diagnosticEvents,
      stateChanges: [],
      warnings,
    };
  }

  const hasBlocked = warnings.some((w) => w.severity === "blocked");
  const hasReview = warnings.some((w) => w.severity === "review");

  return {
    status: "success",
    risk: hasBlocked ? "blocked" : hasReview ? "review" : "ok",
    ...(latestLedger !== undefined ? { latestLedger } : {}),
    ...(minResourceFee !== undefined ? { minResourceFee } : {}),
    ...(returnValue !== undefined ? { returnValue } : {}),
    ...(resources !== undefined ? { resources } : {}),
    auth,
    events,
    diagnosticEvents,
    stateChanges,
    warnings,
  };
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

  try {
    response = await withTimeout(
      server.simulateTransaction(innerTx),
      opts.timeoutMs ?? RPC_TIMEOUT_MS,
    );
  } catch (err: unknown) {
    const message =
      err &&
      typeof err === "object" &&
      "message" in err &&
      typeof (err as { message: unknown }).message === "string"
        ? (err as { message: string }).message
        : "";
    warnings.push({
      code: "SIMULATION_UNAVAILABLE",
      message: message || "RPC unreachable or timed out",
    });
    return { status: "unavailable", warnings };
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
