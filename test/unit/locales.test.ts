import { describe, it, expect } from "vitest";
import { en } from "../../src/locales/en";

describe("en locale", () => {
  it("interpolates account and token into read summaries", () => {
    expect(en.readsBalance("GA", "CT")).toBe(
      "Reads the balance of GA on token CT",
    );
    expect(en.readsAllowance("GA", "GB", "CT")).toBe(
      "Reads the allowance from GA for spender GB on token CT",
    );
  });

  it("formats generic calls and token movements", () => {
    expect(en.callFunction("swap", "CX")).toBe("Call swap on contract CX");
    expect(en.spendToken("1.5", "USDC")).toBe("You spend 1.5 USDC");
    expect(en.receiveToken("2", "XLM")).toBe("You receive 2 XLM");
  });

  it("pluralizes authorization counts", () => {
    expect(en.authorizeCalls(1, 1)).toBe(
      "You authorize 1 call across 1 contract",
    );
    expect(en.authorizeCalls(2, 1)).toBe(
      "You authorize 2 calls across 1 contract",
    );
    expect(en.authorizeCalls(1, 3)).toBe(
      "You authorize 1 call across 3 contracts",
    );
  });

  it("includes the error in simulation failures", () => {
    expect(en.simulationFailed("HostError")).toBe(
      "Simulation failed: HostError",
    );
  });

  it("exposes every string as text or a function returning text", () => {
    for (const value of Object.values(en)) {
      if (typeof value === "function") {
        const out = (value as (...a: any[]) => unknown)("a", "b", "c");
        expect(typeof out).toBe("string");
      } else {
        expect(typeof value).toBe("string");
      }
    }
  });
});
