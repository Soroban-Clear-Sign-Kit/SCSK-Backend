import { WarningCode, WarningSeverity, WARNING_SEVERITY } from "./errors.js";
import {
  Invocation,
  DecodedArg,
  AuthEntry,
  BalanceDelta,
  DisplayValue,
} from "./types.js";

/** Maximum signed 128-bit integer value (2^127 - 1). */
export const I128_MAX = (1n << 127n) - 1n;

export interface PolicyWarning {
  code: WarningCode;
  ruleId?: string | undefined;
  severity: WarningSeverity;
  message: string;
  path?: string | undefined;
}

export type Warning = PolicyWarning;

export interface PolicyContext {
  invocation: Invocation;
  knownSpenders?: ReadonlyArray<string> | ReadonlySet<string> | undefined;
  signerAddress?: string | undefined;
  auth?: ReadonlyArray<AuthEntry> | undefined;
  effects?: ReadonlyArray<BalanceDelta> | undefined;
}

export interface Rule {
  id: string;
  defaultSeverity?: WarningSeverity | undefined;
  evaluate(ctx: PolicyContext): PolicyWarning[];
}

export type PolicySeverityOption = WarningSeverity | "ok" | "off";

export interface RuleOverride {
  severity?: PolicySeverityOption | undefined;
  enabled?: boolean | undefined;
  allowSeverityDowngrade?: boolean | undefined;
}

export interface PolicyConfig {
  /** Additional custom rules evaluated after the built-in rules. */
  rules?: ReadonlyArray<Rule> | undefined;
  /** Per-rule or per-warning-code severity/enablement overrides. */
  severities?:
    Record<string, PolicySeverityOption | RuleOverride | undefined> | undefined;
  /** Alias for `severities`. */
  overrides?:
    Record<string, PolicySeverityOption | RuleOverride | undefined> | undefined;
  /**
   * Explicit override flag required to lower a rule's default severity
   * (e.g. "blocked" -> "review", or "review"/"blocked" -> "ok"/"off").
   */
  allowSeverityDowngrade?: boolean | undefined;
  /** Alias for `allowSeverityDowngrade`. */
  allowUnsafeOverrides?: boolean | undefined;
  /** Alias for `allowSeverityDowngrade`. */
  allowLoweringSeverity?: boolean | undefined;
  /**
   * When true (the default), malformed/missing invocations or throwing rules
   * fail closed by emitting a `blocked` `INTERNAL_ERROR` warning.
   */
  failClosed?: boolean | undefined;
}

const APPROVAL_FUNCTIONS = new Set(["approve", "increase_allowance"]);

export const ADMIN_CHANGE_FUNCTIONS = new Set([
  "set_admin",
  "transfer_admin",
  "change_admin",
  "update_admin",
  "set_owner",
  "transfer_ownership",
  "grant_role",
]);

export const WASM_UPDATE_FUNCTIONS = new Set([
  "update_current_contract_wasm",
  "upgrade",
  "upgrade_wasm",
  "update_wasm",
  "set_wasm",
  "Upload contract code",
]);

function normalizeContext(input: unknown): PolicyContext | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  if (
    "invocation" in obj &&
    obj.invocation &&
    typeof obj.invocation === "object"
  ) {
    const inv = obj.invocation as Record<string, unknown>;
    if (
      typeof inv.functionName === "string" &&
      Array.isArray(inv.args) &&
      typeof inv.specSource === "string"
    ) {
      return obj as unknown as PolicyContext;
    }
    return null;
  }

  if (
    typeof obj.functionName === "string" &&
    Array.isArray(obj.args) &&
    typeof obj.specSource === "string"
  ) {
    return {
      invocation: obj as unknown as Invocation,
      ...(obj.knownSpenders !== undefined
        ? {
            knownSpenders: obj.knownSpenders as
              ReadonlyArray<string> | ReadonlySet<string>,
          }
        : {}),
    };
  }

  return null;
}

function findArg(
  args: ReadonlyArray<DecodedArg>,
  names: ReadonlyArray<string>,
  fallbackIndex?: number,
): { arg: DecodedArg; index: number } | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.name && names.includes(arg.name)) {
      return { arg, index: i };
    }
  }
  if (
    fallbackIndex !== undefined &&
    fallbackIndex >= 0 &&
    fallbackIndex < args.length
  ) {
    const arg = args[fallbackIndex];
    if (arg && arg.name === null) {
      return { arg, index: fallbackIndex };
    }
  }
  return undefined;
}

