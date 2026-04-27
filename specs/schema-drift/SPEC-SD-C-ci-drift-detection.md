# SPEC SD-C — CI Schema Drift Detection (Stop the Bleeding)

**Date:** 2026-04-25 · **Owner:** Architecture (Matt) · **Executor:** Claude Code · **Effort:** 2–3 days · **Risk:** Low (read-only tooling; CI gate that can be `continue-on-error: true` initially)

**Depends on:** Nothing · **Blocks:** SD-A (one-shot reconciliation), SBA 30-min pack S1+ (which can't ship reliably until drift detection is in place)

---

## Background

On 2026-04-25, during pre-flight verification of the SBA 30-min pack S1 migration, the live `sba_policy_rules` table was found to be missing 4 columns (`category`, `borrower_friendly_explanation`, `fix_suggestions`, `effective_date`, `updated_at`) despite migration `20251227000010_fix_schema_mismatches.sql` being recorded as applied — the migration explicitly added all 5.

Investigation broadened. Migration `20251227000010` is recorded as applied but most of its work is missing from production:

| Migration object | In live DB? |
|---|---|
| `ai_event_citations` table (created in §2) | ✗ |
| `ai_events.model` column (added in §1) | ✗ |
| `bank_policy_chunks.source_label` (added in §3) | ✗ |
| `sba_policy_rules.category` etc. (added in §5) | ✗ |
| `deal_doc_chunks.source_label` (added in §4) | ✓ |

Same partial-application fingerprint on `20251227000012`, `20251227000013`, and (spot-checked) the much-later `20260513_watchlist_workout` migration. **The drift is recurring and systemic, not a one-time historical accident.** Every migration we ship is at risk of partial application, with no signal until something tries to query a non-existent object and 500s.

This spec adds CI tooling that detects drift before merge — a `pnpm gate:schema-drift` script that runs against a production-equivalent introspection, fails the build if any migration's expected DDL output is missing from live schema. Stops the bleeding while a separate spec (SD-A) handles the one-time historical reconciliation.

## Build principles captured

**#28 — Migration history is not truth; live schema is.** A row in `supabase_migrations.schema_migrations` only proves the runner attempted the migration, not that the DDL succeeded. Every PR that adds a migration must verify the DDL actually applied to a real database before declaring the migration done.

**#29 — Drift detection runs in CI, not after deploy.** Catching drift after deploy means production is already wrong. CI must catch it on the PR that introduces it.

**#30 — Drift detection is read-only.** The detector NEVER modifies the database. It introspects and reports. Remediation is always a separate, reviewed migration (SD-A pattern).

---

## Pre-implementation verification (PIV)

### PIV-1 — Confirm `supabase_migrations` schema
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='supabase_migrations' AND table_name='schema_migrations';
```
Expected: `version text, name text, statements text[]` (Supabase stores per-statement SQL as a Postgres array). The detector parses `statements` to extract DDL.

### PIV-2 — Confirm CI has Postgres connection capability
The current CI workflow `ci.yml` builds against placeholder env vars and never connects to a real DB. Drift detection requires a real read-only connection. Options:
- (A) Use a dedicated read-only role on production (lowest setup cost; highest blast radius if the role leaks)
- (B) Use a refreshed sandbox/staging that mirrors prod schema (cleaner, requires existing sandbox sync pipeline)
- (C) Use a Supabase branch DB created from prod (clean, but each PR provisioning a branch is slow and costs money)

**Recommend (A) with a strictly-scoped read-only role.** PIV-2 surfaces this trade-off; Matt picks before code begins.

### PIV-3 — Confirm `pnpm guard:all` runs already
The CI step "Architectural guards" runs `pnpm -s guard:all`. This is the natural home for `gate:schema-drift`. Confirm `package.json` has a `"guard:all"` script and what it composes of.

### PIV-4 — Confirm node Postgres client availability
`scripts/audit-db.ts` uses `@supabase/supabase-js` (REST). Drift detection needs richer introspection — easier with `pg` or `postgres` package directly. Check `package.json` for one of these. If neither, add `postgres` (zero-dep, fastest) as a dev dependency.

---

## What's in scope

### A. Drift detector script

#### A-1. `scripts/schema/drift-detect.ts`

Pure node script, ESM-compatible (matches `audit-db.ts` style). Reads the `supabase_migrations.schema_migrations` table and the live `information_schema`, produces a structured report. Exits non-zero if drift detected.

```ts
import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";

const conn = process.env.DRIFT_DETECT_DB_URL;
if (!conn) { console.error("DRIFT_DETECT_DB_URL not set"); process.exit(2); }

const sql = postgres(conn, { ssl: "require", prepare: false });

type ExpectedObject =
  | { kind: "table"; schema: string; name: string }
  | { kind: "column"; schema: string; table: string; name: string }
  | { kind: "index"; schema: string; name: string }
  | { kind: "function"; schema: string; name: string };

type DriftFinding = {
  migration_version: string;
  migration_name: string;
  object: ExpectedObject;
  status: "missing";
  source_statement: string; // first 240 chars of the statement that should have created it
};

async function main() {
  // 1. Pull migration history with full statements
  const migrations = await sql<Array<{ version: string; name: string; statements: string[] }>>`
    SELECT version, name, statements
    FROM supabase_migrations.schema_migrations
    ORDER BY version
  `;

  // 2. Pull live schema state
  const tables = new Set(
    (await sql`SELECT table_schema, table_name
               FROM information_schema.tables
               WHERE table_schema = 'public'`).map((r: any) => `${r.table_schema}.${r.table_name}`)
  );

  const columns = new Set(
    (await sql`SELECT table_schema, table_name, column_name
               FROM information_schema.columns
               WHERE table_schema = 'public'`).map((r: any) =>
                 `${r.table_schema}.${r.table_name}.${r.column_name}`)
  );

  const indexes = new Set(
    (await sql`SELECT schemaname, indexname FROM pg_indexes WHERE schemaname='public'`)
      .map((r: any) => `${r.schemaname}.${r.indexname}`)
  );

  const functions = new Set(
    (await sql`SELECT n.nspname, p.proname FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname='public'`).map((r: any) => `${r.nspname}.${r.proname}`)
  );

  // 3. For each migration, parse its statements to extract expected objects.
  // We use a deliberately conservative parser: regex matches against canonical
  // patterns. False negatives are acceptable (we'd miss a drift); false
  // positives are not (we'd block a PR for a phantom drift).
  const findings: DriftFinding[] = [];

  for (const m of migrations) {
    const expected = extractExpectedObjects(m.statements);
    for (const exp of expected) {
      const present = exp.kind === "table"
        ? tables.has(`${exp.schema}.${exp.name}`)
        : exp.kind === "column"
        ? columns.has(`${exp.schema}.${exp.table}.${exp.name}`)
        : exp.kind === "index"
        ? indexes.has(`${exp.schema}.${exp.name}`)
        : functions.has(`${exp.schema}.${exp.name}`);

      if (!present) {
        const sourceStatement = (m.statements.find(s =>
          statementMentionsObject(s, exp)
        ) ?? "").slice(0, 240);
        findings.push({
          migration_version: m.version,
          migration_name: m.name,
          object: exp,
          status: "missing",
          source_statement: sourceStatement,
        });
      }
    }
  }

  // 4. Allow-list known-acceptable drift via a JSON file.
  // Some drift is intentional (e.g., a later migration intentionally drops
  // a table created by an earlier one). The allow-list lets the team mark
  // those as acknowledged.
  const allowlist = loadAllowlist();
  const blocking = findings.filter(f => !isAllowed(f, allowlist));

  // 5. Write reports
  mkdirSync(".drift_report", { recursive: true });
  writeFileSync(".drift_report/all-findings.json", JSON.stringify(findings, null, 2));
  writeFileSync(".drift_report/blocking-findings.json", JSON.stringify(blocking, null, 2));

  // 6. Console summary
  console.log(`Drift findings: ${findings.length} total, ${blocking.length} blocking`);
  if (blocking.length > 0) {
    console.log("\nBlocking findings (first 20):");
    blocking.slice(0, 20).forEach(f => {
      const objDesc =
        f.object.kind === "column"
          ? `${f.object.schema}.${f.object.table}.${f.object.name}`
          : `${f.object.schema}.${(f.object as any).name}`;
      console.log(`  ${f.migration_version} (${f.migration_name}): missing ${f.object.kind} ${objDesc}`);
    });
    if (blocking.length > 20) console.log(`  ... and ${blocking.length - 20} more (see .drift_report/blocking-findings.json)`);
    process.exit(1);
  }

  console.log("✅ No blocking drift detected");
  await sql.end();
}

function extractExpectedObjects(statements: string[]): ExpectedObject[] {
  const out: ExpectedObject[] = [];
  for (const stmt of statements) {
    // CREATE TABLE [IF NOT EXISTS] [schema.]name (...)
    for (const m of stmt.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?(\w+)\s*\(/gi
    )) {
      out.push({ kind: "table", schema: m[1] ?? "public", name: m[2] });
    }
    // ALTER TABLE [schema.]name ADD COLUMN [IF NOT EXISTS] colname type, ...
    // We capture the table once, then extract every ADD COLUMN clause.
    const alterMatch = stmt.match(
      /alter\s+table\s+(?:(\w+)\.)?(\w+)\s+([\s\S]+)/i
    );
    if (alterMatch) {
      const schema = alterMatch[1] ?? "public";
      const table = alterMatch[2];
      for (const colM of alterMatch[3].matchAll(
        /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\b/gi
      )) {
        out.push({ kind: "column", schema, table, name: colM[1] });
      }
    }
    // CREATE [UNIQUE] INDEX [IF NOT EXISTS] idxname ON ...
    for (const m of stmt.matchAll(
      /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)\s+on\b/gi
    )) {
      out.push({ kind: "index", schema: "public", name: m[1] });
    }
    // CREATE [OR REPLACE] FUNCTION [schema.]name(...)
    for (const m of stmt.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:(\w+)\.)?(\w+)\s*\(/gi
    )) {
      out.push({ kind: "function", schema: m[1] ?? "public", name: m[2] });
    }
  }
  return out;
}

