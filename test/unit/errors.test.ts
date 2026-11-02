import { describe, it, expect } from "vitest";
import { ClearSignError, WARNING_SEVERITY } from "../../src/errors";

describe("ClearSignError", () => {
  it("instantiates correctly with code and message", () => {
    const err = new ClearSignError("INTERNAL_ERROR", "Something went wrong");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ClearSignError");
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).toBe("Something went wrong");
  });
});

describe("ClearSignError behaviour", () => {
  it("is an Error with the expected name", () => {
    const err = new ClearSignError("INTERNAL_ERROR", "oops");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ClearSignError");
    expect(err.message).toBe("oops");
  });

  it("can be thrown and caught by code", () => {
    try {
      throw new ClearSignError("NETWORK_MISMATCH", "wrong network");
    } catch (e) {
      expect((e as ClearSignError).code).toBe("NETWORK_MISMATCH");
    }
  });
});

describe("WARNING_SEVERITY", () => {
  it("only uses review or blocked", () => {
    for (const sev of Object.values(WARNING_SEVERITY)) {
      expect(["review", "blocked"]).toContain(sev);
    }
  });

  it("blocks every INTENT_* code", () => {
    for (const [code, sev] of Object.entries(WARNING_SEVERITY)) {
      if (code.startsWith("INTENT_")) expect(sev).toBe("blocked");
    }
  });

  it("blocks every code that means the transaction could not be understood", () => {
    for (const code of [
      "ENVELOPE_MALFORMED",
      "ENVELOPE_TOO_LARGE",
      "NETWORK_MISMATCH",
      "SIMULATION_FAILED",
      "INTERNAL_ERROR",
    ] as const) {
      expect(WARNING_SEVERITY[code]).toBe("blocked");
    }
  });
});
