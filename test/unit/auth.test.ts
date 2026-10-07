import { describe, it, expect } from 'vitest';
import { decodeAuthEntries } from '../../src/auth.js';

describe('auth', () => {
  it('should handle empty auth entries', async () => {
    const { auth, warnings } = await decodeAuthEntries([], 100, { networkPassphrase: 'test' });
    expect(auth).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
