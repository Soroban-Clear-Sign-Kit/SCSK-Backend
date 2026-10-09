import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { buildPreview } from "../../src/preview";

describe("Live Testnet Integration", () => {
  const fixturesDir = path.join(__dirname, "../fixtures");
  const files = [
    "sac_transfer.json",
    "fixture_forward.json",
    "forward_with_meta.json",
    "wrong_network.json",
    "expired_auth.json",
    "sim_fail_balance.json",
    "feebump.json",
    "classic.json",
  ];
  const rpcUrl = "https://soroban-testnet.stellar.org";
  const networkPassphrase = "Test SDF Network ; September 2015";

  for (const file of files) {
    it(`tests ${file} on live testnet`, async () => {
      const raw = fs.readFileSync(path.join(fixturesDir, file), "utf8");
      const data = JSON.parse(raw);

      const preview = await buildPreview({
        xdr: data.xdr,
        rpcUrl,
        networkPassphrase:
          file === "wrong_network.json"
            ? "Public Global Stellar Network ; September 2015"
            : networkPassphrase,
      });

      expect(preview.version).toBe(1);
      expect(preview.risk).toBeDefined();

      if (file === "wrong_network.json") {
        expect(preview.risk).toBe("blocked");
        expect(
          preview.warnings.some((w) => w.code === "NETWORK_MISMATCH"),
        ).toBe(true);
      } else if (file === "classic.json") {
        console.log("CLASSIC WARNINGS:", preview.warnings);
        expect(preview.risk).toBe("review");
        expect(
          preview.warnings.some((w) => w.code === "CLASSIC_OP_NOT_DECODED"),
        ).toBe(true);
      } else if (file === "sim_fail_balance.json") {
        expect(preview.risk).toBe("blocked");
        expect(preview.simulation.status).toBe("failed");
      } else if (file === "expired_auth.json") {
        console.log("EXPIRED_AUTH WARNINGS:", preview.warnings);
        expect(preview.risk).toBe("blocked");
        expect(preview.warnings.some((w) => w.code === "AUTH_EXPIRED")).toBe(
          true,
        );
      } else {
        if (preview.envelope.operations.length === 0) {
          console.error(
            `Missing operations for ${file}. Warnings:`,
            preview.warnings,
            `Risk:`,
            preview.risk,
          );
        }
        expect(preview.envelope.operations.length).toBeGreaterThan(0);
        if (preview.simulation.status === "success") {
          if (preview.risk === "blocked") {
            console.error(
              `Unexpected blocked risk for ${file}:`,
              preview.warnings,
            );
            console.error(
              "SPEC_UNAVAILABLE severity is:",
              preview.warnings[0]?.severity,
            );
          }
          expect(preview.risk).not.toBe("blocked");
        }
      }
    }, 30000);
  }
});
