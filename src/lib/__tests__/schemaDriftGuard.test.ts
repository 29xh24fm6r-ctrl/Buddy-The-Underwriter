/**
 * SPEC-BUDDY-HARD-STOP-AUDIT-AND-RECOVERY-1 — Hard stop #5: schema drift.
 *
 * Source-level guard that scans the codebase for `.insert(` / `.update(`
 * calls against four critical tables and fails CI when any of the known
 * column-drift tokens appear adjacent to those calls.
 *
 * Authoritative column lists are verified against production Supabase
 * via MCP on 2026-05-27 (see HARD_STOPS_AUDIT.md). These tables back
 * banker-visible audit trails — a silent insert failure here means a
 * recorded event never lands and downstream consumers see nothing.
 *
 * Banned tokens by table:
 *   deal_events       — event_type, event_data, metadata, description, actor_id, bank_id
 *                       (canonical columns are: id, deal_id, kind, payload, created_at)
 *   deal_documents    — file_name (canonical is `original_filename`)
 *
 * Scope: scan src/** but allow the canonical helper writeEvent.ts and this
 * guard file itself (which legitimately mention the banned strings).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = walk(ROOT);

const ALLOWLIST = new Set<string>([
  // Canonical write helper — knows the schema and uses payload correctly.
  resolve(ROOT, "lib/ledger/writeEvent.ts"),
  // This guard test itself mentions the banned tokens by design.
  resolve(ROOT, "lib/__tests__/schemaDriftGuard.test.ts"),
]);

const CANDIDATES = ALL_FILES.filter((f) => !ALLOWLIST.has(f));

// Index per-file: which tables are referenced via `.from("<table>")`?
type Index = Record<string, Map<string, string>>;

function buildIndex(): Index {
  const out: Index = { deal_events: new Map(), deal_documents: new Map() };
  for (const file of CANDIDATES) {
    const src = readFileSync(file, "utf8");
    if (/\bfrom\(\s*["']deal_events["']\s*\)/.test(src)) {
      out.deal_events.set(file, src);
    }
    if (/\bfrom\(\s*["']deal_documents["']\s*\)/.test(src)) {
      out.deal_documents.set(file, src);
    }
  }
  return out;
}

const INDEX = buildIndex();

/**
 * Locate every `.from("<table>").insert(...)` / `.update(...)` call and
 * report banned tokens that appear as a TOP-LEVEL key of the inserted /
 * updated object literal. Keys nested inside `payload: { ... }` (or any
 * other nested object) are allowed — those are payload contents, not
 * column names.
 *
 * Algorithm: when a line contains `from("<table>")`, walk forward
 * tracking brace depth. The first `{` after `.insert(` / `.update(`
 * opens depth=1 (column-key scope). Any `{` inside opens depth>=2
 * (payload scope). Banned tokens are flagged only at depth==1.
 */
/**
 * Locate every `.from("<table>").insert(...)` / `.update(...)` call and
 * report banned tokens that appear as a TOP-LEVEL key of the inserted /
 * updated object literal. Keys nested inside `payload: { ... }` (or any
 * other nested object) are allowed — those are payload contents, not
 * column names.
 *
 * Algorithm: scan character-by-character starting at the `.insert(` /
 * `.update(` open paren. Track brace depth; the first `{` opens depth=1
 * (column-key scope). Any inner `{` opens depth>=2 (payload scope).
 * For each banned-token match we check the depth AT the match position
 * — not at the end of the containing line — so single-line payload
 * literals like `payload: { actor_id: userId }` are handled correctly.
 */
