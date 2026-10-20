import {
  ClearSignPreview,
  Intent,
  AuthEntry,
  Invocation,
  BalanceDelta,
} from "./types.js";
import { rpc, xdr, Operation } from "@stellar/stellar-sdk";
import { SimulationResult, SimulateOptions } from "./simulate.js";
import { WarningCode, WARNING_SEVERITY } from "./errors.js";
import { parseEnvelope } from "./envelope.js";
import { decodeInvocation } from "./invocation.js";
import { SpecLoaderOptions } from "./spec.js";
import { decodeAuthEntries, AuthDecodeOptions } from "./auth.js";
import { simulateTransaction } from "./simulate.js";
import { extractTokenEffects } from "./effects.js";
import { resolveTokenMetadata } from "./tokens.js";
import { verifyIntent } from "./intent.js";
import { computeRisk } from "./risk.js";
import { sanitizeRecursive } from "./sanitize.js";
import { generateSummary } from "./summary.js";
import { LocaleStrings } from "./locales/en.js";

export interface BuildPreviewInput {
  xdr: string;
  rpcUrl: string;
  networkPassphrase: string;
  signerAddress?: string;
  intent?: Intent;
  specs?: Record<string, Buffer | Uint8Array>;
  options?: {
    minAuthValidityLedgers?: number;
    feeWarningMultiplier?: number;
    rpcTimeoutMs?: number;
    debug?: boolean;
    localeStrings?: LocaleStrings;
    now?: (() => number) | number | undefined;
  };
}

/** Builds the preview returned when processing must stop: every warning is forced to "blocked". */
function blockedPreview(
  input: BuildPreviewInput,
  warnings: ClearSignPreview["warnings"],
  networkState: { rpcMatches?: boolean; signatureBound?: boolean } = {},
): ClearSignPreview {
  return {
    version: 1,
    risk: "blocked",
    warnings: warnings.map((w) => ({ ...w, severity: "blocked" })),
    network: {
      passphrase: input.networkPassphrase,
      rpcMatches: networkState.rpcMatches ?? false,
      signatureBound: networkState.signatureBound ?? false,
    },
    envelope: { source: "", sequence: "", fee: "", operations: [] },
    auth: [],
    simulation: { status: "skipped" },
    effects: [],
    summary: [],
    raw: { xdr: input.xdr },
  };
}

