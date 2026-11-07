import { WarningCode, WarningSeverity, WARNING_SEVERITY } from "./errors.js";

export type WarningSeverityOverrides = Partial<
  Record<WarningCode, WarningSeverity>
>;

/**
 * Resolves the effective severity for a warning code.
 * Built-in "blocked" warnings can never be downgraded to "review".
 */
export function resolveWarningSeverity(
  code: WarningCode,
  overrides?: WarningSeverityOverrides,
): WarningSeverity {
  const base = WARNING_SEVERITY[code];
  if (base === "blocked") return "blocked";
  const override = overrides?.[code];
  return override === "blocked" ? "blocked" : base;
}

export function computeRisk(
  warnings: {
    code: WarningCode;
    message: string;
    path?: string | undefined;
    severity?: WarningSeverity | undefined;
  }[],
  intentVerified: boolean = false,
  overrides?: WarningSeverityOverrides,
): "ok" | "review" | "blocked" {
  let hasReview = false;
  const clearedCodes = new Set([
    "SPEC_UNAVAILABLE",
    "VALUE_TOO_DEEP",
    "RESTORE_REQUIRED",
  ]);
  for (const w of warnings) {
    const baseSev = w.severity ?? WARNING_SEVERITY[w.code];
    const sev =
      overrides && w.code in overrides
        ? resolveWarningSeverity(w.code, overrides)
        : baseSev;
    if (sev === "blocked") return "blocked";
    if (sev === "review") {
      if (intentVerified && clearedCodes.has(w.code)) {
        continue;
      }
      hasReview = true;
    }
  }
  return hasReview ? "review" : "ok";
}

/** Splits warnings by severity, preserving their original order within each group. */
export function partitionWarnings<T extends { severity: "review" | "blocked" }>(
  warnings: readonly T[],
): { blocked: T[]; review: T[] } {
  const blocked: T[] = [];
  const review: T[] = [];
  for (const w of warnings) {
    (w.severity === "blocked" ? blocked : review).push(w);
  }
  return { blocked, review };
}
