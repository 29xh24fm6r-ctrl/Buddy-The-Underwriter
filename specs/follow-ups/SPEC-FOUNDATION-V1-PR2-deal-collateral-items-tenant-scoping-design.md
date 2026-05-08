# SPEC-FOUNDATION-V1 PR2 follow-up — `deal_collateral_items` tenant scoping design question

Surfaced during SPEC-FOUNDATION-V1 PR2 (PR #406, 2026-05-08). The PR2 spec assumed `deal_collateral_items` had a `bank_id` column for multi-tenant isolation; PIV-5 found it does not. Every other deal-scoped table in the schema (`deal_borrower_story`, `deal_management_profiles`, `deal_memo_overrides`, `deal_financial_facts`, `deal_spreads`) carries `bank_id`. The omission on `deal_collateral_items` could be intentional or accidental. This spec frames the design question for a deliberate decision before remediating the broken filter in `loadCollateralItems`.

## Detected
SPEC-FOUNDATION-V1 PR2 PIV-5 (2026-05-08). Companion to `SPEC-FOUNDATION-V1-PR2-load-collateral-items-bank-id-filter-bug.md`.

## The architectural question
Buddy is a regulated multi-tenant SaaS. Tenant isolation is a foundational constraint per the OCC SR 11-7 / GLBA boundary. For row-level data, the platform pattern is `(deal_id, bank_id)` composite scoping — even though `deals.bank_id` already establishes the deal's tenant, child tables redundantly carry `bank_id` so RLS policies and direct queries can enforce isolation without joining.

`deal_collateral_items` breaks this pattern. The table has only `deal_id`. Reasoning could be:

1. **Intentional — collateral is property of the deal, not the bank.** Collateral facts persist across any hypothetical deal transfer. The `deal_id` scope is sufficient because `deals.bank_id` is the source of truth.
2. **Accidental omission.** The original schema author forgot the column. The presence of `bank_id` filtering logic in `loadCollateralItems` (even if non-functional) suggests someone *expected* the column to exist, supporting this hypothesis.
3. **Migration artifact.** An earlier version had `bank_id` and it was dropped, or it was planned and never added.

## Why it matters
Three downstream concerns ride on this question:

- **RLS policies.** If `bank_id` should exist, RLS policies on `deal_collateral_items` are currently weaker than peer tables — they can only enforce isolation via a join to `deals`, which is more expensive and easier to mis-configure.
- **Direct queries from worker processes.** Any background worker that queries `deal_collateral_items` without joining `deals` has no tenant boundary. The fact that we haven't hit a cross-tenant leak is a function of access patterns, not enforcement.
- **The "deal transfer" hypothetical.** Does Buddy ever migrate a deal from Bank A to Bank B (e.g., participation, sale, broker re-routing)? If yes, `deal_collateral_items.bank_id` would need to be denormalized or recomputed on transfer. If no, `deal_id` scoping is sufficient.

## Investigation needed
1. Schema archaeology — search migration history (`supabase/migrations/`) for any reference to `deal_collateral_items.bank_id`. Was it ever there? Was it planned and never landed?
2. Audit all consumers of `deal_collateral_items` — workers, RLS policies, direct queries, joins. Document the actual tenant-isolation surface area.
3. Compare to peer tables: do `deal_borrower_story`, `deal_management_profiles`, etc. enforce `bank_id` redundancy via RLS, or is it advisory? If RLS only checks `deal_id` → `deals.bank_id` joins, then `deal_collateral_items`'s schema is consistent and the PR2 spec was wrong, not the table.
4. Confirm with founder: is Buddy's data model designed around deal transfer between banks? (My suspicion: no, deals belong to one bank, but worth confirming.)

## Resolution paths
**Path A — keep schema as-is, remove the broken filter.** If investigation concludes `deal_id` scoping is sufficient and consistent with platform patterns, fix the immediate bug (`SPEC-FOUNDATION-V1-PR2-load-collateral-items-bank-id-filter-bug.md`) by removing the no-op filter. Document `deal_collateral_items` as `deal_id`-scoped intentionally.

**Path B — add `bank_id`, backfill, enforce.** If investigation concludes the table SHOULD have `bank_id` for parity with peers, file a schema migration:
```sql
ALTER TABLE deal_collateral_items 
  ADD COLUMN bank_id UUID REFERENCES banks(id);
UPDATE deal_collateral_items dci
  SET bank_id = d.bank_id
  FROM deals d
  WHERE dci.deal_id = d.id;
ALTER TABLE deal_collateral_items 
  ALTER COLUMN bank_id SET NOT NULL;
```
Then update `loadCollateralItems` to actually filter by `r.bank_id === bankId` and update RLS policies to use the column directly.

**Path C — defer entirely.** If the platform is moving toward a different tenant-isolation pattern (e.g., schema-per-tenant, RLS-only with no redundant columns), this question becomes moot and the broken filter is removed as part of that broader cleanup.

## Recommendation
Path A is the conservative call until/unless the investigation surfaces evidence that the omission was unintentional. The cost of Path A is a one-line code change; the cost of Path B is a migration + RLS update + potential downtime; the cost of Path C is a multi-week architectural shift. Path A unblocks immediate PR2 follow-up work (the broken-filter fix) without committing to a schema change that may not be needed.

## Impact
None until the broken-filter follow-up is resolved. This spec is the prerequisite design decision for that follow-up. It does NOT block PR2 itself — PR2's fallback in `factsAdapter.ts` doesn't depend on the resolution of this question.

## Related
- SPEC-FOUNDATION-V1 PR2 (PR #406, 2026-05-08)
- `SPEC-FOUNDATION-V1-PR2-load-collateral-items-bank-id-filter-bug.md` (companion remediation, blocked on this design decision)
- Build principle: Buddy is always treated as a regulated multi-tenant SaaS. Tenant isolation is a foundational constraint, not an implementation detail.