function statementMentionsObject(stmt: string, obj: ExpectedObject): boolean {
  if (obj.kind === "column") {
    return new RegExp(`\\b${obj.table}\\b[\\s\\S]*\\b${obj.name}\\b`, "i").test(stmt);
  }
  return new RegExp(`\\b${obj.name}\\b`, "i").test(stmt);
}

function loadAllowlist(): Array<{ migration_version: string; object: any; reason: string }> {
  try {
    const text = require("node:fs").readFileSync(".drift-allowlist.json", "utf8");
    return JSON.parse(text);
  } catch { return []; }
}

function isAllowed(f: DriftFinding, allowlist: ReturnType<typeof loadAllowlist>): boolean {
  return allowlist.some(a => {
    if (a.migration_version !== f.migration_version) return false;
    if (a.object.kind !== f.object.kind) return false;
    if (a.object.kind === "column") {
      return (a.object as any).table === (f.object as any).table
          && (a.object as any).name === (f.object as any).name;
    }
    return (a.object as any).name === (f.object as any).name;
  });
}

main().catch(err => { console.error(err); process.exit(2); });
```

**Parser scope note.** The regex parser intentionally covers only the four most common DDL patterns (`CREATE TABLE`, `ALTER TABLE ADD COLUMN`, `CREATE INDEX`, `CREATE FUNCTION`). It does NOT cover `CREATE TYPE`, `CREATE TRIGGER`, `CREATE VIEW`, `CREATE POLICY`. False negatives are acceptable; we explicitly add coverage in follow-ups when a real drift in those object kinds is observed. False positives are unacceptable (would block legitimate PRs).

#### A-2. `.drift-allowlist.json`

Empty array initially:
```json
[]
```

Schema (documented in `scripts/schema/README.md`):
```json
[
  {
    "migration_version": "20251227000010",
    "object": { "kind": "table", "schema": "public", "name": "ai_run_events" },
    "reason": "Intentionally dropped in same migration after rename — never expected to exist"
  }
]
```

The allow-list is the explicit acknowledgement surface. Every entry must include a `reason`. Reviewed in PR.

#### A-3. `scripts/schema/README.md`

Documents:
- What drift detection does and doesn't catch
- How to interpret `.drift_report/blocking-findings.json`
- How to add an allow-list entry (and when it's appropriate)
- How to run locally: `DRIFT_DETECT_DB_URL=postgres://... pnpm gate:schema-drift`
- Links to SD-A spec for historical reconciliation

