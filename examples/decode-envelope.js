import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvelope, decodeInvocation } from "@clearsign/core";
import { Networks } from "@stellar/stellar-sdk";

// Resolve path to the offline fixture
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  __dirname,
  "../test/fixtures/sac_transfer.json",
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

console.log("=== ClearSign Core: Offline Envelope Decoding Example ===\n");

// 1. Parse the transaction envelope without network calls
const parseResult = parseEnvelope(fixture.xdr, Networks.TESTNET);

if (!parseResult.success) {
  console.error("Failed to parse envelope:", parseResult.error);
  process.exit(1);
}

const { envelope, innerTransaction } = parseResult;
console.log("Transaction Details:");
console.log(`- Source Account : ${envelope.source}`);
console.log(`- Sequence Number: ${envelope.sequence}`);
console.log(`- Fee (stroops)  : ${envelope.fee}`);
console.log(`- Operations     : ${envelope.operations.length}`);

// 2. Decode the first contract invocation operation offline
const firstOp = innerTransaction.operations[0];
if (firstOp) {
  const decoded = await decodeInvocation(firstOp, {
    networkPassphrase: Networks.TESTNET,
  });

  console.log("\nDecoded Host Function Invocation:");
  console.log(
    `- Contract ID  : ${decoded.invocation.contractId || "(native/SAC)"}`,
  );
  console.log(`- Function Name: ${decoded.invocation.functionName}`);
  console.log(`- Arguments (${decoded.invocation.args.length}):`);

  for (const [idx, arg] of decoded.invocation.args.entries()) {
    console.log(
      `  [${idx}] ${arg.name ?? "arg"}: ${JSON.stringify(arg.value)}`,
    );
  }
}

console.log("\n[SUCCESS] Envelope decoded cleanly offline!");
