import { describe, it, expect } from "vitest";
import { computeRisk, partitionWarnings } from "../../src/risk.js";
import { WarningCode, WARNING_SEVERITY } from "../../src/errors.js";

describe("risk computation", () => {
  it("maps every warning code to the expected risk", () => {
    for (const code of Object.keys(WARNING_SEVERITY) as WarningCode[]) {
      const risk = computeRisk([{ code, message: "test" }]);
      expect(risk).toBe(WARNING_SEVERITY[code]);
    }
  });

  it("returns ok only when there are zero warnings", () => {
    expect(computeRisk([])).toBe("ok");
  });

  it("returns blocked if any warning is blocked", () => {
    expect(
      computeRisk(
        [
          { code: "CLASSIC_OP_NOT_DECODED", message: "review" },
          { code: "ENVELOPE_MALFORMED", message: "blocked" },
        ],
        false,
      ),
    ).toBe("blocked");
  });

  it("clears SPEC_UNAVAILABLE, VALUE_TOO_DEEP, and RESTORE_REQUIRED if intent is verified", () => {
    expect(
      computeRisk(
        [
          { code: "SPEC_UNAVAILABLE", message: "test" },
          { code: "VALUE_TOO_DEEP", message: "test" },
          { code: "RESTORE_REQUIRED", message: "test" },
        ],
        true,
      ),
    ).toBe("ok");
  });

  it("does not clear UNSUPPORTED_SCVAL or CLASSIC_OP_NOT_DECODED if intent is verified", () => {
    expect(
      computeRisk([{ code: "UNSUPPORTED_SCVAL", message: "test" }], true),
    ).toBe("review");

    expect(
      computeRisk([{ code: "CLASSIC_OP_NOT_DECODED", message: "test" }], true),
    ).toBe("review");
  });
});

describe("partitionWarnings", () => {
  const w = (code: string, severity: "review" | "blocked") => ({
    code,
    severity,
    message: code,
  });

  it("splits warnings by severity and keeps their order", () => {
    const res = partitionWarnings([
      w("A", "review"),
      w("B", "blocked"),
      w("C", "review"),
      w("D", "blocked"),
    ]);
    expect(res.blocked.map((x) => x.code)).toEqual(["B", "D"]);
    expect(res.review.map((x) => x.code)).toEqual(["A", "C"]);
  });

  it("returns empty groups for no warnings", () => {
    expect(partitionWarnings([])).toEqual({ blocked: [], review: [] });
  });

  it("does not mutate its input", () => {
    const input = [w("A", "review"), w("B", "blocked")];
    partitionWarnings(input);
    expect(input.map((x) => x.code)).toEqual(["A", "B"]);
  });
});

describe("computeRisk edge cases", () => {
  it("stays blocked when intent is verified", () => {
    expect(
      computeRisk([{ code: "SIMULATION_FAILED", message: "x" }], true),
    ).toBe("blocked");
  });

  it("blocked wins even when review warnings come first", () => {
    expect(
      computeRisk(
        [
          { code: "SPEC_UNAVAILABLE", message: "a" },
          { code: "AUTH_EXPIRED", message: "b" },
        ],
        false,
      ),
    ).toBe("blocked");
  });

  it("is ok when intent clears every review warning present", () => {
    expect(
      computeRisk(
        [
          { code: "SPEC_UNAVAILABLE", message: "a" },
          { code: "VALUE_TOO_DEEP", message: "b" },
          { code: "RESTORE_REQUIRED", message: "c" },
        ],
        true,
      ),
    ).toBe("ok");
  });

  it("is still review if only some warnings are cleared by intent", () => {
    expect(
      computeRisk(
        [
          { code: "SPEC_UNAVAILABLE", message: "a" },
          { code: "AUTH_EXTRA_CONTRACT", message: "b" },
        ],
        true,
      ),
    ).toBe("review");
  });
});