### B. CI integration

#### B-1. `package.json` script

Add to `scripts`:
```json
"gate:schema-drift": "tsx scripts/schema/drift-detect.ts"
```

#### B-2. `.github/workflows/ci.yml` — new step

Insert after the existing "Schema select gate" step:

```yaml
- name: Schema drift detection
  if: env.DRIFT_DETECT_DB_URL != ''
  continue-on-error: true     # PHASE 1: report-only, do not block PRs
  run: pnpm -s gate:schema-drift
  env:
    DRIFT_DETECT_DB_URL: ${{ secrets.DRIFT_DETECT_DB_URL }}

- name: Upload drift report
  if: always() && env.DRIFT_DETECT_DB_URL != ''
  uses: actions/upload-artifact@v4
  with:
    name: drift-report
    path: .drift_report/
    if-no-files-found: warn
```

**Phase 1 (this spec):** `continue-on-error: true`. Drift findings get reported as a build artifact on every PR but don't block merge. This gives the team a chance to populate the allow-list with all current historical drift before flipping the gate to blocking.

**Phase 2 (separate PR after SD-A reconciliation merges):** flip to `continue-on-error: false`. Drift becomes blocking. This separation is deliberate — flipping to blocking before SD-A reconciliation lands would block every PR until cleanup is done.

