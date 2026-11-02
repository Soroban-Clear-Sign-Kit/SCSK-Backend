import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const EXPECTED_FUNCTIONS = [
  "buildPreview",
  "computeRisk",
  "decodeAuthEntries",
  "decodeEvent",
  "decodeInvocation",
  "decodeLedgerEntry",
  "decodeScVal",
  "evaluatePolicy",
  "extractContractSpecSection",
  "extractTokenEffects",
  "formatAmount",
  "generateSummary",
  "getArray",
  "getAuthContractFnInfo",
  "getCreateContractInfo",
  "getDiagnosticEventInfo",
  "getInvokeContractInfo",
  "getSimulationResultInfo",
  "getSwitchName",
  "loadSpec",
  "parseEnvelope",
  "resolveContractSpec",
  "resolveTokenMetadata",
  "sanitizeRecursive",
  "sanitizeString",
  "simulateTransaction",
  "summarizeSimulation",
  "toBuffer",
  "toContractId",
  "unwrap",
  "verifyIntent",
];

describe("Package Consumer Compatibility (Packed Tarball)", () => {
  const rootDir = process.cwd();
  let tarballPath = "";
  let tmpDir = "";

  it("packs the package into a distributable tarball and verifies contents", () => {
    // Generate tarball using npm pack (fast, no network)
    const output = execSync("npm pack", { cwd: rootDir, encoding: "utf8" });
    const match = output.match(/([a-zA-Z0-9._-]+\.tgz)/);
    expect(match).toBeTruthy();
    if (!match || !match[1]) {
      throw new Error("Failed to parse npm pack output for tarball filename");
    }
    const tarballName = match[1];
    tarballPath = path.resolve(rootDir, tarballName);
    expect(fs.existsSync(tarballPath)).toBe(true);

    // Create temp directory inside node_modules so peer dependencies resolve up the directory tree
    tmpDir = fs.mkdtempSync(
      path.join(rootDir, "node_modules", ".consumer-packaging-test-"),
    );
  });

  it("extracts packed tarball into an ESM project and imports every public function", () => {
    const esmDir = path.join(tmpDir, "esm-project");
    fs.mkdirSync(esmDir, { recursive: true });

    // Unpack tarball directly into node_modules/@clearsign/core without network calls
    const targetPkgDir = path.join(esmDir, "node_modules/@clearsign/core");
    fs.mkdirSync(targetPkgDir, { recursive: true });
    execSync(
      `tar -xzf "${tarballPath}" --strip-components=1 -C "${targetPkgDir}"`,
    );

    // Verify package.json exists in unpacked directory
    expect(fs.existsSync(path.join(targetPkgDir, "package.json"))).toBe(true);

    // Create consumer ESM package.json
    fs.writeFileSync(
      path.join(esmDir, "package.json"),
      JSON.stringify(
        {
          name: "test-esm-consumer",
          type: "module",
        },
        null,
        2,
      ),
      "utf8",
    );

    // Test importing all public exports in ESM
    const esmScript = `
      import * as clearsign from "@clearsign/core";
      const expected = ${JSON.stringify(EXPECTED_FUNCTIONS)};
      for (const fnName of expected) {
        if (typeof clearsign[fnName] !== "function") {
          throw new Error("Missing or non-function export in ESM: " + fnName);
        }
      }
      console.log("ESM import check passed for " + expected.length + " functions");
    `;

    fs.writeFileSync(path.join(esmDir, "index.js"), esmScript, "utf8");
    const output = execSync("node index.js", { cwd: esmDir, encoding: "utf8" });
    expect(output).toContain("ESM import check passed");
  });

  it("extracts packed tarball into a CJS project and imports every public function", () => {
    const cjsDir = path.join(tmpDir, "cjs-project");
    fs.mkdirSync(cjsDir, { recursive: true });

    // Unpack tarball directly into node_modules/@clearsign/core without network calls
    const targetPkgDir = path.join(cjsDir, "node_modules/@clearsign/core");
    fs.mkdirSync(targetPkgDir, { recursive: true });
    execSync(
      `tar -xzf "${tarballPath}" --strip-components=1 -C "${targetPkgDir}"`,
    );

    // Verify package.json exists in unpacked directory
    expect(fs.existsSync(path.join(targetPkgDir, "package.json"))).toBe(true);

    // Create consumer CJS package.json
    fs.writeFileSync(
      path.join(cjsDir, "package.json"),
      JSON.stringify(
        {
          name: "test-cjs-consumer",
        },
        null,
        2,
      ),
      "utf8",
    );

    // Test requiring all public exports in CJS
    const cjsScript = `
      const clearsign = require("@clearsign/core");
      const expected = ${JSON.stringify(EXPECTED_FUNCTIONS)};
      for (const fnName of expected) {
        if (typeof clearsign[fnName] !== "function") {
          throw new Error("Missing or non-function export in CJS: " + fnName);
        }
      }
      console.log("CJS require check passed for " + expected.length + " functions");
    `;

    fs.writeFileSync(path.join(cjsDir, "index.js"), cjsScript, "utf8");
    const output = execSync("node index.js", { cwd: cjsDir, encoding: "utf8" });
    expect(output).toContain("CJS require check passed");
  });

  afterAll(() => {
    if (tarballPath && fs.existsSync(tarballPath)) {
      try {
        fs.unlinkSync(tarballPath);
      } catch {
        // ignore
      }
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });
});
