// SPEC-13.5 PR-C C-4 — guard tests for the
// scripts/check-no-legacy-overrides-writes.sh CI guard.
//
// Operates on a temp directory rather than the real src/ tree so
// synthetic positive/negative cases can be exercised without polluting
// the codebase. Each test creates an isolated temp dir, writes files,
// invokes the script with the temp dir as $1, and asserts the exit
// code + output.
//
// IMPORTANT: this test file is intentionally placed at scripts/__tests__/
// rather than src/lib/__tests__/ because the artifact under test is a
// shell script, not a TS module. The pnpm test:unit find pattern was
// extended in PR-B to include src/app, but does NOT include scripts/.
// Running this test in CI either requires a separate find entry or a
// dedicated step. For now, run via:
//   node --import tsx --test scripts/__tests__/check-no-legacy-overrides-writes.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const SCRIPT = path.join(
  process.cwd(),
  "scripts/check-no-legacy-overrides-writes.sh",
);

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spec135-guard-"));
}

function writeFile(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function runGuard(dir: string): { exitCode: number; output: string } {
  try {
    const out = execFileSync("bash", [SCRIPT, dir], { encoding: "utf-8" });
    return { exitCode: 0, output: out };
  } catch (e: any) {
    return {
      exitCode: typeof e.status === "number" ? e.status : -1,
      output: (e.stdout ?? "") + (e.stderr ?? ""),
    };
  }
}

// ── Reads (.select) — must be allowed ─────────────────────────────────

test("[guard-1] empty scan dir exits 0", () => {
  const dir = makeTempDir();
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 0);
});

test("[guard-2] .select(...) exits 0 (read allowed)", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/test.ts",
    `const x = sb.from("deal_memo_overrides").select("overrides").maybeSingle();\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 0);
});

test("[guard-3] multi-line read with .eq + .select stays allowed", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/test.ts",
    `const x = await sb\n  .from("deal_memo_overrides")\n  .select("overrides")\n  .eq("deal_id", id)\n  .maybeSingle();\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 0);
});

// ── Writes (.insert / .update / .upsert / .delete) — must fail ────────

test("[guard-4] .insert(...) exits 1", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/test.ts",
    `await sb.from("deal_memo_overrides").insert({ deal_id, overrides: {} });\n`,
  );
  const { exitCode, output } = runGuard(dir);
  assert.equal(exitCode, 1);
  assert.match(output, /destructive write/);
  assert.match(output, /test\.ts/);
});

test("[guard-5] .update(...) exits 1", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/test.ts",
    `await sb.from("deal_memo_overrides").update({ overrides: m }).eq("id", x);\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 1);
});

test("[guard-6] .upsert(...) exits 1", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/test.ts",
    `await sb.from("deal_memo_overrides").upsert({ deal_id, overrides });\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 1);
});

test("[guard-7] .delete(...) exits 1", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/test.ts",
    `await sb.from("deal_memo_overrides").delete().eq("deal_id", x);\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 1);
});

test("[guard-8] multi-line chain (.from then .eq then .delete on next line) exits 1", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/test.ts",
    `await sb\n  .from("deal_memo_overrides")\n  .eq("deal_id", x)\n  .delete();\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 1);
});

test("[guard-9] mixed file (one read + one write) exits 1", () => {
  // Even when reads coexist with writes in the same file, the write must
  // surface. Otherwise a writer could hide behind a sibling reader.
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/test.ts",
    `sb.from("deal_memo_overrides").select("overrides");\nsb.from("deal_memo_overrides").insert({ x: 1 });\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 1);
});

// ── Test-file exclusion ───────────────────────────────────────────────

test("[guard-10] file under __tests__ is excluded", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/foo/__tests__/bar.test.ts",
    `sb.from("deal_memo_overrides").insert({});\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 0);
});

test("[guard-11] *.test.ts file at any path is excluded", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/foo/bar.test.ts",
    `sb.from("deal_memo_overrides").insert({});\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 0);
});

test("[guard-12] file under __invariants__ is excluded", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/foo/__invariants__/inv.ts",
    `sb.from("deal_memo_overrides").insert({});\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 0);
});

// ── Allowlist ─────────────────────────────────────────────────────────

test("[guard-13] allowlisted builderCanonicalWrite.ts can write — exits 0", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/lib/builder/builderCanonicalWrite.ts",
    `await sb.from("deal_memo_overrides").update({ overrides });\n`,
  );
  const { exitCode, output } = runGuard(dir);
  assert.equal(exitCode, 0);
  assert.match(output, /allowlisted/);
});

test("[guard-14] allowlisted memo-overrides cockpit endpoint can write — exits 0", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/app/api/deals/[dealId]/memo-overrides/route.ts",
    `await sb.from("deal_memo_overrides").upsert({ deal_id });\n`,
  );
  const { exitCode, output } = runGuard(dir);
  assert.equal(exitCode, 0);
  assert.match(output, /allowlisted/);
});

test("[guard-15] allowlisted borrower/update endpoint can write — exits 0", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/app/api/deals/[dealId]/borrower/update/route.ts",
    `await sb.from("deal_memo_overrides").upsert({ deal_id });\n`,
  );
  const { exitCode, output } = runGuard(dir);
  assert.equal(exitCode, 0);
  assert.match(output, /allowlisted/);
});

test("[guard-16] file with allowlist-suffix path elsewhere does NOT match", () => {
  // Suffix matching: ensure a path like "src/lib/foo/builder/builderCanonicalWrite.ts"
  // does NOT inherit the allowlist for "src/lib/builder/builderCanonicalWrite.ts".
  // The match anchors on the leading separator, not on substring.
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/lib/foo/builder/builderCanonicalWrite.ts",
    `await sb.from("deal_memo_overrides").insert({});\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 1);
});

test("[guard-17] non-allowlisted file with all four destructive methods all fail", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/foo/insertCase.ts",
    `await sb.from("deal_memo_overrides").insert({});\n`,
  );
  writeFile(
    dir,
    "src/foo/updateCase.ts",
    `await sb.from("deal_memo_overrides").update({});\n`,
  );
  writeFile(
    dir,
    "src/foo/upsertCase.ts",
    `await sb.from("deal_memo_overrides").upsert({});\n`,
  );
  writeFile(
    dir,
    "src/foo/deleteCase.ts",
    `await sb.from("deal_memo_overrides").delete();\n`,
  );
  const { exitCode, output } = runGuard(dir);
  assert.equal(exitCode, 1);
  // Each file should appear in the violations.
  assert.match(output, /insertCase\.ts/);
  assert.match(output, /updateCase\.ts/);
  assert.match(output, /upsertCase\.ts/);
  assert.match(output, /deleteCase\.ts/);
});

// ── Single-quote variant ──────────────────────────────────────────────

test("[guard-18] single-quoted from('deal_memo_overrides') matches too", () => {
  const dir = makeTempDir();
  writeFile(
    dir,
    "src/test.ts",
    `await sb.from('deal_memo_overrides').insert({ x: 1 });\n`,
  );
  const { exitCode } = runGuard(dir);
  assert.equal(exitCode, 1);
});