#### B-3. GitHub repo secret

Add `DRIFT_DETECT_DB_URL` to repo secrets. Format: `postgres://drift_reader:<password>@<host>:5432/postgres?sslmode=require`. Pointed at the production DB with a strictly-scoped read-only role (next item).

### C. Read-only DB role

#### C-1. `supabase/migrations/<date>_drift_reader_role.sql`

```sql
BEGIN;

-- Read-only role used exclusively by CI drift detection.
-- Has SELECT on system catalogs (information_schema, pg_catalog, supabase_migrations)
-- but no access to any application data tables.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='drift_reader') THEN
    CREATE ROLE drift_reader WITH LOGIN PASSWORD 'CHANGE_ME_AT_PROVISION_TIME';
  END IF;
END $$;

-- Strict scope: only metadata + migration history. No public.* tables.
GRANT USAGE ON SCHEMA information_schema TO drift_reader;
GRANT USAGE ON SCHEMA pg_catalog TO drift_reader;
GRANT USAGE ON SCHEMA supabase_migrations TO drift_reader;
GRANT SELECT ON supabase_migrations.schema_migrations TO drift_reader;

-- information_schema and pg_catalog are SELECT-by-default for any role with USAGE.
-- Explicitly REVOKE everything else to make scope intent obvious.
REVOKE ALL ON SCHEMA public FROM drift_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM drift_reader;

-- Ensure future tables don't accidentally grant access.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM drift_reader;

COMMIT;
```

**At provision time (manual step, NOT in migration):**
1. Apply this migration via Supabase dashboard.
2. Connect as superuser, `ALTER ROLE drift_reader PASSWORD '<random-32-char>';`
3. Construct connection URL using the new password.
4. Add as `DRIFT_DETECT_DB_URL` GitHub secret.

The placeholder password in the migration is intentional — never commit a real password to git, even in a migration. The migration creates the role; password rotation is out-of-band.

#### C-2. `infrastructure/drift-detection/RUNBOOK.md`

Documents:
- How to provision/rotate `drift_reader` credentials
- How to connect manually for diagnostics
- Cost note: drift detection adds ~50–200 read-only queries to production per CI run; negligible load
- Privacy note: drift_reader can read `supabase_migrations.schema_migrations` which contains migration SQL. Migration SQL may include comments referencing internal architecture — review before granting CI logs to broader audiences
- How to disable in an emergency (set `DRIFT_DETECT_DB_URL=''` in repo secrets)