function parseIntValue(val: DisplayValue): bigint | null {
  if (val.kind === "int") {
    try {
      return BigInt(val.value);
    } catch {
      return null;
    }
  }
  return null;
}

function parseAddressOrStringValue(val: DisplayValue): string | null {
  if (
    val.kind === "address" ||
    val.kind === "string" ||
    val.kind === "symbol"
  ) {
    return val.value;
  }
  return null;
}

function isKnownSpender(
  spender: string,
  knownSpenders: ReadonlyArray<string> | ReadonlySet<string> | undefined,
): boolean {
  if (!knownSpenders) return false;
  if (knownSpenders instanceof Set) {
    return (knownSpenders as ReadonlySet<string>).has(spender);
  }
  if (Array.isArray(knownSpenders)) {
    return knownSpenders.includes(spender);
  }
  return false;
}

/**
 * Built-in Rule 1: Unlimited token approval (amount >= i128::MAX).
 */
export const unlimitedApprovalRule: Rule = {
  id: "unlimited-approval",
  defaultSeverity: "review",
  evaluate(rawCtx: PolicyContext): PolicyWarning[] {
    const ctx = normalizeContext(rawCtx);
    if (!ctx) return [];
    const { invocation } = ctx;
    if (!APPROVAL_FUNCTIONS.has(invocation.functionName)) {
      return [];
    }

    const found = findArg(
      invocation.args,
      ["amount", "allowance", "value"],
      invocation.functionName === "approve" ? 2 : 1,
    );

    if (!found) {
      // Check if any unnamed i128/u128 argument is at or above I128_MAX
      for (let i = 0; i < invocation.args.length; i++) {
        const arg = invocation.args[i];
        if (!arg) continue;
        const parsed = parseIntValue(arg.value);
        if (parsed !== null && parsed >= I128_MAX) {
          return [
            {
              code: "UNLIMITED_APPROVAL",
              ruleId: "unlimited-approval",
              severity: "review",
              message: `Approval amount (${parsed.toString()}) is at the i128 maximum (unlimited allowance)`,
              path: arg.name ? `args.${arg.name}` : `args[${i}]`,
            },
          ];
        }
      }
      return [];
    }

    if (found.arg.value.kind === "raw") {
      return [
        {
          code: "UNLIMITED_APPROVAL",
          ruleId: "unlimited-approval",
          severity: "review",
          message:
            "Approval amount could not be decoded safely; treating as potentially unlimited",
          path: found.arg.name
            ? `args.${found.arg.name}`
            : `args[${found.index}]`,
        },
      ];
    }

    const amount = parseIntValue(found.arg.value);
    if (amount !== null && amount >= I128_MAX) {
      return [
        {
          code: "UNLIMITED_APPROVAL",
          ruleId: "unlimited-approval",
          severity: "review",
          message: `Approval amount (${amount.toString()}) is at the i128 maximum (unlimited allowance)`,
          path: found.arg.name
            ? `args.${found.arg.name}`
            : `args[${found.index}]`,
        },
      ];
    }

    return [];
  },
};

/**
 * Built-in Rule 2: Approval granted to an unrecognized spender.
 */
export const newSpenderApprovalRule: Rule = {
  id: "new-spender-approval",
  defaultSeverity: "review",
  evaluate(rawCtx: PolicyContext): PolicyWarning[] {
    const ctx = normalizeContext(rawCtx);
    if (!ctx) return [];
    const { invocation } = ctx;
    if (!APPROVAL_FUNCTIONS.has(invocation.functionName)) {
      return [];
    }

    // If amount is explicitly 0 (allowance revocation), do not warn on new spender
    const amountFound = findArg(
      invocation.args,
      ["amount", "allowance", "value"],
      invocation.functionName === "approve" ? 2 : 1,
    );
    if (amountFound) {
      const amount = parseIntValue(amountFound.arg.value);
      if (amount === 0n) {
        return [];
      }
    }

    const spenderFound = findArg(invocation.args, ["spender", "operator"], 1);
    if (!spenderFound) {
      return [
        {
          code: "APPROVAL_NEW_SPENDER",
          ruleId: "new-spender-approval",
          severity: "review",
          message: "Approval target spender could not be determined",
          path: "args.spender",
        },
      ];
    }

    const spender = parseAddressOrStringValue(spenderFound.arg.value);
    const path = spenderFound.arg.name
      ? `args.${spenderFound.arg.name}`
      : `args[${spenderFound.index}]`;

    if (!spender || !isKnownSpender(spender, ctx.knownSpenders)) {
      return [
        {
          code: "APPROVAL_NEW_SPENDER",
          ruleId: "new-spender-approval",
          severity: "review",
          message: spender
            ? `Approval granted to unrecognized spender ${spender}`
            : "Approval granted to an unverified spender",
          path,
        },
      ];
    }

    return [];
  },
};

