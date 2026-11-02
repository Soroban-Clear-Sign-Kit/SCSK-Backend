import { describe, it, expect } from "vitest";
import * as limits from "../../src/limits";

describe("limits", () => {
  it("are all positive integers", () => {
    for (const [name, value] of Object.entries(limits)) {
      expect(Number.isInteger(value), name).toBe(true);
      expect(value as number, name).toBeGreaterThan(0);
    }
  });

  it("keep the auth depth limit below the node limit", () => {
    expect(limits.MAX_AUTH_DEPTH).toBeLessThan(limits.MAX_AUTH_NODES);
  });

  it("keep the RPC timeout within a sane range", () => {
    expect(limits.RPC_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    expect(limits.RPC_TIMEOUT_MS).toBeLessThanOrEqual(60000);
  });

  it("use a fee warning multiplier above 1", () => {
    expect(limits.DEFAULT_FEE_WARNING_MULTIPLIER).toBeGreaterThan(1);
  });
});
