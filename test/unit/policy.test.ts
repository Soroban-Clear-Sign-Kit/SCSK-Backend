import { describe, it, expect } from "vitest";
import {
  I128_MAX,
  Rule,
  PolicyContext,
  unlimitedApprovalRule,
  newSpenderApprovalRule,
  transferFromRule,
  adminChangeRule,
  wasmUpdateRule,
  unknownFunctionNoSpecRule,
  BUILTIN_RULES,
  evaluatePolicy,
} from "../../src/policy.js";
import { computeRisk } from "../../src/risk.js";
import { Invocation } from "../../src/types.js";

const TOKEN_CONTRACT =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const ALICE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const SPENDER = "CB23WRDQWGSP6YPMY4UV5C4OW5CBTXKYN3XEATG7KJEZCXMJBYEHOUOV";

function makeApproveInvocation(
  amount: string,
  spender: string = SPENDER,
  specSource: Invocation["specSource"] = "sac-builtin",
): Invocation {
  return {
    contractId: TOKEN_CONTRACT,
    functionName: "approve",
    specSource,
    args: [
      {
        name: "from",
        typeName: "address",
        value: { kind: "address", value: ALICE, addressType: "account" },
      },
      {
        name: "spender",
        typeName: "address",
        value: { kind: "address", value: spender, addressType: "contract" },
      },
      {
        name: "amount",
        typeName: "i128",
        value: { kind: "int", type: "i128", value: amount },
      },
      {
        name: "expiration_ledger",
        typeName: "u32",
        value: { kind: "int", type: "u32", value: "1000" },
      },
    ],
  };
}

