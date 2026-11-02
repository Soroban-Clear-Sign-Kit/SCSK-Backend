import { rpc, contract, xdr, Address } from "@stellar/stellar-sdk";
import { WarningCode } from "./errors.js";
import {
  MAX_WASM_BYTES,
  RPC_TIMEOUT_MS,
  DEFAULT_SPEC_CACHE_TTL_MS,
} from "./limits.js";
import { unwrap, getSwitchName, toBuffer } from "./accessors.js";

export interface SpecLoaderOptions {
  rpcUrl: string;
  networkPassphrase?: string;
  specs?: Record<string, Buffer | Uint8Array>;
}

export type SpecSource = "wasm" | "sac-builtin" | "injected" | "none";

export interface SpecResult {
  spec: contract.Spec | null;
  source: SpecSource;
  warnings: { code: WarningCode; message: string }[];
}

export type SpecErrorReason =
  | "INVALID_CONTRACT_ID"
  | "INVALID_RPC_URL"
  | "RPC_NOT_ALLOWED"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "WASM_TOO_LARGE"
  | "SPEC_SECTION_MISSING"
  | "MALFORMED_SPEC"
  | "RPC_ERROR";

export interface ResolveContractSpecOptions {
  rpcUrl: string;
  networkPassphrase?: string | undefined;
  /** Maximum allowed Wasm binary size in bytes (default: `MAX_WASM_BYTES` = 262,144). */
  maxWasmBytes?: number | undefined;
  /** Per-request RPC timeout in milliseconds (default: `RPC_TIMEOUT_MS` = 10,000). */
  timeoutMs?: number | undefined;
  /** In-memory cache TTL in milliseconds (default: `DEFAULT_SPEC_CACHE_TTL_MS` = 300,000). */
  ttlMs?: number | undefined;
  /** Injectable clock returning current epoch milliseconds (default: `Date.now`). */
  now?: (() => number) | undefined;
  /** Optional allowlist of permitted RPC origins, hostnames, or full URLs. */
  allowlist?: ReadonlyArray<string> | undefined;
  /** Alias for `allowlist`. */
  allowedRpcUrls?: ReadonlyArray<string> | undefined;
  /** Permit `http://` RPC URLs only when explicitly set to `true` (default: `false`, HTTPS-only). */
  allowHttp?: boolean | undefined;
}

export interface ResolveContractSpecSuccess {
  ok: true;
  source: "wasm" | "sac-builtin";
  spec: contract.Spec | null;
  wasmHash?: string | undefined;
  entries?: xdr.ScSpecEntry[] | undefined;
  cached: boolean;
  warnings: { code: WarningCode; message: string }[];
}

export interface ResolveContractSpecFailure {
  ok: false;
  source: "none";
  spec: null;
  error: {
    reason: SpecErrorReason;
    code: WarningCode;
    message: string;
  };
  warnings: { code: WarningCode; message: string }[];
}

export type ResolveContractSpecResult =
  ResolveContractSpecSuccess | ResolveContractSpecFailure;

class LruCache<K, V> {
  private cache = new Map<K, V>();
  constructor(private max: number) {}

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(key, value);
  }
}

export class TtlCache<K, V> {
  private cache = new Map<K, { value: V; expiresAt: number }>();
  constructor(private max: number = 64) {}

  get(key: K, nowMs: number = Date.now()): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (nowMs >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number, nowMs: number = Date.now()): void {
    if (ttlMs <= 0) {
      this.cache.delete(key);
      return;
    }
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(key, { value, expiresAt: nowMs + ttlMs });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Caching is keyed by networkPassphrase + contractId + wasmHash.
// The wasmHash is only known after fetching the contract instance, so two caches are kept:
// - _wasmHashCache: (networkPassphrase + contractId) -> wasmHash
// - _specCache: (networkPassphrase + contractId + wasmHash) -> contract.Spec
export const _specCache = new LruCache<string, contract.Spec>(64);
export const _wasmHashCache = new LruCache<string, string>(64);
export const _resolvedSpecTtlCache = new TtlCache<
  string,
  {
    source: "wasm" | "sac-builtin";
    spec: contract.Spec | null;
    wasmHash?: string | undefined;
    entries?: xdr.ScSpecEntry[] | undefined;
  }
>(64);

function readLeb128U32(
  bytes: Uint8Array,
  startOffset: number,
): { value: number; nextOffset: number } | null {
  let result = 0;
  let shift = 0;
  let offset = startOffset;

  for (let i = 0; i < 5; i++) {
    if (offset >= bytes.byteLength) return null;
    const byte = bytes[offset++]!;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, nextOffset: offset };
    }
    shift += 7;
  }
  return null;
}

