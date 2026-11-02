import { describe, it, expect, vi, afterEach } from "vitest";
import { withTimeout } from "../../src/timeout";

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the promise value when it settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("propagates the original rejection", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000),
    ).rejects.toThrow("boom");
  });

  it("rejects with the default message once the timer elapses", async () => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => {});
    const result = expect(withTimeout(pending, 50)).rejects.toThrow(
      "RPC Timeout",
    );
    await vi.advanceTimersByTimeAsync(50);
    await result;
  });

  it("uses a custom message when provided", async () => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => {});
    const result = expect(withTimeout(pending, 10, "too slow")).rejects.toThrow(
      "too slow",
    );
    await vi.advanceTimersByTimeAsync(10);
    await result;
  });

  it("clears its timer after the promise settles", async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve("ok"), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
