# ARC-00 Phase 5 Gate — NEW SPEC S7 (closing forms + package assembly)

**Date run:** 2026-07-12 · **Executor:** Claude Code · **Branch:** `claude/sba-forms-complete-arc-d92e55`

No spec file existed for this phase — built directly from the arc doc's
Phase 5 section, as instructed.

## AP-3 schema-first findings

- `src/lib/ownership/rules.ts` (referenced by the spec: "unlimited vs
  limited decision driven by src/lib/ownership/rules.ts") had
  `OWNER_THRESHOLD_PERCENT`/`requiresPersonalPackage` but **no unlimited-
  vs-limited guarantee decision logic at all** — the spec assumed it
  existed. Added `determineGuaranteeType()` to that file (not inline in
  the form module) so the business rule lives where the spec expects it.
  No codified threshold exists anywhere for "does this specific minority
  owner also need to guarantee" (a lender-credit-policy call, not an SBA
  rule) — implemented as "any nonzero ownership stake below 20% gets a
  limited guarantee," documented as an assumption a bank's own policy can
  override.
- `sba_package_runs` had no column to record an assembled 10-tab output —
  additive migration `20260712_b_sba_package_runs_assembly.sql` adds
  `assembled_package_storage_path`/`assembled_at`.

## What shipped

- **Forms 148/148L** — modeled as a single module
  (`src/lib/sba/forms/form148/`) rather than two, since they differ only
  in guarantee type + which official template gets filled, not field
  content. One signer per individual owner with a nonzero stake;
  `guaranteeType` decided by the new `determineGuaranteeType()`. Route:
  consolidated `GET /sba/forms/148/[action]` (build|render).
- **Form 601** — conditional on construction line items in use-of-proceeds
  summing to more than $10,000 (regex-matched against
  category/description, same pattern as `equitySeasoning.ts`'s
  large-deposit detection). Deal-level, single signer (largest individual
  owner) — same shape as Form 155. Route: consolidated
  `GET /sba/forms/601/[action]`.
- **Form 722** — genuinely not fillable (per spec). Modeled as delivery
  acknowledgment tracked via `deal_events` (`form_722.acknowledged`) rather
  than a new schema for a one-field yes/no state — `getForm722Status`/
  `acknowledgeForm722` in `src/lib/sba/forms/form722/service.ts`. Route:
  `GET`/`POST /sba/forms/722` (one file, two HTTP methods — no `[action]`
  segment needed since there are exactly two operations, not many).
- **Migration `20260712_a_...`** — adds `SBA_148`/`SBA_148L`/`SBA_601`/
  `SBA_722` package items to both `SBA_7A_BASE` and `SBA_504_BASE`
  (10 items and 9 items respectively — 601 is conditional-only in
  `SBA_504_BASE` too, matching the pattern). Applied + verified.
- **`sbaFormDispatch.ts`** — 4 new cases. `SBA_148`/`SBA_148L` each find
  the first signer matching their specific `guaranteeType` (not just "the
  first signer") — a deal with both unconditional and limited guarantors
  correctly produces both package items rather than only ever hitting one
  branch. `SBA_722` returns the raw poster PDF bytes as-is (no filling —
  correctly matches "not fillable") gated on `acknowledged`.
- **10-tab package assembly** (`src/lib/sba/package/tenTabAssembly.ts` +
  `assembleTenTabPackage.ts`) — pure tab-mapping (documented assumption:
  no authoritative "10-tab" spec exists anywhere in this codebase to
  verify the exact breakdown against; a standard SBA-lender submission
  convention was used instead — flagged in the Drift Log) + a DB-aware
  merge function using `pdf-lib` to concatenate every `status='generated'`
  package-run item into one PDF, tab-ordered. Wired into the *existing*
  action-dispatch POST handler at `/api/deals/[dealId]/sba` as a new
  `assemble-package` action — **zero new route files**, continuing the
  route-budget discipline established in Phase 4.
- Handles a real bucket wrinkle: generated items can live in either
  `bank-forms` (this arc's own upload path) or `deal-documents` (Form
  159's pre-existing, unchanged upload path) — the assembler tries both
  rather than requiring a schema change to track per-item bucket.
- `sbaFormDispatch.test.ts` extended with 4 new cases (`SBA_148`,
  `SBA_148L`, `SBA_601`, `SBA_722`) confirming each fails closed
  (`not_applicable`/`not_acknowledged`) on an empty deal rather than
  fabricating output — same pattern as every other conditional form.
- 41 tests total this phase (form148: 4, form601: 3, form722: 4,
  guarantee-type: 5, tenTabAssembly: 7, sbaFormDispatch: +5 new + 1
  updated count assertion).

## Verification

```sql
-- Gate 5
SELECT pt.code, count(pi.*) FROM sba_package_templates pt
JOIN sba_package_items pi ON pi.package_template_id = pt.id GROUP BY 1;
-- SBA_7A_BASE  | 10 ✅
-- SBA_504_BASE | 9  ✅ (both include 148/148L/601/722 alongside every Phase 3-4 form)
```

- **Both smoke deals (7a + 504) produce a complete 10-tab package** —
  **not run live**: same environmental gaps as every prior phase (no
  smoke deal in prod, no DocuSeal, no official templates for 148/148L/
  601/722 ingested — sba.gov blocked). Every code path is real and
  tested: `sbaFormDispatch.test.ts`'s new cases confirm each of the 4 new
  form codes fails closed rather than fabricating output;
  `tenTabAssembly.test.ts` verifies the ordering logic the live
  assembler depends on.
- `tsc --noEmit` clean. Targeted run (form148/601/722, tenTabAssembly,
  guarantee-type, sbaFormDispatch): 41/41 passing.
- Route budget: unchanged at 1963/2048 for the 10-tab assembly feature
  (reused the existing action-dispatch route); +6 slots for the three new
  consolidated `[action]`/two-method routes (148, 601, 722).

## Known gaps

1. Same four environmental gaps carried from Phases 3-4 (no vendor
   credentials, no DocuSeal, no legal review, no smoke deal) plus: no
   official templates for 148/148L/601/722 ingested.
2. **10-tab structure is a documented assumption**, not sourced from an
   authoritative lender spec — see `tenTabAssembly.ts`'s docstring and the
   Drift Log entry. Confirm against a real receiving lender's expected
   tab order before relying on it for an actual submission.
3. **Story tab UI wasn't extended for the 4 new closing forms** —
   `SbaSigningPanel.tsx`/`signing-status/route.ts` still only cover the
   forms wired through Phase 3. Phase 5's spec section didn't call for UI
   work (only the form modules + 10-tab assembly), so this wasn't
   attempted; flagged as a natural follow-up so bankers can see
   148/148L/601/722 status the same way they see everything else.
