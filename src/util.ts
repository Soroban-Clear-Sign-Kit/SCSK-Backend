/**
 * Returns a shallow copy of `obj` without keys whose value is `undefined`.
 *
 * With `exactOptionalPropertyTypes` enabled, an optional property may be absent but
 * must not be explicitly `undefined`, so option bags are cleaned before being passed on.
 */
export function stripUndefined<T extends object>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as { [K in keyof T]: Exclude<T[K], undefined> };
}
