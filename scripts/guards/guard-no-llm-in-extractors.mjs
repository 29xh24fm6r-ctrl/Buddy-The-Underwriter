#!/usr/bin/env node
/**
 * Build-time guard: ensure deterministic extractors never import LLM SDK.
 *
 * Scans src/lib/financialSpreads/extractors/deterministic/ for:
 *   - imports of @anthropic-ai/sdk
 *   - references to callClaudeForExtraction
 *   - instantiation of new Anthropic()
 *
 * Exit 0 = clean, Exit 1 = violation found.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const TARGET_DIR = join(ROOT, "src/lib/financialSpreads/extractors/deterministic");

const BANNED_PATTERNS = [
  { pattern: /@anthropic-ai\/sdk/, label: "@anthropic-ai/sdk import" },
  { pattern: /callClaudeForExtraction/, label: "callClaudeForExtraction reference" },
  { pattern: /new\s+Anthropic\s*\(/, label: "new Anthropic() instantiation" },
  { pattern: /anthropic\.messages/, label: "anthropic.messages usage" },
  { pattern: /require\s*\(\s*["']@anthropic-ai/, label: "require(@anthropic-ai) import" },
];

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

let violations = 0;

try {
  const files = collectFiles(TARGET_DIR);

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const rel = relative(ROOT, file);

    for (const { pattern, label } of BANNED_PATTERNS) {
      if (pattern.test(content)) {
        console.error(`VIOLATION: ${rel} — ${label}`);
        violations++;
      }
    }
  }
} catch (err) {
  // If the directory doesn't exist, that's fine (no deterministic extractors yet)
  if (err.code === "ENOENT") {
    console.log("guard-no-llm-in-extractors: target directory not found, skipping.");
    process.exit(0);
  }
  throw err;
}

if (violations > 0) {
  console.error(`\n${violations} LLM import violation(s) found in deterministic extractors.`);
  process.exit(1);
} else {
  console.log("guard-no-llm-in-extractors: PASS (0 violations)");
  process.exit(0);
}
