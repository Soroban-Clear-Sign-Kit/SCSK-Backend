import { MAX_DISPLAY_STRING } from './limits.js';

export function sanitizeString(input: string): { value: string; sanitized: boolean; truncated: boolean } {
  let value = input;
  let sanitized = false;
  let truncated = false;

  // Remove bidi override, isolate, and zero-width characters
  const removeRegex = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/g;
  if (removeRegex.test(value)) {
    value = value.replace(removeRegex, '');
    sanitized = true;
  }

  // Replace C0 and C1 control characters with ?
  const controlRegex = /[\u0000-\u001F\u007F-\u009F]/g;
  if (controlRegex.test(value)) {
    value = value.replace(controlRegex, '?');
    sanitized = true;
  }

  // Truncate to MAX_DISPLAY_STRING
  if (value.length > MAX_DISPLAY_STRING) {
    value = value.substring(0, MAX_DISPLAY_STRING);
    truncated = true;
  }

  return { value, sanitized, truncated };
}

export function sanitizeRecursive(obj: any): any {
  if (typeof obj === 'string') {
    return sanitizeString(obj).value;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeRecursive(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const res: any = {};
    for (const key of Object.keys(obj)) {
      if (key === 'hex') {
         res[key] = obj[key]; // Do not sanitize hex strings
      } else {
         res[key] = sanitizeRecursive(obj[key]);
      }
    }
    return res;
  }
  return obj;
}
