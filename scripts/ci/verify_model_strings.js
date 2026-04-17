#!/usr/bin/env node
/**
 * CI Guard — Hardcoded Model String Detector (Phase 93)
 *
 * Fails with exit code 1 if any file outside the registry contains
 * hardcoded LLM model strings. This prevents the drift that caused
 * production failures when Google retired gemini-2.0-flash and the
 * gemini-2.5-pro-preview-03-25 alias.
 *
 * All AI model identifier strings must live in src/lib/ai/models.ts.
 *
 * Run: node scripts/ci/verify_model_strings.js
 */
const fs = require("fs");
const path = require("path");

// Patterns that indicate a hardcoded model string literal.
// Each must be anchored on quote boundaries so we don't match comments,
// prose, or URLs that incidentally contain the substring.
const BANNED_PATTERNS = [
  // Gemini variants (any version number pattern)
  /["'`]gemini-[\d.]+[a-z-]*["'`]/g,
  // OpenAI chat / realtime models — GPT-3.x / GPT-4.x families
  /["'`]gpt-[34][a-z0-9.-]*["'`]/g,
  // OpenAI reasoning models (o1, o2, o3 families)
  /["'`]o[123]-[a-z0-9-]+["'`]/g,
  // OpenAI embeddings
  /["'`]text-embedding-[a-z0-9-]+["'`]/g,
];

// Files allowed to contain model strings
const ALLOWED_FILES = new Set([
  "src/lib/ai/models.ts",               // THE registry
  "scripts/ci/verify_model_strings.js", // this file
  // Governance doc — separate concern, deliberately unchanged
  "src/lib/modelGovernance/modelRegistry.ts",
  // Skill documentation (non-executable)
  "src/agents/research/SKILL.md",
]);

const SCAN_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];
let violations = 0;

function scan(filePath) {
  const rel = path.relative(process.cwd(), filePath);
  if (ALLOWED_FILES.has(rel)) return;

  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // Skip single-line comments and JSDoc body lines
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

    for (const pattern of BANNED_PATTERNS) {
      pattern.lastIndex = 0;
      const m = pattern.exec(line);
      if (m) {
        console.error(`VIOLATION ${rel}:${idx + 1} — ${m[0]}`);
        console.error(`  → import from @/lib/ai/models instead`);
        violations++;
      }
    }
  });
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".next", ".git", "dist", "build"].includes(entry.name)) {
        walk(full);
      }
    } else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) {
      scan(full);
    }
  }
}

walk(path.join(process.cwd(), "src"));

if (violations) {
  console.error(
    `\n${violations} violation(s). All model strings must be in src/lib/ai/models.ts`,
  );
  process.exit(1);
}
console.log("✓ No hardcoded model strings outside registry.");
