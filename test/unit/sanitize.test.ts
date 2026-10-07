import { describe, it, expect } from 'vitest';
import { sanitizeString, sanitizeRecursive } from '../../src/sanitize.js';

describe('sanitization', () => {
  it('replaces C0 and C1 control characters with ?', () => {
    const res = sanitizeString('Hello\u0000World\u001F\u007F!');
    expect(res.value).toBe('Hello?World??!');
    expect(res.sanitized).toBe(true);
  });

  it('removes bidirectional override and isolate characters', () => {
    const res = sanitizeString('Hello\u202AWorld\u202E');
    expect(res.value).toBe('HelloWorld');
    expect(res.sanitized).toBe(true);
  });

  it('truncates strings longer than MAX_DISPLAY_STRING', () => {
    const longString = 'a'.repeat(600);
    const res = sanitizeString(longString);
    expect(res.value).toBe('a'.repeat(512));
    expect(res.truncated).toBe(true);
  });

  it('sanitizes objects recursively', () => {
    const obj = {
      nested: {
        text: 'Hello\u0000World'
      },
      arr: ['a\u202A']
    };
    const res = sanitizeRecursive(obj);
    expect(res.nested.text).toBe('Hello?World');
    expect(res.arr[0]).toBe('a');
  });

  it('leaves hex fields alone', () => {
    const obj = { hex: '00\u0000FF' };
    const res = sanitizeRecursive(obj);
    expect(res.hex).toBe('00\u0000FF');
  });
});
