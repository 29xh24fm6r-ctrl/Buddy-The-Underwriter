#!/usr/bin/env node
// scripts/guards/guard-ai-gateway-only.mjs
// SPEC-M1 AI-GATEWAY-1 — no LLM provider traffic outside the gateway.
//
// Scans src/ (excluding __tests__ dirs) for direct references to any of
// the three gateway-vendor SDKs/endpoints (Google/Gemini, Anthropic,
// OpenAI) OUTSIDE src/lib/ai/providers/, the gateway's own adapter layer.
// A hit outside providers/ PASSES only if the file is on the allowlist
// (pre-gateway legacy call sites, tracked as SPEC-M1.1 migration debt).
// The allowlist is remove-only — a stale entry (a path that no longer
// matches) also FAILS, so it can only shrink as M1.1 migrates callers,
// same contract as scripts/guards/guard-deal-route-access.mjs.
//
// This is a literal text/regex scan, not an AST check (same convention as
// guard-no-llm-in-extractors.mjs) — it can't distinguish a real API call
// from a doc-comment mentioning the same URL/import string. That's fine:
// both land on the allowlist as legacy debt either way, and a false
// "violation" costs nothing beyond one allowlist line.
//
// Env overrides (used by this guard's own fixture tests):
//   AI_GATEWAY_GUARD_BASE        repo root for relative-path identity (cwd)
//   AI_GATEWAY_GUARD_ROOT        directory to scan
//   AI_GATEWAY_GUARD_ALLOWLIST   allowlist file path

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AI_GATEWAY_GUARD_BASE || process.cwd();
const SCAN_ROOT = process.env.AI_GATEWAY_GUARD_ROOT || path.join(BASE, "src");
const ALLOWLIST_PATH =
  process.env.AI_GATEWAY_GUARD_ALLOWLIST ||
  path.join(BASE, "scripts/guards/ai-gateway-only-allowlist.txt");

// The one directory allowed to talk to a provider endpoint/SDK directly.
const ALLOWED_DIR = path.join(BASE, "src", "lib", "ai", "providers");

const BANNED_PATTERNS = [
  { pattern: /generativelanguage\.googleapis\.com/, label: "direct Gemini REST endpoint" },
  { pattern: /@google\/genai/, label: "@google/genai SDK import" },
  { pattern: /@google-cloud\/vertexai/, label: "@google-cloud/vertexai SDK import" },
  { pattern: /api\.anthropic\.com/, label: "direct Anthropic REST endpoint" },
  { pattern: /@anthropic-ai\/sdk/, label: "@anthropic-ai/sdk import" },
  { pattern: /api\.openai\.com/, label: "direct OpenAI REST endpoint" },
  { pattern: /from\s+["']openai["']/, label: 'openai SDK import (from "openai")' },
];

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function relId(absFile) {
  return path.relative(BASE, absFile).split(path.sep).join("/");
}

function isAllowedLocation(absFile) {
  return path.dirname(absFile) === ALLOWED_DIR;
}

function failsBaseCheck(content) {
  return BANNED_PATTERNS.some(({ pattern }) => pattern.test(content));
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return [];
  return fs
    .readFileSync(ALLOWLIST_PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function main() {
  const files = walkFiles(SCAN_ROOT);
  const failing = new Set();

  for (const abs of files) {
    if (isAllowedLocation(abs)) continue;
    const content = fs.readFileSync(abs, "utf8");
    if (failsBaseCheck(content)) failing.add(relId(abs));
  }

  const allowlist = readAllowlist();
  const allowSet = new Set(allowlist);

  // Unpatched: fails the base check AND not allowlisted.
  const unpatched = [...failing].filter((f) => !allowSet.has(f)).sort();

  // Stale: on the allowlist but no longer failing (migrated or removed).
  const stale = allowlist.filter((f) => !failing.has(f)).sort();

  if (unpatched.length === 0 && stale.length === 0) {
    console.log(
      `✅ ai-gateway-only guard passed (${files.length} files scanned; ` +
        `${failing.size} on the SPEC-M1.1 migration allowlist).`,
    );
    return;
  }

  if (unpatched.length) {
    console.error(
      "\n❌ file(s) reference an LLM provider endpoint/SDK directly outside " +
        "src/lib/ai/providers/, and are not on the allowlist:\n",
    );
    for (const f of unpatched) console.error(` - ${f}`);
    console.error(
      "\nFix: route the call through src/lib/ai/gateway.ts's runRole()/" +
        "runRoleStream(), or add the path to " +
        "scripts/guards/ai-gateway-only-allowlist.txt as tracked SPEC-M1.1 debt.\n",
    );
  }

  if (stale.length) {
    console.error(
      "\n❌ stale allowlist entries (no longer match — remove them, " +
        "the allowlist is remove-only):\n",
    );
    for (const f of stale) console.error(` - ${f}`);
    console.error("");
  }

  process.exit(1);
}

main();
