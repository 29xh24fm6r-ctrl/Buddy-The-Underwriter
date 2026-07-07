// scripts/guards/guard-rpc-existence.mjs
// SPEC-PORTAL-1 §4a — RPC existence guard.
//
// Every `supabase.rpc("name", …)` in the client/server code must name a Postgres
// function that is actually authored in supabase/migrations/*.sql (a CREATE
// FUNCTION statement). The borrower portal broke because PortalClient called four
// RPCs that were never live in prod; a build-time check against the migration
// ledger would have caught that at PR time.
//
// This is a check against AUTHORED MIGRATIONS, not against prod. Prod drift
// (migration marked applied but function absent) is a separate operational
// concern — but authoring an .rpc() call with no migration behind it is a code
// bug this guard forbids.
//
// PASS if the rpc name is defined by a CREATE FUNCTION in any migration OR is on
// the allowlist (Postgres/Supabase built-ins, functions authored outside the
// migrations tree). Allowlist is remove-only.
//
// Env overrides (fixture tests): RPC_GUARD_MIGRATIONS_DIR, RPC_GUARD_SRC_DIR,
// RPC_GUARD_ALLOWLIST.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = process.env.RPC_GUARD_MIGRATIONS_DIR || path.join(ROOT, "supabase/migrations");
const SRC_DIR = process.env.RPC_GUARD_SRC_DIR || path.join(ROOT, "src");
const ALLOWLIST_PATH = process.env.RPC_GUARD_ALLOWLIST || path.join(ROOT, "scripts/guards/rpc-existence-allowlist.txt");

function walk(dir, test, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, test, out);
    else if (entry.isFile() && test(entry.name)) out.push(full);
  }
  return out;
}

// Names defined by a CREATE [OR REPLACE] FUNCTION [schema.]name( in any migration.
function migrationDefinedNames() {
  const names = new Set();
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  for (const file of walk(MIGRATIONS_DIR, (n) => n.endsWith(".sql"))) {
    const sql = fs.readFileSync(file, "utf8");
    let m;
    while ((m = re.exec(sql)) !== null) names.add(m[1]);
  }
  return names;
}

// Every rpc("name" / rpc('name' call site in src.
function rpcCallSites() {
  const sites = [];
  const re = /\.rpc\(\s*(["'])([a-zA-Z0-9_]+)\1/g;
  for (const file of walk(SRC_DIR, (n) => /\.(ts|tsx)$/.test(n))) {
    // Test files reference rpc names in assertions/comments/fixtures — they are
    // not runtime call-sites, so exclude them.
    if (/__tests__|\.test\.tsx?$/.test(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split("\n").length;
      sites.push({ file: path.relative(ROOT, file), line, name: m[2] });
    }
  }
  return sites;
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return new Set();
  return new Set(
    fs.readFileSync(ALLOWLIST_PATH, "utf8")
      .split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
}

function main() {
  const defined = migrationDefinedNames();
  const allow = readAllowlist();
  const sites = rpcCallSites();

  const offenders = sites.filter((s) => !defined.has(s.name) && !allow.has(s.name));

  if (offenders.length === 0) {
    const distinct = new Set(sites.map((s) => s.name)).size;
    console.log(
      `✅ rpc-existence guard passed (${distinct} distinct .rpc() names; ` +
        `${defined.size} migration-defined, ${allow.size} allowlisted).`,
    );
    return;
  }

  console.error(
    "\n❌ .rpc() call(s) name a function with no CREATE FUNCTION in supabase/migrations " +
      "and not on the allowlist (SPEC-PORTAL-1 §4a):\n",
  );
  for (const o of offenders) console.error(` - ${o.file}:${o.line}  →  ${o.name}`);
  console.error(
    "\nFix: add the migration that defines the function, repoint the client to an " +
      "existing surface, or — for a Postgres/Supabase built-in or externally-authored " +
      "function — add the name to scripts/guards/rpc-existence-allowlist.txt.\n",
  );
  process.exit(1);
}

main();