function findDriftHits(
  fileToSrc: Map<string, string>,
  bannedTokenSource: string,
  fromTable: string,
): string[] {
  const hits: string[] = [];
  // Build a banned matcher that catches `<token>:` followed by anything
  // other than `:` (avoids matching ternary-style usage).
  const banned = new RegExp(`\\b${bannedTokenSource}\\s*:(?!:)`);

  for (const [file, src] of fileToSrc) {
    // For every from("<table>") occurrence, find the next .insert( / .update( /
    // .upsert( and scan its object literal.
    const fromNeedle = `from("${fromTable}")`;
    let searchFrom = 0;
    while (true) {
      const fromIdx = src.indexOf(fromNeedle, searchFrom);
      if (fromIdx === -1) break;

      // Find the start of the next insert/update/upsert call body.
      const callRegex = /\.(insert|update|upsert)\s*\(\s*\[?\s*\{/g;
      callRegex.lastIndex = fromIdx;
      const callMatch = callRegex.exec(src);
      if (!callMatch) {
        searchFrom = fromIdx + fromNeedle.length;
        continue;
      }

      // callMatch.index points at the `.` of `.insert(`.
      // Walk to the first `{` after that — that opens depth=1.
      let pos = callMatch.index + callMatch[0].length - 1; // index of the opening `{`
      let depth = 0;
      let depthMap: number[] = []; // depth at each position from pos onward

      // Track depth char-by-char until the matching `}` returns us to 0.
      let cursor = pos;
      const out: { pos: number; depth: number }[] = [];
      depth = 1; // we are already at the opening brace
      depthMap[cursor] = depth;
      cursor++;
      while (cursor < src.length && depth > 0) {
        const ch = src[cursor];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        depthMap[cursor] = depth;
        out.push({ pos: cursor, depth });
        cursor++;
      }

      // Now search for the banned token within [pos, cursor]; for each
      // hit, look up the depth at that position. Flag only depth==1.
      const window = src.slice(pos, cursor);
      const bannedAll = new RegExp(banned, "g");
      let m: RegExpExecArray | null;
      while ((m = bannedAll.exec(window)) !== null) {
        const absIdx = pos + m.index;
        const d = depthMap[absIdx] ?? -1;
        if (d === 1) {
          // Compute line number for diagnostic.
          const lineNum = src.slice(0, absIdx).split("\n").length;
          hits.push(
            `${file}:${lineNum} — banned token at top-level key of .from("${fromTable}").insert/update`,
          );
        }
      }

      searchFrom = cursor;
    }
  }
  return hits;
}

test("[schema-drift-1] deal_events writes must use `kind`, never `event_type`", () => {
  const hits = findDriftHits(INDEX.deal_events, "event_type", "deal_events");
  assert.deepEqual(
    hits,
    [],
    `Found banned event_type usage near deal_events writes:\n${hits.join("\n")}`,
  );
});

test("[schema-drift-2] deal_events writes must use `payload`, never `event_data`", () => {
  const hits = findDriftHits(INDEX.deal_events, "event_data", "deal_events");
  assert.deepEqual(
    hits,
    [],
    `Found banned event_data usage near deal_events writes:\n${hits.join("\n")}`,
  );
});

test("[schema-drift-3] deal_events writes must use `payload`, never `metadata`", () => {
  const hits = findDriftHits(INDEX.deal_events, "metadata", "deal_events");
  assert.deepEqual(
    hits,
    [],
    `Found banned metadata usage near deal_events writes — fold into payload instead:\n${hits.join("\n")}`,
  );
});

test("[schema-drift-4] deal_events writes must NOT name a `description` column", () => {
  const hits = findDriftHits(INDEX.deal_events, "description", "deal_events");
  assert.deepEqual(
    hits,
    [],
    `Found banned description column near deal_events writes — fold into payload.description instead:\n${hits.join("\n")}`,
  );
});

test("[schema-drift-5] deal_events writes must NOT name an `actor_id` column", () => {
  const hits = findDriftHits(INDEX.deal_events, "actor_id", "deal_events");
  assert.deepEqual(
    hits,
    [],
    `Found banned actor_id column near deal_events writes — fold into payload.actor_id instead:\n${hits.join("\n")}`,
  );
});

test("[schema-drift-6] deal_events writes must NOT name a `bank_id` column", () => {
  const hits = findDriftHits(INDEX.deal_events, "bank_id", "deal_events");
  assert.deepEqual(
    hits,
    [],
    `Found banned bank_id column near deal_events writes — deal_events has no bank_id; fold into payload.bank_id instead:\n${hits.join("\n")}`,
  );
});

test("[schema-drift-7] deal_documents writes must use `original_filename`, never `file_name`", () => {
  const hits = findDriftHits(INDEX.deal_documents, "file_name", "deal_documents");
  assert.deepEqual(
    hits,
    [],
    `Found banned file_name column near deal_documents writes:\n${hits.join("\n")}`,
  );
});

test("[schema-drift-8] deal_events canonical schema is documented in writeEvent.ts", () => {
  const src = readFileSync(resolve(ROOT, "lib/ledger/writeEvent.ts"), "utf8");
  assert.match(
    src,
    /deal_events.*payload/,
    "writeEvent.ts must document the canonical (deal_id, kind, payload) shape",
  );
});