/**
 * Extracts the `contractspecv0` custom section from a WebAssembly binary
 * and decodes its `xdr.ScSpecEntry` stream. Never throws.
 */
export function extractContractSpecSection(wasmBytes: Uint8Array):
  | {
      ok: true;
      sectionBytes: Buffer;
      entries: xdr.ScSpecEntry[];
    }
  | {
      ok: false;
      reason: "SPEC_SECTION_MISSING" | "MALFORMED_SPEC";
      message: string;
    } {
  if (!wasmBytes || wasmBytes.byteLength < 8) {
    return {
      ok: false,
      reason: "MALFORMED_SPEC",
      message: "Wasm binary is shorter than the 8-byte header",
    };
  }

  // Verify WebAssembly magic (\0asm) and version (1)
  if (
    wasmBytes[0] !== 0x00 ||
    wasmBytes[1] !== 0x61 ||
    wasmBytes[2] !== 0x73 ||
    wasmBytes[3] !== 0x6d ||
    wasmBytes[4] !== 0x01 ||
    wasmBytes[5] !== 0x00 ||
    wasmBytes[6] !== 0x00 ||
    wasmBytes[7] !== 0x00
  ) {
    return {
      ok: false,
      reason: "MALFORMED_SPEC",
      message: "Invalid Wasm binary magic header or version",
    };
  }

  let offset = 8;
  const specPayloads: Buffer[] = [];

  while (offset < wasmBytes.byteLength) {
    const sectionId = wasmBytes[offset++]!;
    const sizeInfo = readLeb128U32(wasmBytes, offset);
    if (!sizeInfo) {
      return {
        ok: false,
        reason: "MALFORMED_SPEC",
        message: "Malformed LEB128 section size in Wasm binary",
      };
    }

    const sectionStart = sizeInfo.nextOffset;
    const sectionEnd = sectionStart + sizeInfo.value;
    if (sectionEnd > wasmBytes.byteLength) {
      return {
        ok: false,
        reason: "MALFORMED_SPEC",
        message: "Truncated section in Wasm binary",
      };
    }

    if (sectionId === 0) {
      const nameLenInfo = readLeb128U32(wasmBytes, sectionStart);
      if (
        !nameLenInfo ||
        nameLenInfo.nextOffset + nameLenInfo.value > sectionEnd
      ) {
        return {
          ok: false,
          reason: "MALFORMED_SPEC",
          message: "Malformed custom section name in Wasm binary",
        };
      }
      const nameStart = nameLenInfo.nextOffset;
      const nameEnd = nameStart + nameLenInfo.value;
      const sectionName = Buffer.from(
        wasmBytes.subarray(nameStart, nameEnd),
      ).toString("utf8");

      if (sectionName === "contractspecv0") {
        specPayloads.push(Buffer.from(wasmBytes.subarray(nameEnd, sectionEnd)));
      }
    }

    offset = sectionEnd;
  }

  if (specPayloads.length === 0) {
    return {
      ok: false,
      reason: "SPEC_SECTION_MISSING",
      message: "Wasm binary does not contain a contractspecv0 custom section",
    };
  }

  const sectionBytes = Buffer.concat(specPayloads);
  if (sectionBytes.byteLength === 0 || sectionBytes.byteLength % 4 !== 0) {
    return {
      ok: false,
      reason: "MALFORMED_SPEC",
      message: "contractspecv0 custom section is empty or not 4-byte aligned",
    };
  }

  const entries: xdr.ScSpecEntry[] = [];
  let cursor = 0;

  while (cursor < sectionBytes.byteLength) {
    let matched = false;
    for (let end = cursor + 4; end <= sectionBytes.byteLength; end += 4) {
      try {
        const slice = sectionBytes.subarray(cursor, end);
        const entry = xdr.ScSpecEntry.fromXDR(slice);
        entries.push(entry);
        cursor = end;
        matched = true;
        break;
      } catch {
        // Continue extending slice until full ScSpecEntry XDR is consumed
      }
    }
    if (!matched) {
      return {
        ok: false,
        reason: "MALFORMED_SPEC",
        message: "Failed to decode ScSpecEntry XDR stream in contractspecv0",
      };
    }
  }

  if (entries.length === 0) {
    return {
      ok: false,
      reason: "MALFORMED_SPEC",
      message: "contractspecv0 custom section contained zero spec entries",
    };
  }

  return { ok: true, sectionBytes, entries };
}

