import { MAX_DISPLAY_STRING } from "./limits.js";

export function sanitizeString(
  input: string,
  maxLength: number = MAX_DISPLAY_STRING,
): {
  value: string;
  sanitized: boolean;
  truncated: boolean;
} {
  let value = input;
  let sanitized = false;
  let truncated = false;

  // Remove bidi override, isolate, and zero-width characters
  const removeRegex = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/g;
  if (removeRegex.test(value)) {
    value = value.replace(removeRegex, "");
    sanitized = true;
  }

  // Replace C0 and C1 control characters with ?
  const controlRegex = /[\u0000-\u001F\u007F-\u009F]/g;
  if (controlRegex.test(value)) {
    value = value.replace(controlRegex, "?");
    sanitized = true;
  }

  // Truncate to maxLength
  if (value.length > maxLength) {
    value = value.substring(0, maxLength);
    truncated = true;
  }

  return { value, sanitized, truncated };
}

export function sanitizeRecursive(
  obj: any,
  maxLength: number = MAX_DISPLAY_STRING,
): any {
  if (typeof obj === "string") {
    return sanitizeString(obj, maxLength).value;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeRecursive(item, maxLength));
  }
  if (obj !== null && typeof obj === "object") {
    if (
      (obj.kind === "string" || obj.kind === "symbol") &&
      typeof obj.value === "string"
    ) {
      const s = sanitizeString(obj.value, maxLength);
      return {
        ...obj,
        value: s.value,
        sanitized: Boolean(obj.sanitized || s.sanitized),
        truncated: Boolean(obj.truncated || s.truncated),
      };
    }
    const res: any = {};
    for (const key of Object.keys(obj)) {
      if (key === "hex" || key === "xdr") {
        res[key] = obj[key]; // Do not sanitize hex strings or raw xdr
      } else {
        res[key] = sanitizeRecursive(obj[key], maxLength);
      }
    }
    return res;
  }
  return obj;
}
