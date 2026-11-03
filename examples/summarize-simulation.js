import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeSimulation, decodeEvent } from "@clearsign/core";

// Resolve path to the offline fixture containing simulated response
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  __dirname,
  "../test/fixtures/sac_transfer.json",
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

console.log("=== ClearSign Core: Offline Simulation Summary Example ===\n");

// 1. Summarize simulation payload without network calls
const summary = summarizeSimulation(fixture.sim);

console.log("Simulation Summary:");
console.log(`- Status       : ${summary.status}`);
console.log(`- Risk Level   : ${summary.risk}`);
console.log(`- Events Count : ${summary.events.length}`);
console.log(`- State Changes: ${summary.stateChanges.length}`);

if (summary.resourceUsage) {
  console.log(`- CPU (inst)   : ${summary.resourceUsage.cpuInstructions}`);
  console.log(`- Memory (B)   : ${summary.resourceUsage.memoryBytes}`);
  console.log(`- Min Fee      : ${summary.resourceUsage.minResourceFee}`);
}

// 2. Decode the first simulation event offline
if (summary.events.length > 0) {
  const firstEvent = summary.events[0];
  const decodedEv = await decodeEvent(firstEvent, { rpcUrl: "" });

  console.log("\nDecoded Event:");
  console.log(`- Type        : ${decodedEv.type ?? "contract"}`);
  console.log(`- In Call OK  : ${decodedEv.inSuccessfulContractCall}`);
  console.log(`- Topics Count: ${decodedEv.topics.length}`);
  if (decodedEv.value) {
    console.log(`- Value       : ${JSON.stringify(decodedEv.value)}`);
  }
}

console.log("\n[SUCCESS] Simulation summarized cleanly offline!");
