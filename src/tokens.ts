import {
  rpc,
  TransactionBuilder,
  xdr,
  Networks,
  Address,
  Contract,
  Account,
} from "@stellar/stellar-sdk";
import { BalanceDelta } from "./types.js";
import { WarningCode } from "./errors.js";
import { RPC_TIMEOUT_MS, MAX_TOKEN_METADATA_CACHE_ENTRIES } from "./limits.js";
import { withTimeout } from "./timeout.js";

export interface TokenMetadataOptions {
  rpcUrl: string;
  networkPassphrase: string;
  sourceAccount: string;
  /** Milliseconds to wait for each metadata RPC call. Defaults to RPC_TIMEOUT_MS. */
  timeoutMs?: number;
}

const metadataCache = new Map<string, { decimals: number; symbol: string }>();

/** Empties the process-wide token metadata cache. */
export function clearTokenMetadataCache(): void {
  metadataCache.clear();
}

function cacheMetadata(
  key: string,
  meta: { decimals: number; symbol: string },
): void {
  if (metadataCache.size >= MAX_TOKEN_METADATA_CACHE_ENTRIES) {
    const oldest = metadataCache.keys().next().value;
    if (oldest !== undefined) metadataCache.delete(oldest);
  }
  metadataCache.set(key, meta);
}

export async function resolveTokenMetadata(
  effects: BalanceDelta[],
  opts: TokenMetadataOptions,
): Promise<{ warnings: { code: WarningCode; message: string }[] }> {
  const warnings: { code: WarningCode; message: string }[] = [];
  const server = new rpc.Server(opts.rpcUrl, {
    allowHttp: opts.rpcUrl.startsWith("http://"),
  });

  const uniqueContracts = Array.from(
    new Set(effects.map((e) => e.tokenContractId)),
  );

  for (const contractId of uniqueContracts) {
    const cacheKey = `${opts.networkPassphrase}:${contractId}`;
    let meta = metadataCache.get(cacheKey);

    if (!meta) {
      try {
        const decimals = await readContractNumber(
          server,
          opts,
          contractId,
          "decimals",
        );
        const symbol = await readContractString(
          server,
          opts,
          contractId,
          "symbol",
        );

        if (decimals !== null && symbol !== null) {
          meta = { decimals, symbol };
          cacheMetadata(cacheKey, meta);
        } else {
          warnings.push({
            code: "TOKEN_METADATA_UNAVAILABLE",
            message: `Could not read metadata for token ${contractId}`,
          });
        }
      } catch (err: any) {
        warnings.push({
          code: "SIMULATION_UNAVAILABLE",
          message: `RPC error resolving metadata for token ${contractId}: ${err.message}`,
        });
      }
    }

    if (meta) {
      for (const effect of effects) {
        if (effect.tokenContractId === contractId) {
          effect.symbol = meta.symbol;
          effect.decimals = meta.decimals;
          effect.formatted = formatAmount(effect.delta, meta.decimals);
        }
      }
    }
  }

  return { warnings };
}

export function formatAmount(rawIntegerStr: string, decimals: number): string {
  if (decimals === 0) return rawIntegerStr;

  let isNegative = false;
  let val = rawIntegerStr;
  if (val.startsWith("-")) {
    isNegative = true;
    val = val.substring(1);
  }

  val = val.padStart(decimals + 1, "0");

  const intPart = val.substring(0, val.length - decimals);
  const fracPart = val.substring(val.length - decimals);

  // Strip trailing zeros from fraction
  const trimmedFrac = fracPart.replace(/0+$/, "");

  let result = intPart;
  if (trimmedFrac.length > 0) {
    result += "." + trimmedFrac;
  }

  return isNegative ? "-" + result : result;
}

async function readContractNumber(
  server: rpc.Server,
  opts: TokenMetadataOptions,
  contractId: string,
  func: string,
): Promise<number | null> {
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(new Account(opts.sourceAccount, "0"), {
    fee: "100",
    networkPassphrase: opts.networkPassphrase,
  })
    .addOperation(contract.call(func))
    .setTimeout(0)
    .build();

  const response = await withTimeout(
    server.simulateTransaction(tx),
    opts.timeoutMs ?? RPC_TIMEOUT_MS,
  );
  if (
    rpc.Api.isSimulationSuccess(response) &&
    response.result &&
    response.result.retval
  ) {
    const val: any = response.result.retval;
    const valType =
      typeof val.switch === "function" ? val.switch().name : val.type;
    if (valType === "scvU32") {
      return typeof val.u32 === "function" ? val.u32() : val.u32;
    }
  }
  return null;
}

async function readContractString(
  server: rpc.Server,
  opts: TokenMetadataOptions,
  contractId: string,
  func: string,
): Promise<string | null> {
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(new Account(opts.sourceAccount, "0"), {
    fee: "100",
    networkPassphrase: opts.networkPassphrase,
  })
    .addOperation(contract.call(func))
    .setTimeout(0)
    .build();

  const response = await withTimeout(
    server.simulateTransaction(tx),
    opts.timeoutMs ?? RPC_TIMEOUT_MS,
  );
  if (
    rpc.Api.isSimulationSuccess(response) &&
    response.result &&
    response.result.retval
  ) {
    const val: any = response.result.retval;
    const valType =
      typeof val.switch === "function" ? val.switch().name : val.type;
    if (valType === "scvString") {
      const v = typeof val.str === "function" ? val.str() : val.str;
      return typeof v === "string" ? v : v.toString("utf8");
    } else if (valType === "scvSymbol") {
      const v = typeof val.sym === "function" ? val.sym() : val.sym;
      return typeof v === "string" ? v : v.toString();
    }
  }
  return null;
}