export async function buildPreview(
  input: BuildPreviewInput,
): Promise<ClearSignPreview> {
  const warnings: {
    code: WarningCode;
    message: string;
    path?: string;
    severity: "review" | "blocked";
  }[] = [];

  const addWarning = (
    warns: { code: WarningCode; message: string; path?: string }[],
  ) => {
    for (const w of warns) {
      warnings.push({ ...w, severity: WARNING_SEVERITY[w.code] });
    }
  };

  try {
    const server = new rpc.Server(input.rpcUrl, {
      allowHttp: input.rpcUrl.startsWith("http://"),
    });
    let rpcMatches = false;
    let rpcNetwork: rpc.Api.GetNetworkResponse;
    try {
      rpcNetwork = await server.getNetwork();
      if (
        rpcNetwork.passphrase &&
        rpcNetwork.passphrase !== input.networkPassphrase
      ) {
        addWarning([
          {
            code: "NETWORK_MISMATCH",
            message: "RPC network does not match configured network",
          },
        ]);
        return blockedPreview(input, warnings, {
          rpcMatches: false,
          signatureBound: false,
        });
      } else if (rpcNetwork.passphrase === input.networkPassphrase) {
        rpcMatches = true;
      }
    } catch (e) {
      // ignore if getNetwork fails, rely on simulation
    }

    const envResult = parseEnvelope(
      input.xdr,
      input.networkPassphrase,
      undefined,
      { now: input.options?.now },
    );
    if (!envResult.success) {
      addWarning([envResult.error]);
      return blockedPreview(input, warnings, {
        rpcMatches,
        signatureBound: false,
      });
    }

    addWarning(envResult.warnings);

    if (
      envResult.warnings.some(
        (w) => w.code === "NETWORK_MISMATCH" || w.code === "SIGNATURE_INVALID",
      )
    ) {
      return blockedPreview(input, warnings, {
        rpcMatches,
        signatureBound: envResult.signatureBound,
      });
    }

    const innerTx = envResult.innerTransaction;
    // Simulation runs on the inner transaction; any fee-bump wrapper is already unwrapped by parseEnvelope.
    const tx = innerTx;

    let invocation: Invocation | undefined;
    const op = innerTx.operations[0];
    if (op) {
      const invOpts: SpecLoaderOptions = {
        networkPassphrase: input.networkPassphrase,
        rpcUrl: input.rpcUrl,
        ...(input.specs ? { specs: input.specs } : {}),
      };
      const invResult = await decodeInvocation(op, invOpts);
      invocation = invResult.invocation;
      addWarning(invResult.warnings);
    }

    let simulation: SimulationResult = { status: "skipped", warnings: [] };
    let latestLedger = 0;
    let effects: BalanceDelta[] = [];
    let auth: AuthEntry[] = [];

    const hasInvoke = innerTx.operations.some(
      (o) => o.type === "invokeHostFunction",
    );

    if (hasInvoke) {
      const simOpts: SimulateOptions = {
        rpcUrl: input.rpcUrl,
        networkPassphrase: input.networkPassphrase,
        ...(input.options?.feeWarningMultiplier !== undefined
          ? { feeWarningMultiplier: input.options.feeWarningMultiplier }
          : {}),
        ...(input.specs ? { specs: input.specs } : {}),
      };

      simulation = await simulateTransaction(tx, simOpts);
      addWarning(simulation.warnings);
    }

    if (simulation.latestLedger) {
      latestLedger = simulation.latestLedger;
    }

    if (!latestLedger) {
      try {
        const server = new rpc.Server(input.rpcUrl, {
          allowHttp: input.rpcUrl.startsWith("http://"),
        });
        const info = await server.getLatestLedger();
        latestLedger = info.sequence;
      } catch (e) {
        // fallback
      }
    }

    if (simulation.status === "success") {
      const effResult = extractTokenEffects(simulation.events);
      effects = effResult.effects;
      addWarning(effResult.warnings);

      const metaResult = await resolveTokenMetadata(effects, {
        rpcUrl: input.rpcUrl,
        networkPassphrase: input.networkPassphrase,
        sourceAccount: tx.source,
      });
      addWarning(metaResult.warnings);
    }

    // Auth
    let authXdr: (xdr.SorobanAuthorizationEntry | unknown)[] = [];
    for (const op of innerTx.operations) {
      if (op.type === "invokeHostFunction") {
        const hostOp = op as Operation.InvokeHostFunction;
        if (hostOp.auth) {
          authXdr = authXdr.concat(hostOp.auth);
        }
      }
    }
    if (authXdr.length === 0 && simulation.auth) {
      authXdr = simulation.auth;
    }
    const authOpts: AuthDecodeOptions = {
      rpcUrl: input.rpcUrl,
      networkPassphrase: input.networkPassphrase,
      ...(input.options?.minAuthValidityLedgers !== undefined
        ? { minAuthValidityLedgers: input.options.minAuthValidityLedgers }
        : {}),
      ...(input.signerAddress !== undefined
        ? { signerAddress: input.signerAddress }
        : {}),
      ...(invocation?.contractId !== undefined
        ? { topLevelContractId: invocation.contractId }
        : {}),
      ...(input.specs ? { specs: input.specs } : {}),
    };

    const authResult = await decodeAuthEntries(authXdr, latestLedger, authOpts);
    auth = authResult.auth;
    addWarning(authResult.warnings);

    // Intent
    const intentResult = verifyIntent(
      input.intent,
      invocation,
      auth,
      effects,
      input.signerAddress,
      tx.source,
    );
    addWarning(intentResult.warnings);

    const summary = generateSummary(
      invocation,
      auth,
      effects,
      simulation,
      input.signerAddress,
      input.options?.localeStrings,
    );

    const hasIntentMismatch = intentResult.warnings.some(
      (w) =>
        w.code === "INTENT_MISMATCH" ||
        w.code === "INTENT_UNVERIFIABLE" ||
        w.code === "INTENT_SPEND_EXCEEDED" ||
        w.code === "INTENT_UNEXPECTED_AUTH",
    );
    const intentVerified = !!input.intent && !hasIntentMismatch;

    const risk = computeRisk(warnings, intentVerified);

    const preview = {
      version: 1 as const,
      risk,
      warnings: warnings.map((w) => ({
        ...w,
        severity: w.severity || "blocked",
      })),
      network: {
        passphrase: input.networkPassphrase,
        rpcMatches:
          rpcMatches &&
          envResult.warnings.every((w) => w.code !== "NETWORK_MISMATCH"),
        signatureBound: envResult.signatureBound,
      },
      envelope: {
        source: envResult.envelope.source,
        sequence: envResult.envelope.sequence,
        fee: envResult.envelope.fee,
        feeBump: envResult.envelope.feeBump,
        memo: envResult.envelope.memo,
        timeBounds: envResult.envelope.timeBounds,
        operations: envResult.envelope.operations.map((o) => ({
          type: o.type,
          decoded: o.decoded,
        })),
      },
      invocation,
      auth,
      simulation: {
        status: simulation.status,
        minResourceFee: simulation.minResourceFee,
        error: simulation.error,
        returnValue: simulation.returnValue,
        latestLedger: simulation.latestLedger,
      },
      effects,
      summary,
      raw: { xdr: input.xdr },
    };

    return sanitizeRecursive(preview) as ClearSignPreview;
  } catch (err: unknown) {
    if (input.options?.debug) {
      console.error(
        "INTERNAL_ERROR Stack:",
        err instanceof Error ? err.stack : undefined,
      );
    }
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Unknown error";
    const w = {
      code: "INTERNAL_ERROR" as WarningCode,
      message,
      severity: "blocked" as const,
    };
    return blockedPreview(input, [w], {
      rpcMatches: false,
      signatureBound: false,
    });
  }
}
