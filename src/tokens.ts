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
import { RPC_TIMEOUT_MS } from "./limits.js";

export interface TokenMetadataOptions {
  rpcUrl: string;
  networkPassphrase: string;
  sourceAccount: string;
}

const metadataCache = new Map<string, { decimals: number; symbol: string }>();

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
          metadataCache.set(cacheKey, meta);
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

  let timerId: NodeJS.Timeout;
  const simulatePromise = server.simulateTransaction(tx);
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error("RPC Timeout")), RPC_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([simulatePromise, timeoutPromise]);
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
  } finally {
    clearTimeout(timerId!);
  }
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

  let timerId: NodeJS.Timeout;
  const simulatePromise = server.simulateTransaction(tx);
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error("RPC Timeout")), RPC_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([simulatePromise, timeoutPromise]);
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
  } finally {
    clearTimeout(timerId!);
  }
}