/**
 * Built-in Rule 3: Third-party allowance transfer (`transfer_from`).
 */
export const transferFromRule: Rule = {
  id: "transfer-from",
  defaultSeverity: "review",
  evaluate(rawCtx: PolicyContext): PolicyWarning[] {
    const ctx = normalizeContext(rawCtx);
    if (!ctx) return [];
    const { invocation } = ctx;
    if (invocation.functionName === "transfer_from") {
      return [
        {
          code: "TRANSFER_FROM",
          ruleId: "transfer-from",
          severity: "review",
          message:
            "Invocation executes transfer_from using a delegated token allowance",
          path: "functionName",
        },
      ];
    }
    return [];
  },
};

/**
 * Built-in Rule 4: Contract administrator or ownership change.
 */
export const adminChangeRule: Rule = {
  id: "admin-change",
  defaultSeverity: "blocked",
  evaluate(rawCtx: PolicyContext): PolicyWarning[] {
    const ctx = normalizeContext(rawCtx);
    if (!ctx) return [];
    const { invocation } = ctx;
    if (ADMIN_CHANGE_FUNCTIONS.has(invocation.functionName)) {
      return [
        {
          code: "ADMIN_CHANGE",
          ruleId: "admin-change",
          severity: "blocked",
          message: `Invocation modifies contract administrator or ownership via ${invocation.functionName}`,
          path: "functionName",
        },
      ];
    }
    return [];
  },
};

/**
 * Built-in Rule 5: Contract Wasm bytecode update or upgrade.
 */
export const wasmUpdateRule: Rule = {
  id: "wasm-update",
  defaultSeverity: "blocked",
  evaluate(rawCtx: PolicyContext): PolicyWarning[] {
    const ctx = normalizeContext(rawCtx);
    if (!ctx) return [];
    const { invocation } = ctx;
    if (
      WASM_UPDATE_FUNCTIONS.has(invocation.functionName) ||
      invocation.contractId === "Upload"
    ) {
      return [
        {
          code: "CONTRACT_WASM_UPDATE",
          ruleId: "wasm-update",
          severity: "blocked",
          message: `Invocation updates or uploads contract Wasm executable code (${invocation.functionName})`,
          path: "functionName",
        },
      ];
    }
    return [];
  },
};

/**
 * Built-in Rule 6: Unknown function invoked without a contract spec (`review`).
 */
export const unknownFunctionNoSpecRule: Rule = {
  id: "unknown-function-no-spec",
  defaultSeverity: "review",
  evaluate(rawCtx: PolicyContext): PolicyWarning[] {
    const ctx = normalizeContext(rawCtx);
    if (!ctx) return [];
    const { invocation } = ctx;

    const isHostPseudoOp =
      invocation.contractId === "Deploy" || invocation.contractId === "Upload";

    if (
      (!isHostPseudoOp && invocation.specSource === "none") ||
      invocation.functionName === "Unknown" ||
      invocation.functionName === "unknown" ||
      invocation.functionName.trim() === ""
    ) {
      return [
        {
          code: "SPEC_UNAVAILABLE",
          ruleId: "unknown-function-no-spec",
          severity: "review",
          message: `Function "${invocation.functionName || "unknown"}" is invoked without an available contract spec`,
          path: "functionName",
        },
      ];
    }
    return [];
  },
};

/** Default ordered list of built-in policy rules. */
export const BUILTIN_RULES: ReadonlyArray<Rule> = [
  unlimitedApprovalRule,
  newSpenderApprovalRule,
  transferFromRule,
  adminChangeRule,
  wasmUpdateRule,
  unknownFunctionNoSpecRule,
];

const SEVERITY_RANK: Record<PolicySeverityOption, number> = {
  off: 0,
  ok: 0,
  review: 1,
  blocked: 2,
};

