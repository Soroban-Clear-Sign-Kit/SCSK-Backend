import { describe, it, expect } from 'vitest';
import { ClearSignError } from '../../src/errors';

describe('ClearSignError', () => {
  it('instantiates correctly with code and message', () => {
    const err = new ClearSignError('INTERNAL_ERROR', 'Something went wrong');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ClearSignError');
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.message).toBe('Something went wrong');
  });
});
