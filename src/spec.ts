import { rpc, contract } from "@stellar/stellar-sdk";
import { WarningCode } from "./errors.js";

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

// Caching is keyed by networkPassphrase + contractId + wasmHash.
// The wasmHash is only known after fetching the contract instance, so two caches are kept:
// - _wasmHashCache: (networkPassphrase + contractId) -> wasmHash
// - _specCache: (networkPassphrase + contractId + wasmHash) -> contract.Spec
export const _specCache = new LruCache<string, contract.Spec>(64);
export const _wasmHashCache = new LruCache<string, string>(64);

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
    } catch (e: any) {
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
      const executable = (instance as any).executable;
      if (typeof executable?.switch === "function") {
        const type = executable.switch();
        if (type.name === "contractExecutableToken") {
          isSac = true;
        } else if (type.name === "contractExecutableWasm") {
          wasmHashId = executable.wasmHash().toString("hex");
        }
      } else if (executable?.wasmHash) {
        wasmHashId = executable.wasmHash;
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
      : (wasmResponse as any).wasmBytes;
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
  } catch (e: any) {
    warnings.push({
      code: "SPEC_UNAVAILABLE",
      message: "Failed to fetch or parse contract spec: " + e.message,
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
