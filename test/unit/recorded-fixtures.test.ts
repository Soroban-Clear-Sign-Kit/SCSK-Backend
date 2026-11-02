import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildPreview } from "../../src/preview.js";
import { parseEnvelope } from "../../src/envelope.js";
import { rpc, Networks } from "@stellar/stellar-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

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

describe("Recorded testnet fixtures suite with *.expected.json locking", () => {
  const fixtureFiles = fs
    .readdirSync(FIXTURES_DIR)
    .filter(
      (f) =>
        f.endsWith(".json") &&
        !f.endsWith(".expected.json") &&
        f !== "testnet.example.json",
    );

  for (const file of fixtureFiles) {
    const fixturePath = path.join(FIXTURES_DIR, file);
    const expectedPath = path.join(
      FIXTURES_DIR,
      file.replace(/\.json$/, ".expected.json"),
    );

    it(`decodes ${file} and matches reviewed expected output in ${path.basename(expectedPath)}`, async () => {
      expect(fs.existsSync(expectedPath)).toBe(true);
      const rawData = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
      const expectedOutput = JSON.parse(fs.readFileSync(expectedPath, "utf8"));

      // Every fixture must contain provenance capture metadata
      expect(rawData.captureInfo).toBeDefined();
      expect(typeof rawData.captureInfo.note).toBe("string");
      expect(rawData.captureInfo.note.length).toBeGreaterThan(10);

      let actualOutput: any;
      if (expectedOutput.type === "preview") {
        vi.mocked(rpc.Server).mockImplementation(
          () =>
            ({
              getNetwork: vi.fn().mockResolvedValue({
                passphrase:
                  file === "wrong_network.json"
                    ? Networks.TESTNET
                    : rawData.networkPassphrase || Networks.TESTNET,
              }),
              getLatestLedger: vi.fn().mockResolvedValue({
                sequence: rawData.sim?.latestLedger || 100,
              }),
              simulateTransaction: vi.fn().mockResolvedValue(rawData.sim),
              getContractInstance: vi
                .fn()
                .mockRejectedValue(new Error("No contract instance")),
              getContractWasmByContractId: vi
                .fn()
                .mockRejectedValue(new Error("No contract wasm")),
            }) as any,
        );

        const networkPassphrase =
          rawData.networkPassphrase ||
          (file === "wrong_network.json" ? Networks.PUBLIC : Networks.TESTNET);

        const preview = await buildPreview({
          xdr: rawData.xdr,
          rpcUrl: "http://mock-rpc",
          networkPassphrase,
          options: { now: 1700000000000 },
        });

        actualOutput = {
          type: "preview",
          risk: preview.risk,
          warnings: Array.from(
            new Set(preview.warnings.map((w) => w.code)),
          ).sort(),
          functionName: preview.invocation?.functionName || null,
          simulationStatus: preview.simulation.status,
          operationTypes: preview.envelope.operations.map((o) => o.type),
        };
      } else {
        const parsed = parseEnvelope(
          rawData.xdr,
          "Public Global Stellar Network ; September 2015",
        );
        actualOutput = {
          type: "envelope",
          success: parsed.success,
          operationTypes: parsed.success
            ? parsed.envelope.operations.map((o) => o.type)
            : [],
          warnings: parsed.success
            ? parsed.warnings.map((w) => w.code).sort()
            : [parsed.error.code],
        };
      }

      expect(actualOutput).toEqual(expectedOutput);
    });
  }

  it("strictly fails when an expected value is deliberately changed", () => {
    const sampleExpected = {
      type: "preview",
      risk: "ok", // intentionally incorrect: real sac_transfer risk is "review"
      warnings: ["SPEC_UNAVAILABLE"],
      functionName: "transfer",
      simulationStatus: "success",
      operationTypes: ["invokeHostFunction"],
    };

    const actualOutput = {
      type: "preview",
      risk: "review",
      warnings: ["SPEC_UNAVAILABLE"],
      functionName: "transfer",
      simulationStatus: "success",
      operationTypes: ["invokeHostFunction"],
    };

    expect(() => {
      expect(actualOutput).toEqual(sampleExpected);
    }).toThrow();
  });
});
