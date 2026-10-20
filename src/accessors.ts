import { xdr, Address, StrKey } from "@stellar/stellar-sdk";

/**
 * Typed XDR and parsed JSON accessors.
 * Replaces ad-hoc `any` casts when navigating js-xdr objects or parsed simulation outputs.
 */

/** Safely calls getter if function, or returns val */
export function unwrap<T = unknown>(val: unknown): T | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "function") {
    return (val as () => T)();
  }
  return val as T;
}

/** Extracts union arm or switch name (e.g. "contractEventTypeContract", "scvVoid", "source_account") */
export function getSwitchName(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === "string") return val;
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.switch === "function") {
      const sw = obj.switch() as unknown;
      if (typeof sw === "string") return sw;
      if (sw && typeof sw === "object" && "name" in sw) {
        return String((sw as { name: unknown }).name);
      }
    }
    if (typeof obj.type === "string") return obj.type;
    if (obj.name && typeof obj.name === "string") return obj.name;
  }
  return undefined;
}

/** Safely converts a raw contract address object or string into a StrKey 'C...' contract address */
export function toContractId(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "string") {
    if (val.startsWith("C") && val.length === 56) return val;
    if (val.length === 64) {
      try {
        return StrKey.encodeContract(Buffer.from(val, "hex"));
      } catch {
        return null;
      }
    }
  }

  const raw = unwrap(val);
  if (!raw) return null;

  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    try {
      if (raw.length === 32) return StrKey.encodeContract(Buffer.from(raw));
    } catch {
      return null;
    }
  }

  try {
    return Address.fromScAddress(raw as xdr.ScAddress).toString();
  } catch {
    return null;
  }
}

/** Safely extracts Buffer from Buffer, Uint8Array, hex string, or wrapper object */
export function toBuffer(val: unknown): Buffer | null {
  if (!val) return null;
  const raw = unwrap(val);
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === "string") {
    if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
      return Buffer.from(raw, "hex");
    }
    return Buffer.from(raw, "utf8");
  }
  return null;
}

/** Extracts an array whether from a getter function, `{ value: [] }`, or plain array */
export function getArray<T = unknown>(val: unknown): T[] {
  if (!val) return [];
  const unwrapped = unwrap<unknown>(val);
  if (Array.isArray(unwrapped)) return unwrapped as T[];
  return [];
}

/** Diagnostic event helpers (used by effects.ts) */
export interface DiagnosticEventInfo {
  isSuccess: boolean;
  type: string | undefined;
  contractId: string | null;
  topics: unknown[];
  data: unknown;
}

export function getDiagnosticEventInfo(
  diagnosticEvent: unknown,
): DiagnosticEventInfo | null {
  if (!diagnosticEvent || typeof diagnosticEvent !== "object") return null;
  const evtObj = diagnosticEvent as Record<string, unknown>;

  const isSuccess = Boolean(
    evtObj.inSuccessfulContractCall ??
    evtObj.in_successful_contract_call ??
    false,
  );

  const rawEvent = unwrap<Record<string, unknown>>(evtObj.event);
  if (!rawEvent) return null;

  const type =
    getSwitchName(rawEvent.type) ??
    (typeof rawEvent.type === "string" ? rawEvent.type : undefined);

  const contractIdRaw = rawEvent.contractId ?? rawEvent.contract_id;
  const contractId = toContractId(contractIdRaw);

  const rawBody = unwrap<Record<string, unknown>>(rawEvent.body);
  const bodyValue = rawBody
    ? (unwrap<Record<string, unknown>>(rawBody.v0) ??
      unwrap<Record<string, unknown>>(rawBody.value) ??
      rawBody)
    : null;

  const topics = bodyValue ? getArray(bodyValue.topics) : [];
  const data = bodyValue ? unwrap(bodyValue.data) : undefined;

  return {
    isSuccess,
    type,
    contractId,
    topics,
    data,
  };
}

/** Auth entry helpers (used by auth.ts) */
export interface AuthContractFnInfo {
  contractId: string;
  functionName: string;
  args: unknown[];
}

export function getAuthContractFnInfo(
  func: unknown,
): AuthContractFnInfo | null {
  if (!func || typeof func !== "object") return null;
  const fObj = func as Record<string, unknown>;
  const rawContractFn = unwrap<Record<string, unknown>>(
    fObj.contractFn ?? fObj.contract_fn,
  );
  if (!rawContractFn) return null;

  const addrObj =
    rawContractFn.contractAddress ?? rawContractFn.contract_address;
  const contractId = toContractId(addrObj);
  if (!contractId) return null;

  const rawFnName = unwrap<string>(
    rawContractFn.functionName ?? rawContractFn.function_name,
  );
  const functionName =
    typeof rawFnName === "string" ? rawFnName : String(rawFnName ?? "");

  const args = getArray(rawContractFn.args);
  return { contractId, functionName, args };
}

