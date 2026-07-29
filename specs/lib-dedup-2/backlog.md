# SPEC-LIB-DEDUP-2 Backlog — pairs skipped by SPEC-SYSTEM-DEBLOAT-1 Phase D

Phase D's hard rule: *"If any pair's merge would change a computed financial
value or touch `src/lib/spreads/` vs `financialIntelligence/` boundary → skip
pair, log to SPEC-LIB-DEDUP-2 backlog."* Entries below were investigated,
found to trip that rule, and left untouched — no files moved, no guard entry
added, nothing retired.

---

## `entity` / `entities` — skipped 2026-07-29

**Why this isn't a mechanical dedup like the other Batch 1 pairs:**

1. **Real type-name collision, not a duplicate.** Both directories export a
   type literally named `DealEntity`, but they are **structurally different
   shapes**:
   - `src/lib/entity/buildDealEntityGraph.ts::DealEntity` — a graph-analysis
     shape: `{ entityId, role, entityType, taxFormSignatures, fingerprint }`
     (camelCase, no DB row fields).
   - `src/lib/entities/types.ts::DealEntity` — a raw DB-row shape:
     `{ id, deal_id, user_id, name, entity_kind, legal_name, ein,
     ownership_percent, notes, meta, created_at, updated_at }` (snake_case,
     mirrors the `deal_entity_relationships`/entity tables).

   These are two genuinely different concepts sharing a name by accident,
   not a stale-vs-canonical pair. Consolidating them under one export would
   force every call site to agree on one shape — silently breaking whichever
   half currently relies on the other's fields, or requiring far more than
   the "preserve export names, update imports" scope this phase allows.

   (`EntityKind` in both files *is* the identical literal union
   `"OPCO" | "PROPCO" | "HOLDCO" | "PERSON" | "GROUP"` — that one type alone
   would be safe to dedupe, but doing so in isolation while leaving
   `DealEntity` split doesn't meaningfully reduce the duplication this phase
   targets.)

2. **`entities/types.ts` is financial-computation-adjacent.** It also
   exports `CombinedSpread` and `EntityFinancialPeriod`. `CombinedSpread` is
   directly imported and used by `src/lib/finance/combined/aggregate.ts` —
   a financial-statement aggregation module. Any restructuring here risks
   touching computed financial values, which the hard rule explicitly
   forbids for this phase.

**Recommendation for a future SPEC-LIB-DEDUP-2 pass:** this needs a real
design decision (which `DealEntity` shape is canonical, or whether they
should be two distinctly-named types instead of a directory merge), plus a
review of every one of `entity/`'s and `entities/`'s ~7+ importers against
`src/lib/finance/combined/aggregate.ts` and the spreads/financialIntelligence
boundary before any file moves — not a mechanical import-count-wins call.
