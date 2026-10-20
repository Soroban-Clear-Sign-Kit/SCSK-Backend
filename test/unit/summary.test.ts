import { describe, it, expect } from "vitest";
import { generateSummary } from "../../src/summary";
import { en } from "../../src/locales/en";

describe("Summary generation", () => {
  it("generates basic summary without invocation or effects", () => {
    const summary = generateSummary(undefined, [], [], {
      status: "success",
      warnings: [],
    });
    expect(summary).toEqual([]);
  });

  it("generates summary for failed simulation", () => {
    const summary = generateSummary(undefined, [], [], {
      status: "failed",
      error: "some error",
      warnings: [],
    });
    expect(summary).toContain("Simulation failed: some error");
  });

  it("generates summary for unavailable simulation", () => {
    const summary = generateSummary(undefined, [], [], {
      status: "unavailable",
      warnings: [],
    });
    expect(summary).toContain(
      "Simulation unavailable. The summary may be incomplete.",
    );
  });

  it("includes token effects", () => {
    const summary = generateSummary(
      undefined,
      [],
      [
        {
          tokenContractId: "CB...",
          account: "GA...",
          delta: "-10.50",
          symbol: "USDC",
          decimals: 7,
          formatted: "10.50",
        },
      ],
      { status: "success", warnings: [] },
      "GA...",
    );
    expect(summary).toContain("You spend 10.50 USDC");
  });

  it("formats auth entries summary", () => {
    const summary = generateSummary(
      undefined,
      [
        {
          root: {
            depth: 0,
            children: [],
            kind: "contract-fn",
            contractId: "C1",
          },
          credentials: { type: "source-account" } as any,
        },
        {
          root: {
            depth: 0,
            children: [],
            kind: "contract-fn",
            contractId: "C2",
          },
          credentials: { type: "source-account" } as any,
        },
      ],
      [],
      { status: "success", warnings: [] },
    );
    expect(summary).toContain("You authorize 2 calls across 2 contracts");
  });

  it("formats single auth entry summary", () => {
    const summary = generateSummary(
      undefined,
      [
        {
          root: {
            depth: 0,
            children: [],
            kind: "contract-fn",
            contractId: "C1",
          },
          credentials: { type: "source-account" } as any,
        },
      ],
      [],
      { status: "success", warnings: [] },
    );
    expect(summary).toContain("You authorize 1 call across 1 contract");
  });

  it("includes invocation summary", () => {
    const summary = generateSummary(
      {
        contractId: "CC...",
        functionName: "swap",
        args: [],
        specSource: "none",
      },
      [],
      [],
      { status: "success", warnings: [] },
    );
    expect(summary).toContain("Call swap on contract CC...");
  });

  it("generates summary for Deploy contract", () => {
    const summary = generateSummary(
      { contractId: "Deploy", functionName: "", args: [], specSource: "none" },
      [],
      [],
      { status: "success", warnings: [] },
    );
    expect(summary).toContain("Deploy contract");
  });

  it("generates summary for Upload contract code", () => {
    const summary = generateSummary(
      { contractId: "Upload", functionName: "", args: [], specSource: "none" },
      [],
      [],
      { status: "success", warnings: [] },
    );
    expect(summary).toContain("Upload contract code");
  });

  it("generates summary for balance function", () => {
    const summary = generateSummary(
      {
        contractId: "C1",
        functionName: "balance",
        args: [
          {
            name: "id",
            typeName: "address",
            value: { kind: "address", value: "GA1", addressType: "account" },
          },
        ],
        specSource: "none",
      },
      [],
      [],
      { status: "success", warnings: [] },
    );
    expect(summary).toContain("Reads the balance of GA1 on token C1");
  });

  it("generates summary for allowance function", () => {
    const summary = generateSummary(
      {
        contractId: "C1",
        functionName: "allowance",
        args: [
          {
            name: "from",
            typeName: "address",
            value: { kind: "address", value: "GA1", addressType: "account" },
          },
          {
            name: "spender",
            typeName: "address",
            value: { kind: "address", value: "GA2", addressType: "account" },
          },
        ],
        specSource: "none",
      },
      [],
      [],
      { status: "success", warnings: [] },
    );
    expect(summary).toContain(
      "Reads the allowance from GA1 for spender GA2 on token C1",
    );
  });

  it("generates summary for decimals function", () => {
    const summary = generateSummary(
      {
        contractId: "C1",
        functionName: "decimals",
        args: [],
        specSource: "none",
      },
      [],
      [],
      { status: "success", warnings: [] },
    );
    expect(summary).toContain("Reads the decimals of token C1");
  });

  it("generates summary for name function", () => {
    const summary = generateSummary(
      { contractId: "C1", functionName: "name", args: [], specSource: "none" },
      [],
      [],
      { status: "success", warnings: [] },
    );
    expect(summary).toContain("Reads the name of token C1");
  });

  it("generates summary for symbol function", () => {
    const summary = generateSummary(
      {
        contractId: "C1",
        functionName: "symbol",
        args: [],
        specSource: "none",
      },
      [],
      [],
      { status: "success", warnings: [] },
    );
    expect(summary).toContain("Reads the symbol of token C1");
  });

  it("includes positive token effects (receive)", () => {
    const summary = generateSummary(
      undefined,
      [],
      [
        {
          tokenContractId: "CB...",
          account: "GA...",
          delta: "50.00",
          symbol: "USDC",
          decimals: 7,
          formatted: "50.00",
        },
      ],
      { status: "success", warnings: [] },
      "GA...",
    );
    expect(summary).toContain("You receive 50.00 USDC");
  });
});

