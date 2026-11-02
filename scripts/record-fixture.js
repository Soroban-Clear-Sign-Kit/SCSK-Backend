#!/usr/bin/env node

/**
 * Script to record or re-record a fixture against Stellar Soroban Testnet
 * and output a git-style diff of changes.
 *
 * Usage:
 *   node scripts/record-fixture.js <fixture-name> [--dry-run]
 *
 * Example:
 *   node scripts/record-fixture.js sac_transfer
 *   node scripts/record-fixture.js sac_transfer --dry-run
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { rpc, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.resolve(__dirname, "../test/fixtures");

function printDiff(oldObj, newObj) {
  const oldLines = JSON.stringify(oldObj, null, 2).split("\n");
  const newLines = JSON.stringify(newObj, null, 2).split("\n");

  let hasDiff = false;
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o !== n) {
      hasDiff = true;
      if (o !== undefined) console.log(`- ${o}`);
      if (n !== undefined) console.log(`+ ${n}`);
    }
  }
  if (!hasDiff) {
    console.log(
      "No differences detected between recorded and simulated output.",
    );
  }
  return hasDiff;
}

async function main() {
  const args = process.argv.slice(2);
  const fixtureArg = args.find((a) => !a.startsWith("--"));
  const isDryRun = args.includes("--dry-run");

  if (!fixtureArg) {
    console.error(
      "Usage: node scripts/record-fixture.js <fixture_name> [--dry-run]",
    );
    process.exit(1);
  }

  const fixtureFileName = fixtureArg.endsWith(".json")
    ? fixtureArg
    : `${fixtureArg}.json`;
  const fixturePath = path.join(FIXTURES_DIR, fixtureFileName);

  if (!fs.existsSync(fixturePath)) {
    console.error(`Fixture not found: ${fixturePath}`);
    process.exit(1);
  }

  const existingContent = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  if (!existingContent.xdr) {
    console.error(
      `Fixture does not contain an "xdr" field: ${fixtureFileName}`,
    );
    process.exit(1);
  }

  const rpcUrl =
    process.env.STELLAR_RPC_URL ||
    existingContent.rpcUrl ||
    "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.STELLAR_NETWORK_PASSPHRASE ||
    existingContent.networkPassphrase ||
    Networks.TESTNET;

  console.log(`Connecting to RPC endpoint: ${rpcUrl}`);
  console.log(`Network passphrase: ${networkPassphrase}`);
  console.log(`Re-recording simulation for: ${fixtureFileName}`);

  const server = new rpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });

  try {
    const tx = TransactionBuilder.fromXDR(
      existingContent.xdr,
      networkPassphrase,
    );
    const simResponse = await server.simulateTransaction(tx);

    const updated = {
      ...existingContent,
      description:
        existingContent.description ||
        `Captured from Soroban Testnet (${rpcUrl})`,
      capturedAt: new Date().toISOString(),
      rpcUrl,
      networkPassphrase,
      sim: simResponse,
    };

    console.log("\n--- Diff Comparison ---");
    const changed = printDiff(existingContent, updated);
    console.log("------------------------\n");

    if (isDryRun) {
      console.log("Dry run: fixture was NOT modified on disk.");
    } else if (changed) {
      fs.writeFileSync(fixturePath, JSON.stringify(updated, null, 2) + "\n");
      console.log(`Successfully updated fixture file: ${fixturePath}`);
    } else {
      console.log(
        "Fixture is already identical to remote simulation response.",
      );
    }
  } catch (err) {
    console.error(`Failed to re-record simulation: ${err.message || err}`);
    process.exit(1);
  }
}

main();
