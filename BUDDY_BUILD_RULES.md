# Buddy Build Rules

Architectural invariants enforced across all contributors (human and AI).

## Financial Computations

- **No inline math in templates or renderers.** All computed rows use `evaluateMetric()` from the metric registry or `evaluateStructuralExpr()`. No `eval()`, no raw arithmetic in template files.
- **No duplicate formulas.** The metric registry (`src/lib/metrics/registry.ts`) and Moody's formula registry (`src/lib/financialSpreads/moodys/formulas/registry.ts`) are the single sources of truth. Never redefine a formula that already exists in a registry.
- **Null propagation, not zero-fill.** If a metric input is missing, the output is `null`, not `0`. Downstream consumers handle nulls explicitly.

## Model Engine V2

- **All V2 model code is pure functions** — no database access, no UI, no lifecycle mutation, fully deterministic. DB I/O lives in thin service layers (`snapshotService.ts`, `metricRegistryLoader.ts`).
- **Feature flags gate all V2 code paths.** `isModelEngineV2Enabled()` must guard every V2 entry point. Production rendering stays on V1 until parity validation passes.
- **Shadow mode protocol**: V1 renders production output; V2 runs alongside and logs diffs via Aegis (`buddy_system_events`). Never swap renderers without a passing parity report.
- **Snapshot immutability.** `deal_model_snapshots` rows are INSERT-only. Never UPDATE or DELETE snapshots — they are audit trail.

## Database & Migrations

- **Migrations are additive only.** Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Never `ALTER TABLE ... DROP COLUMN` or `DROP TABLE` in migrations. Schema removals require a dedicated cleanup migration after confirming zero usage.
- **RLS on every table.** All new tables get `ENABLE ROW LEVEL SECURITY` with at minimum a `service_role` policy.
- **Sentinel values.** `1900-01-01` for unknown dates, `00000000-0000-0000-0000-000000000000` for unknown UUIDs. Filter these in queries that enumerate periods or entities.

## Import Patterns

- **`import type` for types, dynamic `import()` for heavy deps.** Keeps heavy packages (e.g., `@google-cloud/documentai`) out of webpack bundles. Types are compile-time only; runtime imports happen inside functions.
- **`"server-only"` guard.** Every file that touches Supabase admin, env secrets, or server APIs must start with `import "server-only"`.

## Fact Pipeline

- **Facts are the single data interchange format.** Documents produce facts via extractors. Spreads consume and produce facts via backfill. Snapshots read facts. Never bypass the fact layer.
- **Upsert key stability.** The composite key `(deal_id, bank_id, source_document_id, fact_type, fact_key, fact_period_start, fact_period_end, owner_type, owner_entity_id)` must remain stable. Changing any component creates duplicates.
- **Source types are enumerated.** `SPREAD | DOC_EXTRACT | MANUAL | STRUCTURAL` — do not add new source types without updating the `FinancialFactSourceType` union in `keys.ts`.

## Error Handling

- **Fire-and-forget for telemetry.** Shadow comparisons, Aegis events, and non-critical persistence use `void fn()` or `.catch(() => {})`. Never let telemetry failures block user-facing responses.
- **Non-fatal wrappers.** Snapshot builds, validation, and V2 model rendering are wrapped in try/catch. Failures log warnings but never block the V1 response.
