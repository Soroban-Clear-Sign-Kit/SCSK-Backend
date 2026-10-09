import { describe, it, expect } from "vitest";
import { verifyIntent } from "../../src/intent.js";
import {
  Intent,
  Invocation,
  AuthEntry,
  BalanceDelta,
} from "../../src/types.js";

describe("intent verification", () => {
  const defaultInvocation: Invocation = {
    contractId: "C123",
    functionName: "transfer",
    args: [
      {
        name: "to",
        typeName: "address",
        value: { kind: "address", value: "G456", addressType: "account" },
      },
      {
        name: "amount",
        typeName: "i128",
        value: { kind: "int", type: "i128", value: "100" },
      },
    ],
    specSource: "wasm",
  };

  it("passes on matching intent", () => {
    const intent: Intent = {
      contractId: "C123",
      functionName: "transfer",
      args: { to: "G456", amount: "100" },
    };
    const { warnings } = verifyIntent(
      intent,
      defaultInvocation,
      [],
      [],
      "G123",
    );
    expect(warnings).toEqual([]);
  });

  it("fails on empty invocation or intent", () => {
    expect(
      verifyIntent(undefined, defaultInvocation, [], [], "G123").warnings,
    ).toEqual([]);
    expect(
      verifyIntent(
        { contractId: "C1", functionName: "" },
        undefined as any,
        [],
        [],
        "G123",
      ).warnings,
    ).toEqual([]);
  });

  it("fails on contract id mismatch", () => {
    const intent: Intent = { contractId: "C999", functionName: "transfer" };
    const { warnings } = verifyIntent(
      intent,
      defaultInvocation,
      [],
      [],
      "G123",
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "INTENT_MISMATCH", path: "contractId" }),
    );
  });

  it("fails on function name mismatch", () => {
    const intent: Intent = { contractId: "C123", functionName: "mint" };
    const { warnings } = verifyIntent(
      intent,
      defaultInvocation,
      [],
      [],
      "G123",
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: "INTENT_MISMATCH",
        path: "functionName",
      }),
    );
  });

  it("warns if specSource is none", () => {
    const intent: Intent = {
      contractId: "C123",
      functionName: "transfer",
      args: { to: "G456" },
    };
    const inv: Invocation = { ...defaultInvocation, specSource: "none" };
    const { warnings } = verifyIntent(intent, inv, [], [], "G123");
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "INTENT_UNVERIFIABLE", path: "args" }),
    );
  });

  it("fails if arg is missing", () => {
    const intent: Intent = {
      contractId: "C123",
      functionName: "transfer",
      args: { to: "G456", missing: "val" },
    };
    const { warnings } = verifyIntent(
      intent,
      defaultInvocation,
      [],
      [],
      "G123",
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: "INTENT_MISMATCH",
        path: "args.missing",
      }),
    );
  });

  it("verifies different value kinds properly", () => {
    const inv: Invocation = {
      contractId: "C123",
      functionName: "transfer",
      specSource: "wasm",
      args: [
        { name: "a", typeName: "bool", value: { kind: "bool", value: true } },
        {
          name: "b",
          typeName: "bytes",
          value: {
            kind: "bytes",
            hex: "deadbeef",
            length: 4,
            truncated: false,
          },
        },
        {
          name: "c",
          typeName: "symbol",
          value: {
            kind: "symbol",
            value: "sym",
            sanitized: false,
            truncated: false,
          },
        },
        {
          name: "d",
          typeName: "string",
          value: {
            kind: "string",
            value: "str",
            sanitized: false,
            truncated: false,
          },
        },
      ],
    };
    const intent: Intent = {
      contractId: "C123",
      functionName: "transfer",
      args: { a: "true", b: "deadbeef", c: "sym", d: "str" },
    };
    const { warnings } = verifyIntent(intent, inv, [], [], "G123");
    expect(warnings).toEqual([]);
  });

  it("fails on maxSpend exceeded", () => {
    const intent: Intent = {
      contractId: "C123",
      functionName: "transfer",
      maxSpend: { token: "T1", account: "G123", amount: "50" },
    };
    const effects: BalanceDelta[] = [
      { tokenContractId: "T1", account: "G123", delta: "-100" },
    ];
    const { warnings } = verifyIntent(
      intent,
      defaultInvocation,
      [],
      effects,
      "G123",
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "INTENT_SPEND_EXCEEDED" }),
    );
  });

  it("validates allowed contracts", () => {
    const intent: Intent = {
      contractId: "C123",
      functionName: "transfer",
      allowedContracts: ["C123"],
    };
    const auth: AuthEntry[] = [
      {
        credentials: { type: "address", address: "G123" } as any,
        root: {
          contractId: "C123",
          functionName: "transfer",
          args: [],
          children: [{ contractId: "C999" }],
        } as any,
      },
    ];
    const { warnings } = verifyIntent(
      intent,
      defaultInvocation,
      auth,
      [],
      "G123",
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "INTENT_UNEXPECTED_AUTH" }),
    );
  });

  it("validates allowed contracts for source-account credentials", () => {
    const intent: Intent = {
      contractId: "C123",
      functionName: "transfer",
      allowedContracts: ["C123"],
    };
    const auth: AuthEntry[] = [
      {
        credentials: { type: "source-account" },
        root: {
          contractId: "C123",
          functionName: "transfer",
          args: [],
          children: [{ contractId: "C999" }],
        } as any,
      },
    ];
    // G123 is the signer and the tx source account
    const { warnings } = verifyIntent(
      intent,
      defaultInvocation,
      auth,
      [],
      "G123",
      "G123",
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "INTENT_UNEXPECTED_AUTH" }),
    );
  });

  it("fails on argument value mismatch", () => {
    const intent: Intent = {
      contractId: "C123",
      functionName: "transfer",
      args: { to: "G456", amount: "200" }, // mismatch here, expected 200, invocation has 100
    };
    const { warnings } = verifyIntent(
      intent,
      defaultInvocation,
      [],
      [],
      "G123",
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "INTENT_MISMATCH", path: "args.amount" }),
    );
  });

  it("normalizes non-string intent arguments", () => {
    const inv: Invocation = {
      contractId: "C123",
      functionName: "transfer",
      specSource: "wasm",
      args: [
        {
          name: "amount",
          typeName: "i128",
          value: { kind: "int", type: "i128", value: "100" },
        },
        {
          name: "flag",
          typeName: "bool",
          value: { kind: "bool", value: true },
        },
      ],
    };
    const intent: Intent = {
      contractId: "C123",
      functionName: "transfer",
      // passing non-string values directly to cover `String(val)` in normalize
      args: { amount: 100 as any, flag: true as any },
    };
    const { warnings } = verifyIntent(intent, inv, [], [], "G123");
    expect(warnings).toEqual([]);
  });
});
