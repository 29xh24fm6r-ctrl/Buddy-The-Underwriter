import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const BORROWER_COMPONENT_DIR = path.resolve(__dirname, "..");
const BORROWER_APP_DIR = path.resolve(__dirname, "../../../app/(borrower)");

const PULSE_IMPORT_PATTERNS = [
  /from\s+["'].*pulse/i,
  /from\s+["'].*pulseMcp/i,
  /import.*PulseMaster/i,
  /emitPipelineEvent/,
  /forwardLedger/,
  /observer_query/,
  /state_inspect/,
  /buddy_ledger_write/,
];

function collectTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectTsFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

describe("C-6 Pulse boundary — borrower surface must not import Pulse internals", () => {
  const files = [
    ...collectTsFiles(BORROWER_COMPONENT_DIR),
    ...collectTsFiles(BORROWER_APP_DIR),
  ];

  it("found borrower files to check", () => {
    assert.ok(files.length > 10, `expected >10 borrower files, got ${files.length}`);
  });

  it("no borrower file imports Pulse modules or calls Pulse tools", () => {
    const violations: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      for (const pattern of PULSE_IMPORT_PATTERNS) {
        if (pattern.test(content)) {
          const rel = path.relative(process.cwd(), file);
          violations.push(`${rel} matches ${pattern}`);
        }
      }
    }
    assert.equal(
      violations.length,
      0,
      `Pulse boundary violated:\n${violations.join("\n")}`,
    );
  });
});
