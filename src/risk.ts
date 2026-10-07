import { WarningCode, WARNING_SEVERITY } from './errors.js';

export function computeRisk(warnings: { code: WarningCode; message: string; path?: string }[]): 'ok' | 'review' | 'blocked' {
  let hasReview = false;
  for (const w of warnings) {
    const sev = WARNING_SEVERITY[w.code];
    if (sev === 'blocked') return 'blocked';
    if (sev === 'review') hasReview = true;
  }
  return hasReview ? 'review' : 'ok';
}