describe("Policy Layer & Built-in Rules", () => {
  it("exports all 6 built-in rules in canonical order", () => {
    expect(BUILTIN_RULES.map((r) => r.id)).toEqual([
      "unlimited-approval",
      "new-spender-approval",
      "transfer-from",
      "admin-change",
      "wasm-update",
      "unknown-function-no-spec",
    ]);
  });

  describe("1. unlimited-approval rule", () => {
    it("positive: emits UNLIMITED_APPROVAL when approve amount is at the i128 maximum", () => {
      const inv = makeApproveInvocation(I128_MAX.toString());
      const warnings = unlimitedApprovalRule.evaluate({ invocation: inv });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        code: "UNLIMITED_APPROVAL",
        ruleId: "unlimited-approval",
        severity: "review",
        path: "args.amount",
      });
    });

    it("positive: handles unnamed fallback and raw undecodable amount fail-closed", () => {
      const unnamedInv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "increase_allowance",
        specSource: "wasm",
        args: [
          {
            name: "spender",
            typeName: "address",
            value: { kind: "address", value: SPENDER, addressType: "contract" },
          },
          {
            name: null,
            typeName: "i128",
            value: { kind: "int", type: "i128", value: I128_MAX.toString() },
          },
        ],
      };
      expect(
        unlimitedApprovalRule.evaluate({ invocation: unnamedInv }),
      ).toHaveLength(1);

      const rawAmountInv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "approve",
        specSource: "sac-builtin",
        args: [
          {
            name: "amount",
            typeName: "i128",
            value: { kind: "raw", scvalType: "scvI128", xdr: "AAAA" },
          },
        ],
      };
      expect(
        unlimitedApprovalRule.evaluate({ invocation: rawAmountInv })[0]?.code,
      ).toBe("UNLIMITED_APPROVAL");
    });

    it("negative: returns no warning when approve amount is below i128 maximum or not an approval", () => {
      const boundedInv = makeApproveInvocation("10000000");
      expect(
        unlimitedApprovalRule.evaluate({ invocation: boundedInv }),
      ).toEqual([]);

      const transferInv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "transfer",
        specSource: "sac-builtin",
        args: [],
      };
      expect(
        unlimitedApprovalRule.evaluate({ invocation: transferInv }),
      ).toEqual([]);
    });
  });

  describe("2. new-spender-approval rule", () => {
    it("positive: emits APPROVAL_NEW_SPENDER when spender is not in knownSpenders", () => {
      const inv = makeApproveInvocation("500", SPENDER);
      const warnings = newSpenderApprovalRule.evaluate({
        invocation: inv,
        knownSpenders: [ALICE],
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        code: "APPROVAL_NEW_SPENDER",
        ruleId: "new-spender-approval",
        severity: "review",
        path: "args.spender",
      });

      // Missing spender arg also fails closed
      const missingSpenderInv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "approve",
        specSource: "wasm",
        args: [],
      };
      expect(
        newSpenderApprovalRule.evaluate({ invocation: missingSpenderInv })[0]
          ?.code,
      ).toBe("APPROVAL_NEW_SPENDER");
    });

    it("negative: returns no warning when spender is in knownSpenders or amount is 0 (revocation)", () => {
      const inv = makeApproveInvocation("500", SPENDER);
      expect(
        newSpenderApprovalRule.evaluate({
          invocation: inv,
          knownSpenders: [SPENDER],
        }),
      ).toEqual([]);
      expect(
        newSpenderApprovalRule.evaluate({
          invocation: inv,
          knownSpenders: new Set([SPENDER]),
        }),
      ).toEqual([]);

      // Revocation (amount = 0)
      const revokeInv = makeApproveInvocation("0", SPENDER);
      expect(
        newSpenderApprovalRule.evaluate({ invocation: revokeInv }),
      ).toEqual([]);
    });
  });

  describe("3. transfer-from rule", () => {
    it("positive: emits TRANSFER_FROM when functionName is transfer_from", () => {
      const inv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "transfer_from",
        specSource: "sac-builtin",
        args: [],
      };
      const warnings = transferFromRule.evaluate({ invocation: inv });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        code: "TRANSFER_FROM",
        ruleId: "transfer-from",
        severity: "review",
        path: "functionName",
      });
    });

    it("negative: returns no warning for direct transfer", () => {
      const inv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "transfer",
        specSource: "sac-builtin",
        args: [],
      };
      expect(transferFromRule.evaluate({ invocation: inv })).toEqual([]);
    });
  });

  describe("4. admin-change rule", () => {
    it("positive: emits ADMIN_CHANGE when functionName modifies contract admin", () => {
      const inv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "set_admin",
        specSource: "sac-builtin",
        args: [
          {
            name: "new_admin",
            typeName: "address",
            value: { kind: "address", value: SPENDER, addressType: "contract" },
          },
        ],
      };
      const warnings = adminChangeRule.evaluate({ invocation: inv });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        code: "ADMIN_CHANGE",
        ruleId: "admin-change",
        severity: "blocked",
        path: "functionName",
      });
    });

    it("negative: returns no warning for non-admin functions", () => {
      const inv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "balance",
        specSource: "sac-builtin",
        args: [],
      };
      expect(adminChangeRule.evaluate({ invocation: inv })).toEqual([]);
    });
  });

  describe("5. wasm-update rule", () => {
    it("positive: emits CONTRACT_WASM_UPDATE when functionName updates contract Wasm", () => {
      const inv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "update_current_contract_wasm",
        specSource: "wasm",
        args: [],
      };
      const warnings = wasmUpdateRule.evaluate({ invocation: inv });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        code: "CONTRACT_WASM_UPDATE",
        ruleId: "wasm-update",
        severity: "blocked",
        path: "functionName",
      });
    });

    it("negative: returns no warning for standard contract calls", () => {
      const inv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "swap",
        specSource: "wasm",
        args: [],
      };
      expect(wasmUpdateRule.evaluate({ invocation: inv })).toEqual([]);
    });
  });

  describe("6. unknown-function-no-spec rule", () => {
    it("positive: emits SPEC_UNAVAILABLE (review) when specSource is none", () => {
      const inv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "mystery_fn",
        specSource: "none",
        args: [],
      };
      const warnings = unknownFunctionNoSpecRule.evaluate({ invocation: inv });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        code: "SPEC_UNAVAILABLE",
        ruleId: "unknown-function-no-spec",
        severity: "review",
        path: "functionName",
      });
    });

    it("negative: returns no warning when contract spec is available", () => {
      const inv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "mystery_fn",
        specSource: "wasm",
        args: [],
      };
      expect(unknownFunctionNoSpecRule.evaluate({ invocation: inv })).toEqual(
        [],
      );
    });
  });

  describe("evaluatePolicy: ordering, custom rules, override semantics, and fail-closed", () => {
    it("orders blocked warnings before review warnings and preserves rule evaluation order", () => {
      // set_admin with no spec triggers both admin-change (blocked) and unknown-function-no-spec (review)
      const inv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "set_admin",
        specSource: "none",
        args: [],
      };

      const customRule: Rule = {
        id: "custom-audit",
        evaluate: () => [
          {
            code: "INTENT_MISMATCH",
            severity: "review",
            message: "Custom review warning",
          },
        ],
      };

      const warnings = evaluatePolicy(inv, { rules: [customRule] });
      expect(warnings.map((w) => `${w.ruleId}:${w.severity}`)).toEqual([
        "admin-change:blocked",
        "unknown-function-no-spec:review",
        "custom-audit:review",
      ]);
      expect(computeRisk(warnings)).toBe("blocked");
    });

    it("allows raising a rule's default severity without an override flag", () => {
      const inv = makeApproveInvocation(I128_MAX.toString(), SPENDER);
      const warnings = evaluatePolicy(
        { invocation: inv, knownSpenders: [SPENDER] },
        {
          severities: {
            "unlimited-approval": "blocked",
          },
        },
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.code).toBe("UNLIMITED_APPROVAL");
      expect(warnings[0]?.severity).toBe("blocked");
      expect(computeRisk(warnings)).toBe("blocked");
    });

    it("refuses to lower a default severity unless the explicit override flag is provided", () => {
      const adminInv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "set_admin",
        specSource: "sac-builtin",
        args: [],
      };

      // 1. Attempt to downgrade blocked -> review WITHOUT override flag: fails closed (stays blocked)
      const withoutFlag = evaluatePolicy(adminInv, {
        severities: {
          "admin-change": "review",
        },
      });
      expect(withoutFlag).toHaveLength(1);
      expect(withoutFlag[0]?.severity).toBe("blocked");
      expect(computeRisk(withoutFlag)).toBe("blocked");

      // 2. Downgrade blocked -> review WITH allowSeverityDowngrade: true
      const withGlobalFlag = evaluatePolicy(adminInv, {
        severities: {
          "admin-change": "review",
        },
        allowSeverityDowngrade: true,
      });
      expect(withGlobalFlag).toHaveLength(1);
      expect(withGlobalFlag[0]?.severity).toBe("review");
      expect(computeRisk(withGlobalFlag)).toBe("review");

      // 3. Suppress a review rule ("off" / enabled: false) WITHOUT flag vs WITH local flag
      const transferFromInv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "transfer_from",
        specSource: "sac-builtin",
        args: [],
      };
      const notSuppressed = evaluatePolicy(transferFromInv, {
        overrides: {
          "transfer-from": { enabled: false },
        },
      });
      expect(notSuppressed).toHaveLength(1);
      expect(notSuppressed[0]?.severity).toBe("review");

      const suppressed = evaluatePolicy(transferFromInv, {
        overrides: {
          "transfer-from": { enabled: false, allowSeverityDowngrade: true },
        },
      });
      expect(suppressed).toEqual([]);
      expect(computeRisk(suppressed)).toBe("ok");
    });

    it("fails closed when invocation is missing/malformed or a custom rule throws", () => {
      const badCtxWarnings = evaluatePolicy(null);
      expect(badCtxWarnings).toHaveLength(1);
      expect(badCtxWarnings[0]).toMatchObject({
        code: "INTERNAL_ERROR",
        ruleId: "policy-fail-closed",
        severity: "blocked",
      });

      const throwingRule: Rule = {
        id: "broken-rule",
        evaluate(_ctx: PolicyContext) {
          throw new Error("unexpected rule failure");
        },
      };

      const validInv: Invocation = {
        contractId: TOKEN_CONTRACT,
        functionName: "transfer",
        specSource: "sac-builtin",
        args: [],
      };
      const thrownWarnings = evaluatePolicy(validInv, {
        rules: [throwingRule],
      });
      expect(thrownWarnings).toHaveLength(1);
      expect(thrownWarnings[0]).toMatchObject({
        code: "INTERNAL_ERROR",
        ruleId: "broken-rule",
        severity: "blocked",
      });
    });
  });
});
