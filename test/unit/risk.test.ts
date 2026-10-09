import { describe, it, expect } from 'vitest';
import { computeRisk } from '../../src/risk.js';
import { WarningCode, WARNING_SEVERITY } from '../../src/errors.js';

describe('risk computation', () => {
  it('maps every warning code to the expected risk', () => {
    for (const code of Object.keys(WARNING_SEVERITY) as WarningCode[]) {
      const risk = computeRisk([{ code, message: 'test' }]);
      expect(risk).toBe(WARNING_SEVERITY[code]);
    }
  });

  it('returns ok only when there are zero warnings', () => {
    expect(computeRisk([])).toBe('ok');
  });

  it('returns blocked if any warning is blocked', () => {
    expect(computeRisk([
      { code: 'CLASSIC_OP_NOT_DECODED', message: 'review' },
      { code: 'ENVELOPE_MALFORMED', message: 'blocked' }
    ], false)).toBe('blocked');
  });

  it('clears SPEC_UNAVAILABLE, VALUE_TOO_DEEP, and RESTORE_REQUIRED if intent is verified', () => {
    expect(computeRisk([
      { code: 'SPEC_UNAVAILABLE', message: 'test' },
      { code: 'VALUE_TOO_DEEP', message: 'test' },
      { code: 'RESTORE_REQUIRED', message: 'test' }
    ], true)).toBe('ok');
  });

  it('does not clear UNSUPPORTED_SCVAL or CLASSIC_OP_NOT_DECODED if intent is verified', () => {
    expect(computeRisk([
      { code: 'UNSUPPORTED_SCVAL', message: 'test' }
    ], true)).toBe('review');

    expect(computeRisk([
      { code: 'CLASSIC_OP_NOT_DECODED', message: 'test' }
    ], true)).toBe('review');
  });
});