### D. First-run drift snapshot

After SD-C ships, the first CI run on `main` will produce `.drift_report/all-findings.json` documenting the current historical drift. That artifact is the input to SD-A.

This spec does NOT pre-compute the snapshot — the CI run produces it organically. SD-A's first step is "fetch the latest drift-report artifact from CI and use it as the reconciliation input."

---

## Tests required

| File | Coverage |
|---|---|
| `scripts/schema/__tests__/drift-detect.test.ts` | Unit tests for `extractExpectedObjects` parser: 8+ DDL pattern cases (basic CREATE TABLE, IF NOT EXISTS, schema-qualified, multi-column ALTER, OR REPLACE FUNCTION, CREATE UNIQUE INDEX, with comments before/after, with whitespace variations) |

The end-to-end drift-vs-database integration is hard to test without a real DB. Acceptable: parser tests + manual smoke test against staging before flipping `continue-on-error` to false.

---

## Verification (V-SDC)

**V-SDC-a — Parser correctness**
`pnpm test scripts/schema/__tests__/drift-detect.test.ts` — all cases pass.

**V-SDC-b — Local run against production**
With `DRIFT_DETECT_DB_URL` set locally:
```sh
pnpm gate:schema-drift
```
Output:
- Exits non-zero (because there IS drift today)
- `.drift_report/all-findings.json` lists the drift we already know about (`sba_policy_rules.category`, `committee_personas`, `deal_sba_difficulty_scores`, etc.)
- `.drift_report/blocking-findings.json` matches `all-findings.json` (allow-list empty)

**V-SDC-c — CI integration**
Open a no-op PR. CI run includes `Schema drift detection` step. Step runs (does not skip), reports findings, marks step as failed but does NOT block PR merge (because `continue-on-error: true`). `drift-report` artifact downloadable from PR's Actions tab.

**V-SDC-d — Allow-list works**
Add a single entry to `.drift-allowlist.json` for one of the known-drift items. Re-run `pnpm gate:schema-drift` locally. That item moves from `blocking-findings.json` to suppressed.

**V-SDC-e — Read-only role enforcement**
Connect as `drift_reader`. Run `SELECT * FROM public.deals LIMIT 1;` — must fail with `permission denied`. Run `SELECT count(*) FROM supabase_migrations.schema_migrations;` — must succeed.

**V-SDC-f — `tsc --noEmit` clean, `pnpm lint` clean**

**V-SDC-g — GitHub API verification post-merge**
Every spec'd file present on `main`.

---

## Non-goals

- Phase 2 (flipping the gate to blocking) — that's a separate PR after SD-A reconciliation lands
- Auto-remediation — drift detector is read-only by design
- Per-migration "this should have rolled back" detection — out of scope; we detect end-state drift, not transactional integrity of individual migration runs
- Detection for `CREATE TYPE`, `CREATE TRIGGER`, `CREATE VIEW`, `CREATE POLICY` — added in follow-ups when first observed drift in those object kinds occurs
- Investigating WHY drift happened historically (see "Open question" below) — that's diagnostic; SD-C is preventative

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | Parser produces false positives, blocks legitimate PRs | Medium | Phase 1 ships as `continue-on-error: true`; first 2 weeks identify false positives; refine parser before flipping to blocking |
| 2 | `drift_reader` credentials leak from CI logs | Low | Read-only on metadata only; cannot exfil application data. Worst case: leaks migration history (not user data). Rotate periodically |
| 3 | Production DB load from CI queries | Very low | ~5 SELECTs per run, all on metadata catalogs. Negligible |
| 4 | Allow-list grows unboundedly without remediation | Medium | Each entry requires a `reason`. Quarterly review: prune entries that should now be reconciled instead of allowed |
| 5 | Drift detection masks real bugs by being report-only | High initially | Acceptable for Phase 1. Phase 2 (blocking) is the long-term answer. SD-A clears the historical backlog so Phase 2 is enable-able |
| 6 | Migration history table grows; query slows | Low | Currently ~250 migrations. At 1000+ may want to cache or paginate |
| 7 | Connection requires `sslmode=require` and pooled vs direct connection nuances | Medium | Use the direct (non-pooled) connection string from Supabase dashboard. Documented in RUNBOOK |
| 8 | Pulse fastlane noise from new CI events | None — this is CI-side only, doesn't write to ledger | n/a |