function resolveOverrideEntry(
  ruleId: string,
  warningCode: WarningCode,
  config?: PolicyConfig,
): {
  targetSeverity?: PolicySeverityOption | undefined;
  localAllowDowngrade?: boolean | undefined;
} {
  const map = {
    ...(config?.overrides ?? {}),
    ...(config?.severities ?? {}),
  };

  const raw = map[ruleId] ?? map[warningCode];
  if (raw === undefined) {
    return {};
  }
  if (typeof raw === "string") {
    return { targetSeverity: raw };
  }
  if (typeof raw === "object" && raw !== null) {
    if (raw.enabled === false) {
      return {
        targetSeverity: "off",
        localAllowDowngrade: raw.allowSeverityDowngrade,
      };
    }
    return {
      targetSeverity: raw.severity,
      localAllowDowngrade: raw.allowSeverityDowngrade,
    };
  }
  return {};
}

/**
 * Evaluates a decoded `Invocation` (or `PolicyContext`) against the built-in
 * and custom policy rules, returning deterministically ordered warnings
 * (`blocked` before `review`, then rule evaluation order).
 *
 * The default policy fails closed:
 * - Missing/malformed invocations or rules that throw emit a `blocked` `INTERNAL_ERROR`.
 * - Lowering a rule's default severity requires `allowSeverityDowngrade: true`
 *   (or `allowUnsafeOverrides: true` / `allowLoweringSeverity: true`).
 */
export function evaluatePolicy(
  input: Invocation | PolicyContext | unknown,
  config?: PolicyConfig,
): PolicyWarning[] {
  const failClosed = config?.failClosed ?? true;
  const ctx = normalizeContext(input);

  if (!ctx) {
    if (failClosed) {
      return [
        {
          code: "INTERNAL_ERROR",
          ruleId: "policy-fail-closed",
          severity: "blocked",
          message:
            "Policy evaluation failed closed: invocation context is missing or malformed",
        },
      ];
    }
    return [];
  }

  const globalAllowDowngrade = Boolean(
    config?.allowSeverityDowngrade ??
    config?.allowUnsafeOverrides ??
    config?.allowLoweringSeverity ??
    false,
  );

  const rulesToRun: Rule[] = [...BUILTIN_RULES, ...(config?.rules ?? [])];
  const collected: { warning: PolicyWarning; order: number }[] = [];
  let orderCounter = 0;

  for (const rule of rulesToRun) {
    let rawWarnings: PolicyWarning[];
    try {
      rawWarnings = rule.evaluate(ctx);
      if (!Array.isArray(rawWarnings)) {
        throw new Error(`Rule "${rule.id}" did not return an array`);
      }
    } catch (err: unknown) {
      if (failClosed) {
        const msg = err instanceof Error ? err.message : String(err);
        collected.push({
          order: orderCounter++,
          warning: {
            code: "INTERNAL_ERROR",
            ruleId: rule.id,
            severity: "blocked",
            message: `Rule "${rule.id}" threw during evaluation: ${msg}`,
          },
        });
      }
      continue;
    }

    for (const w of rawWarnings) {
      const defaultSev: WarningSeverity =
        rule.defaultSeverity ??
        w.severity ??
        WARNING_SEVERITY[w.code] ??
        "blocked";

      const { targetSeverity, localAllowDowngrade } = resolveOverrideEntry(
        rule.id,
        w.code,
        config,
      );

      let finalSeverity: WarningSeverity = defaultSev;

      if (targetSeverity !== undefined) {
        const defaultRank = SEVERITY_RANK[defaultSev];
        const targetRank = SEVERITY_RANK[targetSeverity];
        const canDowngrade =
          globalAllowDowngrade || Boolean(localAllowDowngrade);

        if (targetRank > defaultRank) {
          // Raising severity is always permitted
          finalSeverity = targetSeverity as WarningSeverity;
        } else if (targetRank < defaultRank) {
          // Lowering severity requires explicit override flag
          if (canDowngrade) {
            if (targetSeverity === "ok" || targetSeverity === "off") {
              // Suppressed via explicit downgrade override
              continue;
            }
            finalSeverity = targetSeverity;
          } else {
            // Fail closed: retain default severity when downgrade is not explicitly authorized
            finalSeverity = defaultSev;
          }
        }
      }

      collected.push({
        order: orderCounter++,
        warning: {
          code: w.code,
          ruleId: w.ruleId ?? rule.id,
          severity: finalSeverity,
          message: w.message,
          ...(w.path !== undefined ? { path: w.path } : {}),
        },
      });
    }
  }

  collected.sort((a, b) => {
    const rankDiff =
      SEVERITY_RANK[b.warning.severity] - SEVERITY_RANK[a.warning.severity];
    if (rankDiff !== 0) return rankDiff;
    return a.order - b.order;
  });

  return collected.map((item) => item.warning);
}
