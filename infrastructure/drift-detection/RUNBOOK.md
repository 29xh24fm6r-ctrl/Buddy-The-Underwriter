# Drift detection runbook

Operational guide for the SD-C CI schema drift detector.

- Detector: [scripts/schema/drift-detect.ts](../../scripts/schema/drift-detect.ts)
- Role migration: [supabase/migrations/20260427_drift_reader_role.sql](../../supabase/migrations/20260427_drift_reader_role.sql)
- Spec: [specs/schema-drift/SPEC-SD-C-ci-drift-detection.md](../../specs/schema-drift/SPEC-SD-C-ci-drift-detection.md)
- CI integration: `.github/workflows/ci.yml` → step `Schema drift detection`

---

## What runs in CI

On every PR and on every push to `main`:

1. The `Schema drift detection` step checks for the `DRIFT_DETECT_DB_URL`
   secret. If unset, the step is skipped (no-op, success).
2. If the secret is set, `pnpm gate:schema-drift` runs against the production
   DB as the `drift_reader` role. ~5 read-only queries against metadata
   catalogs (`information_schema`, `pg_indexes`, `pg_proc`,
   `supabase_migrations.schema_migrations`).
3. The detector writes `.drift_report/all-findings.json` and
   `.drift_report/blocking-findings.json`. Both are uploaded as the
   `drift-report` GitHub Actions artifact regardless of step outcome.
4. **Phase 1 (current):** the step is wrapped in `continue-on-error: true`,
   so a non-zero exit reports drift but does not block merge.
5. **Phase 2 (after SD-A reconciliation):** the `continue-on-error` flag is
   removed; drift becomes a blocking failure.

---

## Provisioning the `drift_reader` role

The migration creates the role with a literal placeholder password
(`'CHANGE_ME_AT_PROVISION_TIME'`). Provisioning is intentionally out-of-band
so a real password never lives in git.

### First-time setup

1. **Apply the migration.** Through the Supabase dashboard SQL editor (preferred)
   or `supabase db push`. After it applies, the role exists with the
   placeholder password.

2. **Set a real password.** Open the SQL editor as a superuser (the dashboard
   default service role) and run:

   ```sql
   ALTER ROLE drift_reader PASSWORD '<random-32-char-password>';
   ```

   Generate the password with a CSPRNG, e.g.:

   ```sh
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

   Do not write the password to a file or commit it. Paste it directly into
   the SQL editor and the GitHub secrets UI in step 4.

3. **Construct the connection URL.** Use the **direct (non-pooled)** connection
   host from the Supabase dashboard → Project Settings → Database → Connection
   string. The pooled connection (PgBouncer at port 6543) does not support all
   the introspection patterns the detector needs.

   ```
   postgres://drift_reader:<password>@<direct-host>:5432/postgres?sslmode=require
   ```

4. **Add the GitHub secret.** Repo Settings → Secrets and variables → Actions
   → New repository secret. Name: `DRIFT_DETECT_DB_URL`. Value: the
   connection string from step 3.

5. **Verify.** Re-run the latest CI workflow on `main` (or open a no-op PR).
   The `Schema drift detection` step should run and the `drift-report`
   artifact should be downloadable from the run page.

### Rotating the password

Same procedure as first-time setup, steps 2–4. Update the GitHub secret to
the new value. The next CI run picks it up automatically.

Recommended cadence: after any incident that could have leaked CI logs, after
any contractor offboarding with workflow access, and at least quarterly.

### Manual diagnostic connection

Connect as `drift_reader` from a local shell to confirm scope:

```sh
psql "postgres://drift_reader:<password>@<direct-host>:5432/postgres?sslmode=require"
```

Verification queries:

```sql
-- Should succeed.
SELECT count(*) FROM supabase_migrations.schema_migrations;
SELECT count(*) FROM information_schema.tables WHERE table_schema='public';
SELECT count(*) FROM pg_indexes WHERE schemaname='public';

-- Should fail with "permission denied for table deals".
SELECT * FROM public.deals LIMIT 1;
```

If the application-table SELECT succeeds, scope is broken — re-apply the
REVOKE clauses from the role migration.

---

## Emergency disable

If the drift detector is somehow blocking on-call work or producing noise:

1. **Fastest:** unset the GitHub secret. Repo Settings → Secrets and variables
   → Actions → `DRIFT_DETECT_DB_URL` → Update value to empty (or delete the
   secret entirely). The CI step's `if: env.DRIFT_DETECT_DB_URL != ''` guard
   skips the step on the next run.

2. **Slower but more visible:** comment the step out in
   `.github/workflows/ci.yml`, open a PR, merge. Prefer this when the issue
   needs broader awareness; prefer the secret-removal path when speed matters.

After the immediate issue is resolved, document what happened in a follow-up
issue and re-enable.

---

## Cost / load notes

- **Read-only queries per CI run:** ~5, against metadata catalogs only. No
  user data is read. Negligible load (<10ms aggregate query time on prod).
- **Frequency:** every PR + every push to `main`. ~50–200 runs/day at current
  team velocity.
- **Network egress:** trivial. Migration history is the largest payload
  (~250 rows × ~4KB SQL each = ~1MB) and is fetched once per run.

---

## Privacy / security notes

- `drift_reader` can read `supabase_migrations.schema_migrations`, which
  contains the full SQL text of every migration. Migration SQL may include
  inline comments referencing internal architecture or table relationships.
  Review CI log retention policy before granting log access to a wider
  audience than the engineering team.
- The role has **no access to application data** (`public.*` tables, RLS
  policies, etc.). A credential leak exposes migration SQL, not user data.
- The connection is `sslmode=require`. Postgres-side cert verification is the
  default; the `postgres` Node client honors SNI.

---

## Updating the detector

If the parser regex needs to be extended (e.g., to cover `CREATE TYPE`),
follow the spec's guidance:

> False negatives are acceptable; false positives are not.

A new pattern should ship with parser unit tests in
[scripts/schema/__tests__/drift-detect.test.ts](../../scripts/schema/__tests__/drift-detect.test.ts)
that demonstrate at least one positive case (correctly identified) and one
negative case (correctly ignored when the construct appears in a comment or
quoted string).

When in doubt, surface to spec author before extending — drift detection is
an "alarm system," and a false alarm has high cost (every PR blocked).
