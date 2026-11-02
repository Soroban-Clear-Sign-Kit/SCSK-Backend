import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseEnvelope } from "../../src/envelope.js";
import { decodeInvocation } from "../../src/invocation.js";

const EXPECTED_MAINNET_FIXTURES: Record<
  string,
  {
    source: string;
    contractId: string;
    functionName: string;
    argCount: number;
  }
> = {
  "mainnet_complex_0.json": {
    source: "GDBFRRLMYGI3YEKIM5XYKYGJ5OWSKNUMGDMTCNBS2LEAE3J2ZAFR4A6O",
    contractId: "CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA",
    functionName: "work",
    argCount: 3,
  },
  "mainnet_complex_1.json": {
    source: "GCKJP34DJZDYARQJIUX4V5MTJMY7II2MG4G53T4D7NIAOMTJBCXKKT62",
    contractId: "CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA",
    functionName: "work",
    argCount: 3,
  },
  "mainnet_complex_2.json": {
    source: "GCYTAEBDJ36SF66U5PTHTG6AK43ZFUMQTWCFUMCF26CJ3KLUAJOKY6PR",
    contractId: "CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA",
    functionName: "work",
    argCount: 3,
  },
  "mainnet_complex_3.json": {
    source: "GAKSSWH3L3ULQ2TDWBY254VETMB5WAJVOGBIXMXNYFP43ZBZRAT7HOAW",
    contractId: "CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA",
    functionName: "work",
    argCount: 3,
  },
  "mainnet_complex_4.json": {
    source: "GBD3YROP4MXZG6HM7QXEIV6A6DPVKLVOKJALCO3KTFA2PBAP7C4WV25J",
    contractId: "CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA",
    functionName: "work",
    argCount: 3,
  },
  "mainnet_complex_5.json": {
    source: "GBVGXTS2QWLFVLUOHPR322N4WHBXLZGK3Q2HXYT75MUP3FQLOUDDVHWC",
    contractId: "CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA",
    functionName: "work",
    argCount: 3,
  },
};

describe("Mainnet Complex Fixtures", () => {
  const fixturesDir = path.join(__dirname, "../fixtures");
  const fixtures = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.startsWith("mainnet_complex_") && f.endsWith(".json"));

  for (const fixtureFile of fixtures) {
    it(`parses and decodes ${fixtureFile}`, async () => {
      const raw = fs.readFileSync(path.join(fixturesDir, fixtureFile), "utf8");
      const data = JSON.parse(raw);
      const expected = EXPECTED_MAINNET_FIXTURES[fixtureFile];
      if (!expected) {
        throw new Error(`Missing expected values for fixture: ${fixtureFile}`);
      }

      // 1. Parse envelope
      const parsed = parseEnvelope(
        data.xdr,
        "Public Global Stellar Network ; September 2015",
      );
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.envelope.source).toBe(expected.source);

      // 2. Decode invocation
      expect(parsed.innerTransaction.operations.length).toBeGreaterThan(0);
      const op = parsed.innerTransaction.operations[0];
      expect(op?.type).toBe("invokeHostFunction");

      const decoded = await decodeInvocation(op, {
        networkPassphrase: "Public Global Stellar Network ; September 2015",
        rpcUrl: "https://soroban-testnet.stellar.org",
      });

      expect(decoded.invocation.contractId).toBe(expected.contractId);
      expect(decoded.invocation.functionName).toBe(expected.functionName);
      expect(decoded.invocation.args).toHaveLength(expected.argCount);
    }, 15000);
  }
});
