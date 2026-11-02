import { describe, it, expect } from "vitest";
import fc from "fast-check";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseEnvelope, ParseResult } from "../../src/envelope.js";
import { decodeScVal } from "../../src/scval.js";
import { evaluatePolicy } from "../../src/policy.js";
import { WARNING_SEVERITY } from "../../src/errors.js";
import { Networks, xdr } from "@stellar/stellar-sdk";
import { MAX_SCVAL_DEPTH, MAX_DISPLAY_STRING } from "../../src/limits.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load real fixture XDRs for mutation fuzzing
const fixturesDir = path.join(__dirname, "../fixtures");
const fixtureFiles = fs
  .readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".json"));
const realXdrs: string[] = [];
for (const file of fixtureFiles) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), "utf8"));
    if (typeof d.xdr === "string" && d.xdr.length > 0) {
      realXdrs.push(d.xdr);
    }
  } catch {
    // ignore
  }
}

// Fixed seed for 100% reproducible test runs in CI
const FUZZ_SEED = 0x5c5ca9;

describe("Property-based fuzz testing with fast-check (Fail-closed verification)", () => {
  it("[SM-01] random bytes/strings: parseEnvelope never throws and never returns an approved status for invalid input", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.base64String(),
          fc
            .uint8Array({ minLength: 0, maxLength: 5000 })
            .map((b) => Buffer.from(b).toString("base64")),
          fc.string({ minLength: 0, maxLength: 200 }).map((s) => s + "==="),
        ),
        (rawInput) => {
          const start = Date.now();
          let result: ParseResult | undefined;
          expect(() => {
            result = parseEnvelope(rawInput, Networks.TESTNET);
          }).not.toThrow();

          // Performance time bound: single envelope parse finishes in < 250ms
          expect(Date.now() - start).toBeLessThan(250);
          expect(result).toBeDefined();

          if (!result!.success) {
            expect(result!.error.code).toBeDefined();
            expect(WARNING_SEVERITY[result!.error.code]).toBe("blocked");
          } else {
            expect(result!.envelope.operations.length).toBeGreaterThan(0);
            expect(result!.innerTransaction).toBeDefined();
          }
        },
      ),
      { seed: FUZZ_SEED, numRuns: 300 },
    );
  });

  it("mutated valid envelopes (bit flips, truncation, repeated fields): never throws and fails closed", () => {
    expect(realXdrs.length).toBeGreaterThan(0);

    const mutationArb = fc.tuple(
      fc.constantFrom(...realXdrs),
      fc.constantFrom(
        "bitflip",
        "truncate",
        "repeat",
        "injectNull",
        "padGarbage",
      ),
      fc.nat(1000),
      fc.nat(255),
    );

    fc.assert(
      fc.property(mutationArb, ([baseXdr, mutation, param1, param2]) => {
        let mutated = baseXdr;
        const len = baseXdr.length;

        if (mutation === "bitflip" && len > 0) {
          const idx = param1 % len;
          const charCode = baseXdr.charCodeAt(idx) ^ ((param2 % 64) + 1);
          mutated =
            baseXdr.slice(0, idx) +
            String.fromCharCode(charCode) +
            baseXdr.slice(idx + 1);
        } else if (mutation === "truncate") {
          const cut = param1 % len;
          mutated = baseXdr.slice(0, cut);
        } else if (mutation === "repeat") {
          // Repeated field / duplicated chunk
          const chunk = baseXdr.slice(0, Math.min(len, (param1 % 40) + 1));
          mutated = chunk + baseXdr;
        } else if (mutation === "injectNull") {
          const idx = param1 % len;
          mutated = baseXdr.slice(0, idx) + "\0\0\0" + baseXdr.slice(idx);
        } else if (mutation === "padGarbage") {
          mutated = baseXdr + "!@#$%^&*()_=";
        }

        const start = Date.now();
        let result: ParseResult | undefined;
        expect(() => {
          result = parseEnvelope(mutated, Networks.TESTNET);
        }).not.toThrow();

        expect(Date.now() - start).toBeLessThan(250);
        expect(result).toBeDefined();

        if (!result!.success) {
          expect(WARNING_SEVERITY[result!.error.code]).toBe("blocked");
        }
      }),
      { seed: FUZZ_SEED, numRuns: 500 },
    );
  });

  it("deeply nested ScVal: recursion limits strictly hold and never throw or stack overflow", () => {
    // Generate tree depths from 1 to 60 (exceeding MAX_SCVAL_DEPTH = 32)
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (depth) => {
        let nestedScVal: any = xdr.ScVal.scvU32(42);
        for (let d = 0; d < depth; d++) {
          nestedScVal = xdr.ScVal.scvVec([nestedScVal]);
        }

        let res: ReturnType<typeof decodeScVal> | undefined;
        expect(() => {
          res = decodeScVal(nestedScVal, null, null);
        }).not.toThrow();
        expect(res).toBeDefined();

        if (depth > MAX_SCVAL_DEPTH) {
          // Must flag VALUE_TOO_DEEP warning
          expect(res!.warnings).toContainEqual(
            expect.objectContaining({
              code: "VALUE_TOO_DEEP",
            }),
          );
        }
      }),
      { seed: FUZZ_SEED, numRuns: 60 },
    );
  });

  it("oversize strings: enforces length bounds and string sanitization safely", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 100, maxLength: 2000 }),
        (largeStr) => {
          const scval = xdr.ScVal.scvString(largeStr);
          let res: ReturnType<typeof decodeScVal> | undefined;
          expect(() => {
            res = decodeScVal(scval, null, null);
          }).not.toThrow();

          expect(res).toBeDefined();
          expect(res!.value.kind).toBe("string");
          if (res!.value.kind === "string") {
            if (largeStr.length > MAX_DISPLAY_STRING) {
              expect(res!.value.truncated).toBe(true);
              expect(res!.value.value.length).toBeLessThanOrEqual(
                MAX_DISPLAY_STRING + 3, // with ellipsis
              );
            }
          }
        },
      ),
      { seed: FUZZ_SEED, numRuns: 100 },
    );
  });

  it("hostile policy input: evaluatePolicy never throws and fails closed to blocked", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant({}),
          fc.constant({ functionName: 1234 }),
          fc.record({
            contractId: fc.string(),
            functionName: fc.string(),
            args: fc.array(fc.anything()),
            specSource: fc.string(),
          }),
        ),
        (hostileContext) => {
          let warnings: any;
          expect(() => {
            warnings = evaluatePolicy(hostileContext);
          }).not.toThrow();

          expect(Array.isArray(warnings)).toBe(true);
          // If context is completely invalid, must emit blocked INTERNAL_ERROR (fail closed)
          if (
            !hostileContext ||
            typeof (hostileContext as any).functionName !== "string"
          ) {
            expect(warnings).toContainEqual(
              expect.objectContaining({
                code: "INTERNAL_ERROR",
                severity: "blocked",
              }),
            );
          }
        },
      ),
      { seed: FUZZ_SEED, numRuns: 150 },
    );
  });

  describe("Regression fixtures from fuzzing", () => {
    it("handles zero-length truncated envelope regression safely", () => {
      const res = parseEnvelope("");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("ENVELOPE_MALFORMED");
        expect(WARNING_SEVERITY[res.error.code]).toBe("blocked");
      }
    });

    it("handles deeply nested ScVal vector regression without stack overflow", () => {
      let current: any = xdr.ScVal.scvString("bottom");
      for (let i = 0; i < 50; i++) {
        current = xdr.ScVal.scvVec([current]);
      }
      const res = decodeScVal(current, null, null);
      expect(res.warnings.some((w) => w.code === "VALUE_TOO_DEEP")).toBe(true);
    });

    it("handles null-injected envelope regression safely", () => {
      const hostileXdr =
        realXdrs[0]?.slice(0, 20) + "\0\0\0" + realXdrs[0]?.slice(20);
      const res = parseEnvelope(hostileXdr || "\0\0\0");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(WARNING_SEVERITY[res.error.code]).toBe("blocked");
      }
    });
  });
});