/** Invocation helpers (used by invocation.ts) */
export interface InvokeContractInfo {
  contractId: string;
  functionName: string;
  args: unknown[];
}

export function getInvokeContractInfo(
  func: unknown,
): InvokeContractInfo | null {
  if (!func || typeof func !== "object") return null;
  const fObj = func as Record<string, unknown>;
  const rawInvoke = unwrap<Record<string, unknown>>(
    fObj.invokeContract ?? fObj.invoke_contract,
  );
  if (!rawInvoke) return null;

  const addrObj = rawInvoke.contractAddress ?? rawInvoke.contract_address;
  const contractId = toContractId(addrObj);
  if (!contractId) return null;

  const rawFnName = unwrap<string>(
    rawInvoke.functionName ?? rawInvoke.function_name,
  );
  const functionName =
    typeof rawFnName === "string" ? rawFnName : String(rawFnName ?? "");

  const args = getArray(rawInvoke.args);
  return { contractId, functionName, args };
}

export interface CreateContractInfo {
  isV2: boolean;
  contractId: string | null;
  executableType: "wasm" | "sac" | "unknown";
  wasmHash?: string | undefined;
  salt?: string | undefined;
  constructorArgs: unknown[];
}

export function getCreateContractInfo(
  func: unknown,
): CreateContractInfo | null {
  if (!func || typeof func !== "object") return null;
  const fObj = func as Record<string, unknown>;
  const isV2 = Boolean(
    fObj.createContractV2 ??
    fObj.create_contract_v2 ??
    getSwitchName(func) === "hostFunctionTypeCreateContractV2",
  );
  const rawCreate = unwrap<Record<string, unknown>>(
    fObj.createContractV2 ??
      fObj.create_contract_v2 ??
      fObj.createContract ??
      fObj.create_contract,
  );
  if (!rawCreate) return null;

  const preImg = unwrap<Record<string, unknown>>(
    rawCreate.contractIdPreimage ?? rawCreate.contract_id_preimage,
  );

  let salt: string | undefined;
  if (preImg && typeof preImg === "object") {
    const rawSalt = unwrap(preImg.salt);
    const saltBuf = toBuffer(rawSalt);
    if (saltBuf) salt = saltBuf.toString("hex");
  }

  const rawExec = unwrap<Record<string, unknown>>(rawCreate.executable);
  let executableType: CreateContractInfo["executableType"] = "unknown";
  let wasmHash: string | undefined;

  if (rawExec) {
    const execSwitch = getSwitchName(rawExec);
    if (
      execSwitch === "contractExecutableToken" ||
      rawExec.token !== undefined
    ) {
      executableType = "sac";
    } else if (
      execSwitch === "contractExecutableWasm" ||
      rawExec.wasm_hash !== undefined ||
      rawExec.wasmHash !== undefined
    ) {
      executableType = "wasm";
      const rawWasm = unwrap(rawExec.wasm_hash ?? rawExec.wasmHash);
      const wasmBuf = toBuffer(rawWasm);
      if (wasmBuf) wasmHash = wasmBuf.toString("hex");
    }
  }

  const constructorArgs = isV2
    ? getArray(rawCreate.constructorArgs ?? rawCreate.constructor_args)
    : [];

  return {
    isV2,
    contractId: null,
    executableType,
    wasmHash,
    salt,
    constructorArgs,
  };
}

/** Simulation helpers (used by simulate.ts) */
export interface SimulationResultInfo {
  minResourceFee?: string | undefined;
  latestLedger?: number | undefined;
  events: unknown[];
  auth: unknown[];
  retval?: unknown;
}

export function getSimulationResultInfo(
  response: unknown,
): SimulationResultInfo | null {
  if (!response || typeof response !== "object") return null;
  const resObj = response as Record<string, unknown>;

  const minResourceFee =
    resObj.minResourceFee !== undefined
      ? String(resObj.minResourceFee)
      : undefined;
  const latestLedger =
    typeof resObj.latestLedger === "number"
      ? resObj.latestLedger
      : typeof resObj.latestLedger === "string"
        ? parseInt(resObj.latestLedger, 10)
        : undefined;

  const events = getArray(resObj.events);

  const rawResult = unwrap<Record<string, unknown>>(resObj.result);
  const auth = rawResult ? getArray(rawResult.auth) : [];
  const retval = rawResult ? rawResult.retval : undefined;

  return {
    minResourceFee,
    latestLedger,
    events,
    auth,
    retval,
  };
}