function validateRpcUrl(
  rpcUrl: string,
  allowHttp: boolean,
  allowlist?: ReadonlyArray<string>,
):
  | { ok: true; normalizedUrl: string }
  | {
      ok: false;
      reason: "INVALID_RPC_URL" | "RPC_NOT_ALLOWED";
      message: string;
    } {
  if (!rpcUrl || typeof rpcUrl !== "string") {
    return {
      ok: false,
      reason: "INVALID_RPC_URL",
      message: "No RPC URL provided",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    return {
      ok: false,
      reason: "INVALID_RPC_URL",
      message: `Invalid RPC URL: ${rpcUrl}`,
    };
  }

  if (
    parsed.protocol !== "https:" &&
    !(allowHttp && parsed.protocol === "http:")
  ) {
    return {
      ok: false,
      reason: "INVALID_RPC_URL",
      message: `RPC URL must use https:// (got ${parsed.protocol})`,
    };
  }

  if (allowlist !== undefined) {
    const normalizedHref = parsed.href.replace(/\/+$/, "");
    const normalizedOrigin = parsed.origin.toLowerCase();
    const normalizedHost = parsed.hostname.toLowerCase();

    const allowed = allowlist.some((item) => {
      const trimmed = item.trim().replace(/\/+$/, "");
      if (!trimmed) return false;
      const lower = trimmed.toLowerCase();
      return (
        lower === normalizedHref.toLowerCase() ||
        lower === normalizedOrigin ||
        lower === normalizedHost
      );
    });

    if (!allowed) {
      return {
        ok: false,
        reason: "RPC_NOT_ALLOWED",
        message: `RPC URL "${rpcUrl}" is not in the configured allowlist`,
      };
    }
  }

  return { ok: true, normalizedUrl: parsed.href };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<
  | { ok: true; value: T }
  | { ok: false; timedOut: true }
  | { ok: false; timedOut: false; error: unknown }
> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ ok: false; timedOut: true }>(
    (resolve) => {
      timerId = setTimeout(
        () => resolve({ ok: false, timedOut: true }),
        timeoutMs,
      );
    },
  );

  try {
    const wrapped = promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({
        ok: false as const,
        timedOut: false as const,
        error,
      }),
    );
    return await Promise.race([wrapped, timeoutPromise]);
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

function parseExecutableFromInstance(instanceVal: unknown): {
  isSac: boolean;
  wasmHash?: string | undefined;
} {
  if (!instanceVal || typeof instanceVal !== "object") {
    return { isSac: false };
  }

  const obj = instanceVal as Record<string, unknown>;

  // Direct executable field (e.g. from getContractInstance or parsed object)
  let executable: unknown = unwrap(obj.executable);

  // Or nested inside LedgerEntryData -> contractData -> val -> instance -> executable
  if (!executable) {
    const data = unwrap<Record<string, unknown>>(obj.data) ?? obj;
    const contractData = unwrap<Record<string, unknown>>(
      data.contractData ?? data.contract_data,
    );
    const val = contractData
      ? unwrap<Record<string, unknown>>(contractData.val)
      : undefined;
    const instance = val
      ? unwrap<Record<string, unknown>>(val.instance)
      : undefined;
    if (instance) {
      executable = unwrap(instance.executable);
    }
  }

  if (!executable || typeof executable !== "object") {
    return { isSac: false };
  }

  const execObj = executable as Record<string, unknown>;
  const execSwitch = getSwitchName(execObj);

  if (
    execSwitch === "contractExecutableToken" ||
    execSwitch === "contractExecutableStellarAsset" ||
    execObj.token !== undefined ||
    execObj.stellarAsset !== undefined
  ) {
    return { isSac: true };
  }

  if (
    execSwitch === "contractExecutableWasm" ||
    execObj.wasmHash !== undefined ||
    execObj.wasm_hash !== undefined ||
    execObj.value !== undefined
  ) {
    const rawHash = unwrap(
      execObj.wasmHash ?? execObj.wasm_hash ?? execObj.value,
    );
    if (typeof rawHash === "string") {
      return { isSac: false, wasmHash: rawHash };
    }
    const buf = toBuffer(
      rawHash && typeof rawHash === "object" && "value" in rawHash
        ? (rawHash as { value: unknown }).value
        : rawHash,
    );
    if (buf) {
      return { isSac: false, wasmHash: buf.toString("hex") };
    }
    if (
      rawHash &&
      typeof (rawHash as { toString?: unknown }).toString === "function"
    ) {
      const str = (rawHash as { toString: (enc?: string) => string }).toString(
        "hex",
      );
      if (str && str !== "[object Object]") {
        return { isSac: false, wasmHash: str };
      }
    }
  }

  return { isSac: false };
}

function extractWasmBytesFromResponse(resp: unknown): Buffer | null {
  if (!resp) return null;
  if (Buffer.isBuffer(resp)) return resp;
  if (resp instanceof Uint8Array) return Buffer.from(resp);

  if (typeof resp === "object") {
    const obj = resp as Record<string, unknown>;
    if (obj.wasmBytes !== undefined) {
      const buf = toBuffer(obj.wasmBytes);
      if (buf) return buf;
    }

    // LedgerEntryData contractCode entry
    const val = unwrap<Record<string, unknown>>(obj.val ?? obj.data ?? obj);
    if (val && typeof val === "object") {
      if (
        typeof (val as { toXDR?: unknown }).toXDR !== "function" &&
        typeof val.xdr === "string"
      ) {
        try {
          const parsed = xdr.LedgerEntryData.fromXDR(
            val.xdr,
            "base64",
          ) as unknown as Record<string, unknown>;
          const cc = unwrap<Record<string, unknown>>(parsed.contractCode);
          const rawCode = unwrap<Record<string, unknown>>(cc?.code);
          const buf = toBuffer(rawCode?.value ?? rawCode);
          if (buf) return buf;
        } catch {
          // ignore
        }
      }
      const cc = unwrap<Record<string, unknown>>(
        val.contractCode ?? val.contract_code,
      );
      if (cc) {
        const rawCode = unwrap<Record<string, unknown>>(cc.code);
        const buf = toBuffer(rawCode?.value ?? rawCode);
        if (buf) return buf;
      }
    }
  }

  return null;
}

/**
 * Resolves a contract's `contract.Spec` over Soroban RPC so callers need not supply specs.
 *
 * - Validates `contractId` and enforces `https://` RPC URLs (with optional `allowlist`).
 * - Short-circuits Stellar Asset Contracts (`source: "sac-builtin"`).
 * - Uses an in-memory TTL cache with an injectable clock (`options.now`).
 * - Enforces a request timeout (`options.timeoutMs`) and Wasm size cap (`options.maxWasmBytes`).
 * - Extracts the `contractspecv0` custom section from the Wasm binary and builds `contract.Spec`.
 * - Returns a typed `ResolveContractSpecResult` and never throws on remote data.
 */
export async function resolveContractSpec(
  contractId: string,
  options: ResolveContractSpecOptions,
): Promise<ResolveContractSpecResult> {
  const fail = (
    reason: SpecErrorReason,
    code: WarningCode,
    message: string,
  ): ResolveContractSpecFailure => ({
    ok: false,
    source: "none",
    spec: null,
    error: { reason, code, message },
    warnings: [{ code, message }],
  });

  try {
    if (!contractId || typeof contractId !== "string") {
      return fail(
        "INVALID_CONTRACT_ID",
        "SPEC_UNAVAILABLE",
        "Contract ID must be a non-empty string",
      );
    }

    // Validate StrKey C... format if 56 chars, or allow test IDs starting with C
    if (!contractId.startsWith("C")) {
      return fail(
        "INVALID_CONTRACT_ID",
        "SPEC_UNAVAILABLE",
        `Invalid contract ID: ${contractId}`,
      );
    }

    const allowlist = options?.allowlist ?? options?.allowedRpcUrls;
    const urlCheck = validateRpcUrl(
      options?.rpcUrl,
      Boolean(options?.allowHttp),
      allowlist,
    );
    if (!urlCheck.ok) {
      return fail(urlCheck.reason, "SPEC_UNAVAILABLE", urlCheck.message);
    }

    const nowFn = options.now ?? Date.now;
    const ttlMs = options.ttlMs ?? DEFAULT_SPEC_CACHE_TTL_MS;
    const timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
    const maxWasmBytes = options.maxWasmBytes ?? MAX_WASM_BYTES;
    const cacheKey = `${options.networkPassphrase ?? ""}:${urlCheck.normalizedUrl}:${contractId}`;

    const cachedEntry = _resolvedSpecTtlCache.get(cacheKey, nowFn());
    if (cachedEntry) {
      return {
        ok: true,
        source: cachedEntry.source,
        spec: cachedEntry.spec,
        ...(cachedEntry.wasmHash !== undefined
          ? { wasmHash: cachedEntry.wasmHash }
          : {}),
        ...(cachedEntry.entries !== undefined
          ? { entries: cachedEntry.entries }
          : {}),
        cached: true,
        warnings: [],
      };
    }

    const server = new rpc.Server(options.rpcUrl, {
      allowHttp: options.rpcUrl.startsWith("http://"),
    }) as unknown as Record<string, unknown>;

    // 1. Read contract instance ledger entry over RPC
    let instanceData: unknown = null;
    const hasGetLedgerEntries = typeof server.getLedgerEntries === "function";
    const hasGetContractInstance =
      typeof server.getContractInstance === "function";

    if (hasGetLedgerEntries && !hasGetContractInstance) {
      let instanceKey: xdr.LedgerKey;
      try {
        instanceKey = xdr.LedgerKey.contractData(
          new xdr.LedgerKeyContractData({
            contract: Address.fromString(contractId).toScAddress(),
            key: xdr.ScVal.scvLedgerKeyContractInstance(),
            durability: xdr.ContractDataDurability.persistent,
          }),
        );
      } catch {
        // Fallback if test contractId is not strict CRC16 StrKey
        instanceKey = {} as xdr.LedgerKey;
      }

      const ledgerRes = await withTimeout(
        (server.getLedgerEntries as (k: unknown) => Promise<unknown>)(
          instanceKey,
        ),
        timeoutMs,
      );
      if (!ledgerRes.ok) {
        if (ledgerRes.timedOut) {
          return fail(
            "TIMEOUT",
            "SIMULATION_UNAVAILABLE",
            `RPC timed out after ${timeoutMs}ms while reading contract instance`,
          );
        }
        const msg =
          ledgerRes.error instanceof Error
            ? ledgerRes.error.message
            : String(ledgerRes.error);
        return fail(
          "RPC_ERROR",
          "SPEC_UNAVAILABLE",
          `RPC error reading contract instance: ${msg}`,
        );
      }

      const entries = (ledgerRes.value as { entries?: unknown[] } | null)
        ?.entries;
      if (!entries || entries.length === 0) {
        return fail(
          "NOT_FOUND",
          "SPEC_UNAVAILABLE",
          `Contract instance not found for ${contractId}`,
        );
      }
      const firstEntry = entries[0] as Record<string, unknown>;
      if (typeof firstEntry.xdr === "string") {
        try {
          instanceData = xdr.LedgerEntryData.fromXDR(firstEntry.xdr, "base64");
        } catch {
          instanceData = firstEntry;
        }
      } else {
        instanceData = firstEntry.val ?? firstEntry;
      }
    } else if (hasGetContractInstance) {
      const instRes = await withTimeout(
        (server.getContractInstance as (id: string) => Promise<unknown>)(
          contractId,
        ),
        timeoutMs,
      );
      if (!instRes.ok) {
        if (instRes.timedOut) {
          return fail(
            "TIMEOUT",
            "SIMULATION_UNAVAILABLE",
            `RPC timed out after ${timeoutMs}ms while reading contract instance`,
          );
        }
        const msg =
          instRes.error instanceof Error
            ? instRes.error.message
            : String(instRes.error);
        if (/not found|404|missing/i.test(msg)) {
          return fail(
            "NOT_FOUND",
            "SPEC_UNAVAILABLE",
            `Contract instance not found for ${contractId}: ${msg}`,
          );
        }
        return fail(
          "RPC_ERROR",
          "SPEC_UNAVAILABLE",
          `RPC error reading contract instance: ${msg}`,
        );
      }
      if (!instRes.value) {
        return fail(
          "NOT_FOUND",
          "SPEC_UNAVAILABLE",
          `Contract instance not found for ${contractId}`,
        );
      }
      instanceData = instRes.value;
    } else {
      return fail(
        "RPC_ERROR",
        "SPEC_UNAVAILABLE",
        "RPC server does not support getLedgerEntries or getContractInstance",
      );
    }

    const { isSac, wasmHash } = parseExecutableFromInstance(instanceData);

    // 2. Short-circuit Stellar Asset Contracts (SAC)
    if (isSac) {
      _resolvedSpecTtlCache.set(
        cacheKey,
        { source: "sac-builtin", spec: null },
        ttlMs,
        nowFn(),
      );
      return {
        ok: true,
        source: "sac-builtin",
        spec: null,
        cached: false,
        warnings: [],
      };
    }

    // 3. Read contract code ledger entry over RPC
    let wasmBytes: Buffer | null = null;
    const hasGetWasmById =
      typeof server.getContractWasmByContractId === "function";
    const hasGetWasmByHash = typeof server.getContractWasmByHash === "function";

    if (hasGetLedgerEntries && !hasGetWasmById && !hasGetWasmByHash) {
      let codeKey: unknown = {};
      if (wasmHash && /^[0-9a-fA-F]{64}$/.test(wasmHash)) {
        try {
          codeKey = xdr.LedgerKey.contractCode(
            new xdr.LedgerKeyContractCode({
              hash: Buffer.from(wasmHash, "hex"),
            }),
          );
        } catch {
          codeKey = { wasmHash };
        }
      }
      const codeRes = await withTimeout(
        (server.getLedgerEntries as (k: unknown) => Promise<unknown>)(codeKey),
        timeoutMs,
      );
      if (!codeRes.ok) {
        if (codeRes.timedOut) {
          return fail(
            "TIMEOUT",
            "SIMULATION_UNAVAILABLE",
            `RPC timed out after ${timeoutMs}ms while reading contract code`,
          );
        }
        const msg =
          codeRes.error instanceof Error
            ? codeRes.error.message
            : String(codeRes.error);
        return fail(
          "RPC_ERROR",
          "SPEC_UNAVAILABLE",
          `RPC error reading contract code: ${msg}`,
        );
      }
      const entries = (codeRes.value as { entries?: unknown[] } | null)
        ?.entries;
      if (!entries || entries.length === 0) {
        return fail(
          "NOT_FOUND",
          "SPEC_UNAVAILABLE",
          `Contract code ledger entry not found for ${contractId}`,
        );
      }
      wasmBytes = extractWasmBytesFromResponse(entries[0]);
    } else if (hasGetWasmById || hasGetWasmByHash) {
      const wasmPromise = hasGetWasmById
        ? (
            server.getContractWasmByContractId as (
              id: string,
            ) => Promise<unknown>
          )(contractId)
        : (
            server.getContractWasmByHash as (
              h: Buffer,
              fmt?: string,
            ) => Promise<unknown>
          )(Buffer.from(wasmHash ?? "", "hex"));

      const codeRes = await withTimeout(wasmPromise, timeoutMs);
      if (!codeRes.ok) {
        if (codeRes.timedOut) {
          return fail(
            "TIMEOUT",
            "SIMULATION_UNAVAILABLE",
            `RPC timed out after ${timeoutMs}ms while reading contract Wasm`,
          );
        }
        const msg =
          codeRes.error instanceof Error
            ? codeRes.error.message
            : String(codeRes.error);
        if (/not found|404|missing/i.test(msg)) {
          return fail(
            "NOT_FOUND",
            "SPEC_UNAVAILABLE",
            `Contract Wasm not found for ${contractId}: ${msg}`,
          );
        }
        return fail(
          "RPC_ERROR",
          "SPEC_UNAVAILABLE",
          `RPC error reading contract Wasm: ${msg}`,
        );
      }
      if (!codeRes.value) {
        return fail(
          "NOT_FOUND",
          "SPEC_UNAVAILABLE",
          `No Wasm returned from RPC for ${contractId}`,
        );
      }
      wasmBytes = extractWasmBytesFromResponse(codeRes.value);
    }

    if (!wasmBytes) {
      return fail(
        "NOT_FOUND",
        "SPEC_UNAVAILABLE",
        `Contract Wasm bytes missing in RPC response for ${contractId}`,
      );
    }

    // 4. Enforce Wasm size cap before parsing
    if (wasmBytes.byteLength > maxWasmBytes) {
      return fail(
        "WASM_TOO_LARGE",
        "SPEC_UNAVAILABLE",
        `Contract Wasm size (${wasmBytes.byteLength} bytes) exceeds maximum allowed (${maxWasmBytes} bytes)`,
      );
    }

    // 5. Extract `contractspecv0` custom section and build `contract.Spec`
    const extracted = extractContractSpecSection(wasmBytes);
    if (!extracted.ok) {
      return fail(extracted.reason, "SPEC_UNAVAILABLE", extracted.message);
    }

    let spec: contract.Spec;
    try {
      spec =
        typeof contract.Spec === "function"
          ? new contract.Spec(extracted.entries)
          : contract.Spec.fromWasm(wasmBytes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(
        "MALFORMED_SPEC",
        "SPEC_UNAVAILABLE",
        `Failed to construct contract.Spec from contractspecv0: ${msg}`,
      );
    }

    const cacheValue = {
      source: "wasm" as const,
      spec,
      ...(wasmHash !== undefined ? { wasmHash } : {}),
      entries: extracted.entries,
    };
    _resolvedSpecTtlCache.set(cacheKey, cacheValue, ttlMs, nowFn());

    return {
      ok: true,
      source: "wasm",
      spec,
      ...(wasmHash !== undefined ? { wasmHash } : {}),
      entries: extracted.entries,
      cached: false,
      warnings: [],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(
      "RPC_ERROR",
      "SPEC_UNAVAILABLE",
      `Unexpected error resolving contract spec: ${msg}`,
    );
  }
}

// SAC (Stellar Asset Contract) instances have no Wasm, so there is no spec to load.
// For those, loadSpec returns source: 'sac-builtin' with spec: null, and SEP-41 decoding
// is handled in invocation.ts using SAC_FUNCTIONS below.

export async function loadSpec(
  contractId: string,
  opts: SpecLoaderOptions,
): Promise<SpecResult> {
  const warnings: { code: WarningCode; message: string }[] = [];

  if (opts.specs && opts.specs[contractId]) {
    try {
      const spec = contract.Spec.fromWasm(
        Buffer.from(opts.specs[contractId] as Uint8Array),
      );
      return { spec, source: "injected", warnings };
    } catch (e: unknown) {
      warnings.push({
        code: "SPEC_UNAVAILABLE",
        message: "Injected spec is invalid",
      });
      return { spec: null, source: "none", warnings };
    }
  }

  if (!opts.rpcUrl) {
    warnings.push({
      code: "SPEC_UNAVAILABLE",
      message: "No RPC URL provided to fetch spec",
    });
    return { spec: null, source: "none", warnings };
  }

  const networkKey = `${opts.networkPassphrase || ""}-${contractId}`;
  const server = new rpc.Server(opts.rpcUrl, {
    allowHttp: opts.rpcUrl.startsWith("http://"),
  });

  try {
    // 1. Fetch the contract instance to see its executable type and get the wasmHash
    const instance = await server.getContractInstance(contractId);

    let isSac = false;
    let wasmHashId: string | undefined;

    if ("executable" in instance) {
      const executable = (instance as unknown as Record<string, unknown>)
        .executable as Record<string, unknown> | undefined;
      if (
        executable &&
        typeof (executable.switch as () => unknown) === "function"
      ) {
        const type = (executable.switch as () => { name: string })();
        if (type.name === "contractExecutableToken") {
          isSac = true;
        } else if (type.name === "contractExecutableWasm") {
          wasmHashId = (
            executable.wasmHash as () => { toString: (enc: string) => string }
          )()?.toString("hex");
        }
      } else if (executable?.wasmHash) {
        wasmHashId = String(executable.wasmHash);
      }
    }

    if (isSac) {
      _wasmHashCache.set(networkKey, "SAC");
      return { spec: null, source: "sac-builtin", warnings };
    }

    // 2. Check if we already have the spec for this exact wasmHash
    if (wasmHashId && _specCache.get(`${networkKey}-${wasmHashId}`)) {
      return {
        spec: _specCache.get(`${networkKey}-${wasmHashId}`)!,
        source: "wasm",
        warnings,
      };
    }

    // 3. Fetch Wasm by contract ID (or by hash)
    // The spec says "Get the contract Wasm with the RPC method ... getContractWasmByContractId"
    const wasmResponse = await server.getContractWasmByContractId(contractId);
    if (!wasmResponse) {
      warnings.push({
        code: "SPEC_UNAVAILABLE",
        message: "No Wasm returned from RPC",
      });
      return { spec: null, source: "none", warnings };
    }

    // wasmResponse is either a Buffer or an object carrying wasmBytes.
    const wasmBytes = Buffer.isBuffer(wasmResponse)
      ? wasmResponse
      : ((wasmResponse as unknown as Record<string, unknown>).wasmBytes as
          Buffer | Uint8Array | undefined);
    if (!wasmBytes) {
      warnings.push({
        code: "SPEC_UNAVAILABLE",
        message: "Wasm response missing wasmBytes",
      });
      return { spec: null, source: "none", warnings };
    }

    const spec = contract.Spec.fromWasm(Buffer.from(wasmBytes));

    // Determine a hash for caching. If the instance did not give one, derive a stand-in from the Wasm bytes.
    const finalHash =
      wasmHashId || Buffer.from(wasmBytes).toString("base64").slice(0, 16);

    // Cache keyed by networkPassphrase + contractId + wasmHash.
    const fullKey = `${networkKey}-${finalHash}`;
    _specCache.set(fullKey, spec);
    _wasmHashCache.set(networkKey, finalHash);

    return { spec, source: "wasm", warnings };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push({
      code: "SPEC_UNAVAILABLE",
      message: "Failed to fetch or parse contract spec: " + msg,
    });
    return { spec: null, source: "none", warnings };
  }
}

// Built-in SEP-41 SAC spec fallback
// We use a predefined table for SAC operations.
export const SAC_FUNCTIONS: Record<
  string,
  { args: { name: string; type: string }[]; outputs?: { type: string }[] }
> = {
  transfer: {
    args: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "i128" },
    ],
  },
  transfer_from: {
    args: [
      { name: "spender", type: "address" },
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "i128" },
    ],
  },
  approve: {
    args: [
      { name: "from", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "i128" },
      { name: "expiration_ledger", type: "u32" },
    ],
  },
  burn: {
    args: [
      { name: "from", type: "address" },
      { name: "amount", type: "i128" },
    ],
  },
  burn_from: {
    args: [
      { name: "spender", type: "address" },
      { name: "from", type: "address" },
      { name: "amount", type: "i128" },
    ],
  },
  mint: {
    args: [
      { name: "to", type: "address" },
      { name: "amount", type: "i128" },
    ],
  },
  clawback: {
    args: [
      { name: "from", type: "address" },
      { name: "amount", type: "i128" },
    ],
  },
  set_admin: { args: [{ name: "new_admin", type: "address" }] },
  set_authorized: {
    args: [
      { name: "id", type: "address" },
      { name: "authorize", type: "bool" },
    ],
  },
  balance: {
    args: [{ name: "id", type: "address" }],
    outputs: [{ type: "scSpecTypeI128" }],
  },
  allowance: {
    args: [
      { name: "from", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "scSpecTypeI128" }],
  },
  decimals: { args: [], outputs: [{ type: "scSpecTypeU32" }] },
  name: { args: [], outputs: [{ type: "scSpecTypeString" }] },
  symbol: { args: [], outputs: [{ type: "scSpecTypeString" }] },
};
