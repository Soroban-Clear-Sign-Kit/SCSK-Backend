import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import path from "path";

describe("Offline Runnable Examples", () => {
  const rootDir = process.cwd();

  it("runs examples/decode-envelope.js without network calls", () => {
    const scriptPath = path.join(rootDir, "examples/decode-envelope.js");
    const output = execSync(`node "${scriptPath}"`, {
      cwd: rootDir,
      encoding: "utf8",
    });

    expect(output).toContain(
      "=== ClearSign Core: Offline Envelope Decoding Example ===",
    );
    expect(output).toContain("Source Account :");
    expect(output).toContain("Decoded Host Function Invocation:");
    expect(output).toContain("Function Name: transfer");
    expect(output).toContain("[SUCCESS] Envelope decoded cleanly offline!");
  });

  it("runs examples/summarize-simulation.js without network calls", () => {
    const scriptPath = path.join(rootDir, "examples/summarize-simulation.js");
    const output = execSync(`node "${scriptPath}"`, {
      cwd: rootDir,
      encoding: "utf8",
    });

    expect(output).toContain(
      "=== ClearSign Core: Offline Simulation Summary Example ===",
    );
    expect(output).toContain("Simulation Summary:");
    expect(output).toContain("Status       : success");
    expect(output).toContain("Decoded Event:");
    expect(output).toContain(
      "[SUCCESS] Simulation summarized cleanly offline!",
    );
  });

  it("runs examples/evaluate-policy.js without network calls", () => {
    const scriptPath = path.join(rootDir, "examples/evaluate-policy.js");
    const output = execSync(`node "${scriptPath}"`, {
      cwd: rootDir,
      encoding: "utf8",
    });

    expect(output).toContain(
      "=== ClearSign Core: Offline Policy Evaluation Example ===",
    );
    expect(output).toContain("Scenario A (Standard Transfer):");
    expect(output).toContain("[APPROVED] No policy violations detected.");
    expect(output).toContain(
      "Scenario B (Unlimited Allowance to Unknown Spender):",
    );
    expect(output).toContain("UNLIMITED_APPROVAL");
    expect(output).toContain("APPROVAL_NEW_SPENDER");
    expect(output).toContain("[SUCCESS] Policy evaluated cleanly offline!");
  });
});
