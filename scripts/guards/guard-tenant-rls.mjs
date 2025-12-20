import fs from "node:fs";
import path from "node:path";

function fail(msg) {
  console.error(`TENANT_RLS_GUARD_FAIL: ${msg}`);
  process.exit(1);
}

function readAllSqlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readAllSqlFiles(p));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".sql")) out.push(p);
  }
  return out;
}

function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, " ");
}

function existsDir(d) {
  try {
    return fs.existsSync(d) && fs.statSync(d).isDirectory();
  } catch {
    return false;
  }
}

function pickMigrationsDir(repoRoot) {
  const candidates = [
    path.join(repoRoot, "supabase", "migrations"),
    path.join(repoRoot, "migrations")
  ];
  const found = candidates.find(existsDir);
  if (!found) {
    fail(`No migrations directory found. Tried: ${candidates.join(", ")}`);
  }
  return found;
}

const repoRoot = process.cwd();
const configPath = path.join(repoRoot, "scripts", "guards", "tenant-rls-required.json");

if (!fs.existsSync(configPath)) {
  fail(`Missing config: ${configPath}`);
}

const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));

const requiredTables = cfg.required_tables;
if (!Array.isArray(requiredTables) || requiredTables.length === 0) {
  fail("Config required_tables is empty or invalid.");
}

const membershipTable = String(cfg.membership_table || "bank_memberships").toLowerCase();

const migrationsDir = pickMigrationsDir(repoRoot);
const sqlFiles = readAllSqlFiles(migrationsDir);
if (sqlFiles.length === 0) {
  fail(`No .sql migration files found under: ${migrationsDir}`);
}

const corpus = normalize(sqlFiles.map((p) => fs.readFileSync(p, "utf8")).join("\n\n"));

const missing = [];

for (const table of requiredTables) {
  const t = String(table).toLowerCase();

  // 1) Must add/define bank_id
  const hasBankId =
    corpus.includes(`alter table public.${t} add column if not exists bank_id`) ||
    corpus.includes(`alter table ${t} add column if not exists bank_id`) ||
    (corpus.includes(`create table if not exists public.${t}`) && corpus.includes(` bank_id uuid`)) ||
    (corpus.includes(`create table public.${t}`) && corpus.includes(` bank_id uuid`));

  if (!hasBankId) missing.push(`${table}: missing bank_id add/definition in migrations`);

  // 2) Must enable RLS
  const hasRls =
    corpus.includes(`alter table public.${t} enable row level security`) ||
    corpus.includes(`alter table ${t} enable row level security`);

  if (!hasRls) missing.push(`${table}: missing enable row level security`);

  // 3) Must create at least one policy on the table
  const hasPolicy =
    corpus.includes(`create policy`) &&
    (corpus.includes(` on public.${t} `) || corpus.includes(` on ${t} `));

  if (!hasPolicy) missing.push(`${table}: missing create policy on table`);

  // 4) Best-effort check: membership gate referenced somewhere (global)
  const hasMembershipRef =
    corpus.includes(`from public.${membershipTable} m`) ||
    corpus.includes(`from public.${membershipTable}`) ||
    corpus.includes(`from ${membershipTable} m`) ||
    corpus.includes(`from ${membershipTable}`);

  if (!hasMembershipRef) missing.push(`${table}: missing reference to membership table (${cfg.membership_table})`);
}

if (missing.length) {
  fail(
    `One or more tenant tables are not canonically isolated.\n` +
      missing.map((m) => `- ${m}`).join("\n") +
      `\n\nFix: Add bank_id + backfill + NOT NULL + enable RLS + policies.\nSee docs/engineering/TENANT_RLS_TEMPLATE.md`
  );
}

console.log("TENANT_RLS_GUARD_OK");
