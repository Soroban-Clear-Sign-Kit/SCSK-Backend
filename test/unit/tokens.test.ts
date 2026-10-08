import { describe, it, expect } from 'vitest';
import { formatAmount } from '../../src/tokens.js';

describe('tokens formatting', () => {
  it('formats zero correctly', () => {
    expect(formatAmount('0', 7)).toBe('0');
  });

  it('formats values over 2^64', () => {
    expect(formatAmount('18446744073709551616', 7)).toBe('1844674407370.9551616');
  });

  it('formats negative values', () => {
    expect(formatAmount('-1234567', 7)).toBe('-0.1234567');
  });

  it('formats with 0 decimals', () => {
    expect(formatAmount('123', 0)).toBe('123');
    expect(formatAmount('-123', 0)).toBe('-123');
  });

  it('formats with 18 decimals', () => {
    expect(formatAmount('1000000000000000000', 18)).toBe('1');
    expect(formatAmount('1234567890123456789', 18)).toBe('1.234567890123456789');
  });
});