---

## Open question (intentionally deferred)

**Why is drift happening?** The investigation surfaced that drift is recurring (Dec 2025 cluster + spot-checked May 2026 migration both partially applied). We don't yet know the mechanism. Three plausible causes:

1. Manual `supabase migration repair --status applied` runs after partial failures
2. Migrations applied to staging/sandbox first, history copied to prod via DB snapshot, prod DDL never replayed
3. Supabase CLI bug or version mismatch silently swallowing partial-apply errors

This spec doesn't investigate the mechanism — it builds a detector. **A follow-up spec (SD-B) should investigate the cause once SD-C is reporting and SD-A has reconciled history.** Without knowing the cause we can't be sure SD-A's reconciliation will hold.

For now: SD-C catches new drift before merge. SD-A clears backlog. SD-B (future) finds the leak in the deploy pipeline.

---

## Hand-off commit message

```
spec(schema-drift/sd-c): CI drift detection (Phase 1, report-only)

- scripts/schema/drift-detect.ts: read migration history + live schema,
  detect missing tables/columns/indexes/functions, exit non-zero on drift
- scripts/schema/__tests__/drift-detect.test.ts: 8+ parser cases
- .drift-allowlist.json: empty initial allow-list
- supabase/migrations/<date>_drift_reader_role.sql: read-only CI role
- .github/workflows/ci.yml: new "Schema drift detection" step
  (continue-on-error: true for Phase 1)
- infrastructure/drift-detection/RUNBOOK.md: provisioning + rotation
- package.json: pnpm gate:schema-drift script

Phase 1 is report-only by design. Phase 2 (blocking) ships after
SD-A reconciliation lands.

Verification: V-SDC-a through V-SDC-g
Spec: specs/schema-drift/SPEC-SD-C-ci-drift-detection.md
```

---

## Addendum for Claude Code

**Judgment boundaries:**

- PIV-2 (DB connection strategy): surface options, wait for Matt's pick. Do not provision the read-only role unilaterally — that's a production change requiring explicit approval
- Parser regex: cover the 4 patterns listed. Do NOT extend to TYPE/TRIGGER/VIEW/POLICY in this spec — keep scope tight. Coverage gaps are acceptable; false positives are not
- Allow-list: ship empty. Do NOT pre-populate with the known historical drift. Pre-populating would mask exactly the issues SD-A needs to reconcile. Phase 1's value is the FULL drift report on first run — that report becomes SD-A's input
- `continue-on-error: true` is non-negotiable for Phase 1. Even if Claude Code thinks blocking would be safe, surface and discuss before changing it. Flipping to blocking before SD-A would block every PR
- `drift_reader` role placeholder password: the migration ships with a literal `'CHANGE_ME_AT_PROVISION_TIME'` string. Do NOT replace with a "secure" placeholder or generate one in code. Password rotation is intentionally out-of-band so the real credential never lives in git
- If `pnpm gate:schema-drift` produces zero findings on first run, that's a yellow flag — historical drift is real and well-documented in the SD-C background. Surface; the parser is probably under-detecting
- Tests for `extractExpectedObjects` only. Do not write tests that require a live DB connection — those go in SD-A's verification protocol, not unit tests here

**Sequencing for the broader plan:**

1. SD-C ships (this spec) — CI starts reporting drift on every PR
2. Wait 1–2 weeks. Confirm CI's drift report is stable (same findings each run)
3. SD-A spec drafted using SD-C's report as input
4. SD-A reconciliation migration ships
5. Re-run CI; confirm drift findings drop to zero (or only contain intentional allow-list entries)
6. Separate PR flips `continue-on-error: false` — drift becomes blocking
7. (Future) SD-B investigates the deploy-pipeline mechanism

This spec is step 1. Don't try to compress steps 1–6 into one PR.
