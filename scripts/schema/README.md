# Schema gates

Two CI-time guards live here.

## `gate:schema-select` — column-name guard for Supabase `.from(...).select(...)` calls

`gate-select-columns.mjs`. Parses every SQL migration to build a
`{ table → Set(columns) }` map, then scans TypeScript for
`.from("TABLE").select("col,col2,...")` patterns and flags any selected column
that does not appear in the schema map. Catches the bug class where code
selects a non-existent column and PostgREST silently returns "no data" instead
of an error.

Run: `pnpm gate:schema-select`

## `gate:schema-drift` — live-DB drift vs. migration history

`drift-detect.ts`. Connects to a live Postgres (production, via the
`drift_reader` read-only role), pulls
`supabase_migrations.schema_migrations`, parses each migration's `statements[]`
to extract expected DDL outputs, and compares against
`information_schema` / `pg_indexes` / `pg_proc`. Reports anything migration
history claims to have created that does not exist in the live schema.

Run locally: `DRIFT_DETECT_DB_URL=postgres://drift_reader:...@host:5432/postgres?sslmode=require pnpm gate:schema-drift`

### What it catches

- Missing tables expected from `CREATE TABLE [IF NOT EXISTS] [schema.]name (...)`
- Missing columns expected from `ALTER TABLE [schema.]name ADD COLUMN [IF NOT EXISTS] colname ...`
- Missing indexes expected from `CREATE [UNIQUE] INDEX [IF NOT EXISTS] idxname ON ...`
- Missing functions expected from `CREATE [OR REPLACE] FUNCTION [schema.]name(...)`

### What it does NOT catch (yet)

- `CREATE TYPE`, `CREATE TRIGGER`, `CREATE VIEW`, `CREATE POLICY` — added in
  follow-ups when the first observed drift in those object kinds occurs
- Column type changes / `ALTER COLUMN ... TYPE` divergence
- Constraint drift (FK, CHECK, UNIQUE)
- Data-level drift (seeds that didn't insert)

False negatives in those areas are an accepted trade-off; false positives
(blocking a PR for a phantom drift) are unacceptable, so the parser is
conservative on purpose.

### Output

After every completed run:

- `.drift_report/all-findings.json` — every drift finding (including allow-listed)
- `.drift_report/blocking-findings.json` — findings not covered by `.drift-allowlist.json`
- `.drift_report/summary.json` — machine-readable mode, status, and counts

The default local mode exits `1` when blocking findings exist and `0`
otherwise. CI Phase 1 passes `--report-only`: confirmed drift emits an explicit
workflow warning and exits `0`, while detector/configuration failures still
exit `2` and fail CI. The artifact upload is mandatory and includes the hidden
`.drift_report` directory.

### Reading `blocking-findings.json`

Each entry has shape:

```json
{
  "migration_version": "20251227000010",
  "migration_name": "fix_schema_mismatches",
  "object": { "kind": "column", "schema": "public", "table": "sba_policy_rules", "name": "category" },
  "status": "missing",
  "source_statement": "ALTER TABLE public.sba_policy_rules ADD COLUMN IF NOT EXISTS category text, ..."
}
```

The `source_statement` (truncated to 240 chars) is the migration text that
should have created the object — useful when investigating whether the
migration was partially applied vs. a parser false positive.

### `.drift-allowlist.json`

Top-level array. Each entry acknowledges one expected-but-missing object as
intentional and prevents it from blocking. Schema:

```json
[
  {
    "migration_version": "20251227000010",
    "object": { "kind": "table", "name": "ai_run_events" },
    "reason": "Intentionally dropped in same migration after rename — never expected to exist"
  }
]
```

`reason` is required and reviewed in PR. The allow-list is the explicit
acknowledgement surface — every entry should link back to either a spec or
the intentional decision that justifies the deviation.

Add entries sparingly. The allow-list is a failure surface for SD-A's
reconciliation: anything that should exist gets reconciled, not allow-listed.
Allow-listing is for objects that genuinely should NOT exist in live schema
even though a migration appears to create them (typically: dropped later in
the same or a subsequent migration).

### Phase 1 vs. Phase 2

This is **Phase 1**: CI invokes the detector with `--report-only`. Confirmed
drift is an explicit warning and does not block merge, but connection,
configuration, detector, and missing-report failures do block CI. The
downloadable artifact is the authoritative input to SD-A (one-shot historical
reconciliation).

**Phase 2** removes `--report-only` after the reconciliation migration lands
and the report drops to zero blocking findings. From that point on, drift is a
blocking CI failure.

See [specs/schema-drift/SPEC-SD-C-ci-drift-detection.md](../../specs/schema-drift/SPEC-SD-C-ci-drift-detection.md)
and [specs/schema-drift/SPEC-SD-A-reconciliation.md](../../specs/schema-drift/SPEC-SD-A-reconciliation.md).

### Operational

`drift_reader` role provisioning, password rotation, emergency disable:
[infrastructure/drift-detection/RUNBOOK.md](../../infrastructure/drift-detection/RUNBOOK.md).
