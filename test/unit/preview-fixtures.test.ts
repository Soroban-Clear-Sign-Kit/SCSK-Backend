import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildPreview } from "../../src/preview.js";
import { rpc, Networks } from "@stellar/stellar-sdk";
import { WarningCode } from "../../src/errors.js";

vi.mock("@stellar/stellar-sdk", async () => {
  const actual = (await vi.importActual("@stellar/stellar-sdk")) as any;
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn(),
    },
  };
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FixtureExpected {
  risk: "ok" | "review" | "blocked";
  warnings: WarningCode[];
  functionName: string | undefined;
  networkPassphrase?: string;
}

const EXPECTED_FIXTURE_RESULTS: Record<string, FixtureExpected> = {
  "expired_auth.json": {
    risk: "blocked",
    warnings: ["AUTH_EXPIRED", "SIMULATION_FAILED", "SPEC_UNAVAILABLE"],
    functionName: "transfer",
  },
  "feebump.json": {
    risk: "review",
    warnings: ["SPEC_UNAVAILABLE"],
    functionName: "transfer",
  },
  "fixture_forward.json": {
    risk: "review",
    warnings: ["SPEC_UNAVAILABLE"],
    functionName: "forward",
  },
  "forward_with_meta.json": {
    risk: "blocked",
    warnings: ["SIMULATION_FAILED", "SPEC_UNAVAILABLE"],
    functionName: "forward_with_meta",
  },
  "nested_auth.json": {
    risk: "review",
    warnings: ["SPEC_UNAVAILABLE"],
    functionName: "nested_auth",
  },
  "sac_transfer.json": {
    risk: "review",
    warnings: ["SPEC_UNAVAILABLE"],
    functionName: "transfer",
  },
  "simple_call.json": {
    risk: "review",
    warnings: ["SPEC_UNAVAILABLE"],
    functionName: "simple_call",
  },
  "sim_fail_balance.json": {
    risk: "blocked",
    warnings: ["SIMULATION_FAILED", "SPEC_UNAVAILABLE"],
    functionName: "transfer",
  },
  "transfer_auth.json": {
    risk: "review",
    warnings: ["SPEC_UNAVAILABLE"],
    functionName: "transfer_auth",
  },
  "wrong_network.json": {
    risk: "blocked",
    warnings: ["NETWORK_MISMATCH"],
    functionName: undefined,
    networkPassphrase: Networks.PUBLIC,
  },
};

describe("buildPreview on simulation fixtures", () => {
  const fixturesDir = path.join(__dirname, "../fixtures");
  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => {
      const d = JSON.parse(fs.readFileSync(path.join(fixturesDir, f), "utf8"));
      return d.sim !== undefined && d.sim !== null;
    });

  for (const file of files) {
    it(`evaluates real buildPreview for ${file}`, async () => {
      const raw = fs.readFileSync(path.join(fixturesDir, file), "utf8");
      const data = JSON.parse(raw);
      const expected = EXPECTED_FIXTURE_RESULTS[file];
      if (!expected) {
        throw new Error(`Missing expected test values for fixture: ${file}`);
      }

      vi.mocked(rpc.Server).mockImplementation(
        () =>
          ({
            getNetwork: vi.fn().mockResolvedValue({
              passphrase:
                file === "wrong_network.json"
                  ? Networks.TESTNET
                  : expected.networkPassphrase || Networks.TESTNET,
            }),
            getLatestLedger: vi
              .fn()
              .mockResolvedValue({ sequence: data.sim.latestLedger || 100 }),
            simulateTransaction: vi.fn().mockResolvedValue(data.sim),
            getContractInstance: vi
              .fn()
              .mockRejectedValue(new Error("No contract instance")),
            getContractWasmByContractId: vi
              .fn()
              .mockRejectedValue(new Error("No contract wasm")),
          }) as any,
      );

      const res = await buildPreview({
        xdr: data.xdr,
        rpcUrl: "http://mock-rpc",
        networkPassphrase: expected.networkPassphrase || Networks.TESTNET,
        options: {
          now: 1700000000000,
        },
      });

      expect(res.risk).toBe(expected.risk);
      expect(res.invocation?.functionName).toBe(expected.functionName);

      const actualWarningCodes = Array.from(
        new Set(res.warnings.map((w) => w.code)),
      ).sort();
      const expectedWarningCodes = [...expected.warnings].sort();
      expect(actualWarningCodes).toEqual(expectedWarningCodes);
    });
  }
});
