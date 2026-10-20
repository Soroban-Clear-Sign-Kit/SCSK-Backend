/**
 * Races `promise` against a timer and rejects with `Error(message)` if the timer wins.
 * The timer is always cleared, so it never keeps the process alive after settlement.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = "RPC Timeout",
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(handle);
  }
}
