import { WarningCode, WARNING_SEVERITY } from "./errors.js";

export function computeRisk(
  warnings: { code: WarningCode; message: string; path?: string }[],
  intentVerified: boolean = false,
): "ok" | "review" | "blocked" {
  let hasReview = false;
  const clearedCodes = new Set([
    "SPEC_UNAVAILABLE",
    "VALUE_TOO_DEEP",
    "RESTORE_REQUIRED",
  ]);
  for (const w of warnings) {
    const sev = WARNING_SEVERITY[w.code];
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
