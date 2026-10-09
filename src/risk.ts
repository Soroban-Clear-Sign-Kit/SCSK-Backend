import { WarningCode, WARNING_SEVERITY } from './errors.js';

export function computeRisk(
  warnings: { code: WarningCode; message: string; path?: string }[],
  intentVerified: boolean = false
): 'ok' | 'review' | 'blocked' {
  let hasReview = false;
  const clearedCodes = new Set(['SPEC_UNAVAILABLE', 'VALUE_TOO_DEEP', 'RESTORE_REQUIRED']);
  for (const w of warnings) {
    const sev = WARNING_SEVERITY[w.code];
    if (sev === 'blocked') return 'blocked';
    if (sev === 'review') {
      if (intentVerified && clearedCodes.has(w.code)) {
        continue;
      }
      hasReview = true;
    }
  }
  return hasReview ? 'review' : 'ok';
}
