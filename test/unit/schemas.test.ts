import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  DisplayValueSchema,
  WarningSchema,
  TransactionSummarySchema,
  ClearSignPreviewSchema,
} from "../../src/schemas.js";
import { WarningCodeEnum } from "../../src/errors.js";
import { buildPreview } from "../../src/preview.js";
import { rpc, Networks } from "@stellar/stellar-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

describe("Runtime Schemas & Stable Warning Contract", () => {
  describe("WarningCodeEnum stability", () => {
    it("preserves exact stable string identifiers and counts", () => {
      const expectedCodes = [
        "ENVELOPE_MALFORMED",
        "ENVELOPE_TOO_LARGE",
        "NETWORK_MISMATCH",
        "TX_EXPIRED",
        "SIGNATURE_INVALID",
        "CLASSIC_OP_NOT_DECODED",
        "CONTRACT_DEPLOYMENT",
        "WASM_UPLOAD",
        "SPEC_UNAVAILABLE",
        "ARG_COUNT_MISMATCH",
        "ARG_TYPE_MISMATCH",
        "UNSUPPORTED_SCVAL",
        "VALUE_TOO_DEEP",
        "AUTH_TREE_TOO_LARGE",
        "AUTH_EXPIRING",
        "AUTH_EXPIRED",
        "AUTH_DUPLICATE_NONCE",
        "AUTH_UNKNOWN_CONTRACT",
        "AUTH_EXTRA_CONTRACT",
        "AUTH_CREATES_CONTRACT",
        "SIMULATION_FAILED",
        "SIMULATION_UNAVAILABLE",
        "RESTORE_REQUIRED",
        "FEE_UNUSUALLY_HIGH",
        "EVENT_SHAPE_UNKNOWN",
        "TOKEN_METADATA_UNAVAILABLE",
        "INTENT_MISMATCH",
        "INTENT_SPEND_EXCEEDED",
        "INTENT_UNEXPECTED_AUTH",
        "INTENT_UNVERIFIABLE",
        "UNLIMITED_APPROVAL",
        "APPROVAL_NEW_SPENDER",
        "TRANSFER_FROM",
        "ADMIN_CHANGE",
        "CONTRACT_WASM_UPDATE",
        "INTERNAL_ERROR",
      ].sort();

      const actualCodes = Object.values(WarningCodeEnum).sort();
      expect(actualCodes).toEqual(expectedCodes);
    });

    it("fails validation if a warning code is renamed or unmapped", () => {
      const validWarning = {
        code: WarningCodeEnum.ENVELOPE_MALFORMED,
        severity: "blocked",
        message: "Malformed envelope",
      };
      expect(() => WarningSchema.parse(validWarning)).not.toThrow();

      const renamedWarning = {
        code: "ENVELOPE_CORRUPTED", // non-existent/renamed code
        severity: "blocked",
        message: "Corrupted",
      };
      expect(() => WarningSchema.parse(renamedWarning)).toThrow();
    });
  });

  describe("DisplayValueSchema", () => {
    it("validates all DisplayValue variants", () => {
      expect(() =>
        DisplayValueSchema.parse({ kind: "bool", value: true }),
      ).not.toThrow();

      expect(() => DisplayValueSchema.parse({ kind: "void" })).not.toThrow();

      expect(() =>
        DisplayValueSchema.parse({
          kind: "int",
          type: "i128",
          value: "1000000",
        }),
      ).not.toThrow();

      expect(() =>
        DisplayValueSchema.parse({
          kind: "address",
          value: "GB...",
          addressType: "account",
        }),
      ).not.toThrow();

      expect(() =>
        DisplayValueSchema.parse({
          kind: "vec",
          items: [{ kind: "bool", value: false }],
        }),
      ).not.toThrow();

      expect(() =>
        DisplayValueSchema.parse({
          kind: "map",
          entries: [
            {
              key: {
                kind: "string",
                value: "k",
                sanitized: false,
                truncated: false,
              },
              value: { kind: "int", type: "u32", value: "42" },
            },
          ],
        }),
      ).not.toThrow();
    });

    it("rejects invalid display value shapes", () => {
      expect(() =>
        DisplayValueSchema.parse({ kind: "unknown_kind", val: 123 }),
      ).toThrow();
    });
  });

  describe("TransactionSummarySchema fixture output validation & snapshots", () => {
    const fixturesDir = path.join(__dirname, "../fixtures");
    const fixtureFiles = [
      "sac_transfer.json",
      "sim_fail_balance.json",
      "restore_required.json",
      "expired_auth.json",
      "nested_auth.json",
    ];

    for (const file of fixtureFiles) {
      it(`validates buildPreview output for ${file} against TransactionSummarySchema and matches snapshot structure`, async () => {
        const raw = fs.readFileSync(path.join(fixturesDir, file), "utf8");
        const data = JSON.parse(raw);

        vi.mocked(rpc.Server).mockImplementation(
          () =>
            ({
              getNetwork: vi.fn().mockResolvedValue({
                passphrase: Networks.TESTNET,
              }),
              getLatestLedger: vi
                .fn()
                .mockResolvedValue({ sequence: data.sim?.latestLedger || 100 }),
              simulateTransaction: vi.fn().mockResolvedValue(data.sim),
              getContractInstance: vi
                .fn()
                .mockRejectedValue(new Error("No contract instance")),
              getContractWasmByContractId: vi
                .fn()
                .mockRejectedValue(new Error("No contract wasm")),
            }) as any,
        );

        const preview = await buildPreview({
          xdr: data.xdr,
          rpcUrl: "http://mock-rpc",
          networkPassphrase: Networks.TESTNET,
          options: {
            now: 1700000000000,
          },
        });

        // 1. Validates against TransactionSummarySchema
        const validated = TransactionSummarySchema.parse(preview);
        expect(validated.version).toBe(1);
        expect(["ok", "review", "blocked"]).toContain(validated.risk);

        // 2. Snapshot representative stable keys
        expect({
          version: preview.version,
          risk: preview.risk,
          warningCodes: preview.warnings.map((w) => w.code),
          simulationStatus: preview.simulation.status,
          hasInvocation: preview.invocation !== undefined,
        }).toMatchSnapshot();
      });
    }
  });
});
