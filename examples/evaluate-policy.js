import { evaluatePolicy, BUILTIN_RULES, I128_MAX } from "@clearsign/core";

console.log("=== ClearSign Core: Offline Policy Evaluation Example ===\n");

// Scenario A: Safe token transfer invocation
const safeTransferInvocation = {
  contractId: "CABCGFWV66KHO5SLOEMOAE6YT2DEWEZL65ZX34DP3Q3556UYA3EKKTYF",
  functionName: "transfer",
  args: [
    {
      name: "from",
      value: {
        kind: "address",
        value: "GCFBY2QJS33QF6SD44QKHYKCDRCVKEGWNAUOCBC5CRAT6UFRNHOPK34B",
      },
    },
    {
      name: "to",
      value: {
        kind: "address",
        value: "GDSIQKUJFBOV4XW6SSBYIPT5QUKVPBY4KHLNL3AS3CJIK7BRHZFUSQK2",
      },
    },
    {
      name: "amount",
      value: {
        kind: "int",
        value: "10000000",
      },
    },
  ],
  specSource: "sac",
};

const safeWarnings = evaluatePolicy({ invocation: safeTransferInvocation });
console.log("Scenario A (Standard Transfer):");
console.log(`- Warnings count: ${safeWarnings.length}`);
if (safeWarnings.length === 0) {
  console.log("  [APPROVED] No policy violations detected.");
}

// Scenario B: High-risk unlimited allowance approval to an unknown spender
const riskyApprovalInvocation = {
  contractId: "CABCGFWV66KHO5SLOEMOAE6YT2DEWEZL65ZX34DP3Q3556UYA3EKKTYF",
  functionName: "approve",
  args: [
    {
      name: "from",
      value: {
        kind: "address",
        value: "GCFBY2QJS33QF6SD44QKHYKCDRCVKEGWNAUOCBC5CRAT6UFRNHOPK34B",
      },
    },
    {
      name: "spender",
      value: {
        kind: "address",
        value: "GDSIQKUJFBOV4XW6SSBYIPT5QUKVPBY4KHLNL3AS3CJIK7BRHZFUSQK2",
      },
    },
    {
      name: "amount",
      value: {
        kind: "int",
        value: I128_MAX.toString(),
      },
    },
  ],
  specSource: "sac",
};

const riskyWarnings = evaluatePolicy({
  invocation: riskyApprovalInvocation,
  knownSpenders: ["GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7JMTXNZBEW6KXFL"],
});

console.log("\nScenario B (Unlimited Allowance to Unknown Spender):");
console.log(`- Warnings count: ${riskyWarnings.length}`);
for (const [idx, w] of riskyWarnings.entries()) {
  console.log(
    `  [${idx + 1}] [${w.severity.toUpperCase()}] ${w.code}: ${w.message}`,
  );
}

console.log("\n[SUCCESS] Policy evaluated cleanly offline!");
