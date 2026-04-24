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

// ─── Brokerage prereq: OpenAI import governance ──────────────────────────
// After the concierge Gemini migration, no NEW file should import OPENAI_*
// constants from @/lib/ai/models or call getOpenAI(). Legacy callers are
// explicitly listed here. If you're adding a new entry, that's a signal the
// migration spec needs updating — don't silently add to the allowlist.
const OPENAI_CONSTANT_ALLOWLIST = new Set([
  "src/lib/ai/models.ts",
  "src/lib/ai/openaiClient.ts",
  "src/lib/ai/provider.ts",
  "src/lib/ai/llmRouter.ts",
  "src/lib/ai/orchestrator.ts",
  "src/ai/orchestrator/run.ts",
  "src/lib/sba/committee.ts",
  "src/lib/sba/committeeGodMode.ts",
  "src/lib/gatekeeper/classifyWithOpenAI.ts",
  "src/lib/interview/suggestFacts.ts",
  "src/lib/interview/qa.ts",
  "src/lib/retrieval/retrieve.ts",
  "src/lib/retrieval/retrievalCore.ts",
  "src/lib/retrieval/embeddings.ts",
  "src/lib/__tests__/modelGovernanceAndPlaybooks.test.ts",
  "src/app/voice/page.tsx",
  "src/app/api/deals/[dealId]/committee/route.ts",
  "src/app/api/deals/[dealId]/voice/token/route.ts",
  "src/app/api/deals/[dealId]/ask/route.ts",
  "src/app/api/deals/[dealId]/memo/generate/route.ts",
  "src/app/api/deals/[dealId]/memo/section/route.ts",
  "src/app/api/deals/[dealId]/risk/explain/route.ts",
  "src/app/api/deals/[dealId]/documents/auto-request/route.ts",
]);

// Paths where `getOpenAI` is forbidden entirely — new surfaces built on
// Gemini-native contracts. Regex match against repo-relative path.
const GET_OPENAI_BANNED_PATHS = [
  /^src\/app\/api\/brokerage\//,
  /^src\/app\/api\/borrower\/concierge\//,
  /^src\/lib\/brokerage\//,
];

const OPENAI_CONSTANT_IMPORT_RE =
  /import\s*\{[^}]*\bOPENAI_[A-Z_]+\b[^}]*\}\s*from\s*["']@\/lib\/ai\/models["']/;
const GET_OPENAI_IMPORT_RE =
  /import\s*\{[^}]*\bgetOpenAI\b[^}]*\}\s*from\s*["'][^"']+["']/;

const SCAN_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];
let violations = 0;

function scan(filePath) {
  const rel = path.relative(process.cwd(), filePath);
  const relPosix = rel.split(path.sep).join("/");
  const raw = fs.readFileSync(filePath, "utf-8");

  if (!ALLOWED_FILES.has(rel) && !ALLOWED_FILES.has(relPosix)) {
    const lines = raw.split("\n");
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      // Skip single-line comments and JSDoc body lines
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

      for (const pattern of BANNED_PATTERNS) {
        pattern.lastIndex = 0;
        const m = pattern.exec(line);
        if (m) {
          console.error(`VIOLATION ${relPosix}:${idx + 1} — ${m[0]}`);
          console.error(`  → import from @/lib/ai/models instead`);
          violations++;
        }
      }
    });
  }

  // Brokerage prereq rule 1 — OPENAI_* constant imports outside allowlist.
  if (
    !OPENAI_CONSTANT_ALLOWLIST.has(relPosix) &&
    OPENAI_CONSTANT_IMPORT_RE.test(raw)
  ) {
    const m = raw.match(OPENAI_CONSTANT_IMPORT_RE);
    const lineNo = raw.slice(0, m.index ?? 0).split("\n").length;
    console.error(
      `VIOLATION ${relPosix}:${lineNo} — OPENAI_* import from @/lib/ai/models`,
    );
    console.error(
      `  → concierge/brokerage are Gemini-native; see specs/brokerage/prereq-concierge-gemini-migration.md`,
    );
    violations++;
  }

  // Brokerage prereq rule 2 — getOpenAI import in banned paths.
  const inBannedPath = GET_OPENAI_BANNED_PATHS.some((re) => re.test(relPosix));
  if (inBannedPath && GET_OPENAI_IMPORT_RE.test(raw)) {
    const m = raw.match(GET_OPENAI_IMPORT_RE);
    const lineNo = raw.slice(0, m.index ?? 0).split("\n").length;
    console.error(
      `VIOLATION ${relPosix}:${lineNo} — getOpenAI is forbidden in this path`,
    );
    console.error(
      `  → use callGeminiJSON from @/lib/ai/geminiClient`,
    );
    violations++;
  }
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
