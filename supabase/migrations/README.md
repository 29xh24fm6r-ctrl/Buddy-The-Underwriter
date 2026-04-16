# Supabase Migrations — Read Before Running db push

## TL;DR

**Do NOT run `supabase db push` or `supabase db push --include-all` without reading this.**
**All new migrations must use MCP `apply_migration` only.**

---

## Migration History State (as of April 2026)

### Before 2026-03-25 — Clean
All local `.sql` files and remote `schema_migrations` are in sync.
Local version IDs match remote recorded versions exactly.

### From 2026-03-25 onwards — Diverged (intentionally)
Two workflows ran in parallel:

**Workflow A (local files):**
Files like `20260326_auto_intelligence_pipeline.sql` have version prefix `20260326`.

**Workflow B (MCP apply_migration):**
Same DDL applied via MCP generated versions like `20260326153556`, `20260326160928`.
These are recorded in `schema_migrations`. The local file versions are NOT recorded.

**Result:** ~150 local files from 2026-03-25 onwards have version IDs that do NOT
appear in `schema_migrations`. The DDL they represent IS live in production.
Running `db push` would attempt to re-apply them and fail.

---

## Safe Operations

| Operation | Safe? | Notes |
|-----------|-------|-------|
| `supabase migration list` | ✅ | Shows the drift. Expected. |
| `apply_migration` via MCP | ✅ | Correct workflow going forward. |
| `supabase db push --dry-run` | ⚠️ | Review output carefully before acting. |
| `supabase db push` | ❌ | Will attempt to re-apply already-applied DDL. |
| `supabase db push --include-all` | ❌ | Same — will fail on conflicts. |

---

## Workflow Going Forward

**All new schema changes must use MCP `apply_migration` only.**

```
# Correct — use this
apply_migration(name: "my_feature", query: "ALTER TABLE ...")

# Wrong — do not use this
supabase db push
```

New `.sql` files in `supabase/migrations/` are source code documentation only.
They are NOT applied via `db push`. The MCP tool is the only application path.

---

## If You Need to Repair the History Table

Do NOT attempt this without a full diff review. The repair command is:
```
supabase migration repair --status applied <version>
```
Run it once per unrecorded local file version to mark it as applied without re-running DDL.
Only do this after confirming the DDL is already live in production.

---

## Seed Files

`seed_policy_defaults.sql`, `seed_policy_mitigants.sql`, `seed_policy_rules.sql` have no
timestamp prefix and are not tracked by `schema_migrations`. This is intentional.
They are reference seeds, not migration files.