describe("Summary generation: nesting and pluralization", () => {
  const ok = { status: "success" as const, warnings: [] };
  const entry = (root: any) => ({
    root,
    credentials: { type: "source-account" } as any,
  });

  it("counts nested sub-invocations but not distinct contracts twice", () => {
    const summary = generateSummary(
      undefined,
      [
        entry({
          kind: "contract-fn",
          contractId: "C1",
          depth: 0,
          children: [
            { kind: "contract-fn", contractId: "C2", depth: 1, children: [] },
            { kind: "contract-fn", contractId: "C2", depth: 1, children: [] },
          ],
        }),
      ],
      [],
      ok,
    );
    expect(summary).toContain("You authorize 3 calls across 2 contracts");
  });

  it("uses singular wording for one call on one contract", () => {
    const summary = generateSummary(
      undefined,
      [
        entry({
          kind: "contract-fn",
          contractId: "C1",
          depth: 0,
          children: [],
        }),
      ],
      [],
      ok,
    );
    expect(summary).toContain("You authorize 1 call across 1 contract");
  });

  it("ignores create-contract nodes when counting calls", () => {
    const summary = generateSummary(
      undefined,
      [entry({ kind: "create-contract", depth: 0, children: [] })],
      [],
      ok,
    );
    expect(summary).toEqual([]);
  });
});

describe("Summary generation: signer effects", () => {
  const ok = { status: "success" as const, warnings: [] };

  it("only reports effects for the signer", () => {
    const summary = generateSummary(
      undefined,
      [],
      [
        {
          tokenContractId: "T",
          account: "GSIGNER",
          delta: "-5",
          symbol: "USDC",
          formatted: "-0.5",
        },
        { tokenContractId: "T", account: "GOTHER", delta: "5", symbol: "USDC" },
      ],
      ok,
      "GSIGNER",
    );
    expect(summary).toEqual(["You spend -0.5 USDC"]);
  });

  it("reports nothing about effects without a signer address", () => {
    const summary = generateSummary(
      undefined,
      [],
      [{ tokenContractId: "T", account: "GSIGNER", delta: "-5" }],
      ok,
    );
    expect(summary).toEqual([]);
  });
});

describe("Summary generation: custom locale", () => {
  it("uses provided locale strings", () => {
    const summary = generateSummary(
      undefined,
      [],
      [],
      { status: "unavailable", warnings: [] },
      undefined,
      { ...en, simulationUnavailable: "Simulation indisponible." },
    );
    expect(summary).toEqual(["Simulation indisponible."]);
  });
});
