import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const SECURITY_MODEL_PATH = path.join(ROOT_DIR, "SECURITY-MODEL.md");
const TEST_DIR = path.join(ROOT_DIR, "test");

function main() {
  if (!fs.existsSync(SECURITY_MODEL_PATH)) {
    console.error(
      `ERROR: Security model file not found at ${SECURITY_MODEL_PATH}`,
    );
    process.exit(1);
  }

  const secModelContent = fs.readFileSync(SECURITY_MODEL_PATH, "utf8");

  // Extract claim IDs from SECURITY-MODEL.md. Claim IDs format: SM-[0-9]{2}
  // We match headings or table rows like `### SM-01:` or `| SM-01 |` or `**SM-01**`
  const claimRegex = /\b(SM-\d{2})\b/g;
  const docClaims = new Set();
  let match;
  while ((match = claimRegex.exec(secModelContent)) !== null) {
    docClaims.add(match[1]);
  }

  if (docClaims.size === 0) {
    console.error(
      "ERROR: No claim IDs (e.g. SM-01, SM-02) found in SECURITY-MODEL.md",
    );
    process.exit(1);
  }

  console.log(
    `Found ${docClaims.size} security claims in SECURITY-MODEL.md: ${Array.from(docClaims).sort().join(", ")}`,
  );

  // Scan all test files for SM tags
  const testFiles = [];
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts"))
      ) {
        testFiles.push(fullPath);
      }
    }
  }
  walkDir(TEST_DIR);

  const testClaims = new Map(); // claimId -> Set of test file paths
  const unknownClaimsInTests = new Map(); // claimId -> Set of test file paths

  for (const testFile of testFiles) {
    const content = fs.readFileSync(testFile, "utf8");
    const relativePath = path.relative(ROOT_DIR, testFile).replace(/\\/g, "/");
    let testMatch;
    const testFileRegex = /\b(SM-\d{2})\b/g;
    while ((testMatch = testFileRegex.exec(content)) !== null) {
      const claimId = testMatch[1];
      if (docClaims.has(claimId)) {
        if (!testClaims.has(claimId)) {
          testClaims.set(claimId, new Set());
        }
        testClaims.get(claimId).add(relativePath);
      } else {
        if (!unknownClaimsInTests.has(claimId)) {
          unknownClaimsInTests.set(claimId, new Set());
        }
        unknownClaimsInTests.get(claimId).add(relativePath);
      }
    }
  }

  let hasError = false;

  // 1. Check if any test cites an unknown claim ID
  if (unknownClaimsInTests.size > 0) {
    hasError = true;
    console.error(
      "\n❌ ERROR: Tests cite unknown claim IDs not defined in SECURITY-MODEL.md:",
    );
    for (const [claimId, files] of unknownClaimsInTests.entries()) {
      console.error(`  - ${claimId} cited in: ${Array.from(files).join(", ")}`);
    }
  }

  // 2. Check if every claim in SECURITY-MODEL.md is backed by at least one test
  const missingClaims = [];
  for (const claimId of Array.from(docClaims).sort()) {
    if (!testClaims.has(claimId) || testClaims.get(claimId).size === 0) {
      missingClaims.push(claimId);
    }
  }

  if (missingClaims.length > 0) {
    hasError = true;
    console.error(
      "\n❌ ERROR: Security claims in SECURITY-MODEL.md missing backing tests:",
    );
    for (const claimId of missingClaims) {
      console.error(`  - ${claimId}`);
    }
  }

  if (hasError) {
    console.error("\nSecurity model check failed. Please fix the gaps above.");
    process.exit(1);
  }

  console.log(
    "\n✅ All security claims are backed by tests and no unknown claim IDs were cited:",
  );
  for (const claimId of Array.from(docClaims).sort()) {
    console.log(
      `  - ${claimId}: backed by ${testClaims.get(claimId).size} test file(s) (${Array.from(testClaims.get(claimId)).join(", ")})`,
    );
  }
}

main();
