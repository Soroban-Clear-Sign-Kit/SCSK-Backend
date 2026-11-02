import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

describe("check:security-model validation script", () => {
  it("passes cleanly on the current codebase", () => {
    const output = execSync("node scripts/check-security-model.js", {
      encoding: "utf8",
    });
    expect(output).toContain("All security claims are backed by tests");
  });

  it("fails if a test cites an unknown claim ID", () => {
    const tempTestFile = path.join(
      process.cwd(),
      "test/unit/temp-unknown-claim.test.ts",
    );
    try {
      const unknownId = ["S", "M", "-", "9", "9"].join("");
      fs.writeFileSync(
        tempTestFile,
        `describe("temp", () => { it("[${unknownId}] unknown claim", () => {}); });`,
        "utf8",
      );
      expect(() => {
        execSync("node scripts/check-security-model.js", { encoding: "utf8" });
      }).toThrow();
    } finally {
      if (fs.existsSync(tempTestFile)) {
        fs.unlinkSync(tempTestFile);
      }
    }
  });

  it("fails if SECURITY-MODEL.md contains an unbacked claim ID", () => {
    const secModelPath = path.join(process.cwd(), "SECURITY-MODEL.md");
    const original = fs.readFileSync(secModelPath, "utf8");
    try {
      const phantomId = ["S", "M", "-", "9", "8"].join("");
      fs.writeFileSync(
        secModelPath,
        original + `\n\n### ${phantomId}: Phantom Unbacked Claim\n`,
        "utf8",
      );
      expect(() => {
        execSync("node scripts/check-security-model.js", { encoding: "utf8" });
      }).toThrow();
    } finally {
      fs.writeFileSync(secModelPath, original, "utf8");
    }
  });
});
