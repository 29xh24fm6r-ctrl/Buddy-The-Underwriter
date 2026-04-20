# AAR — Phase 53A Complete + Supabase CLI Sync

**Date:** March 2026  
**Type:** After-Action Review  
**Covers:** Phase 53A (Deal Builder) + Supabase migration infrastructure cleanup

---

## Phase 53A — Deal Builder ✅ COMPLETE

**Commit:** 22bac029  
**Files:** 42 new/modified files, 3,825 lines  

### DB Verification (confirmed live in production)

| Table | Columns | RLS |
|---|---|---|
| `deal_builder_sections` | 6 | ✅ enabled |
| `deal_collateral_items` | 10 | ✅ enabled |
| `deal_proceeds_items` | 6 | ✅ enabled |

### What shipped

**Library (`src/lib/builder/`)**
- `builderTypes.ts` — LoanType, EntityType, BorrowerCard, BuilderState, BuilderReadiness, StepCompletion, BuilderSectionKey, BuilderStepKey
- `builderCompletion.ts` — pure step completion scoring, 9 workflow steps
- `builderReadiness.ts` — pure milestone readiness (credit_ready + doc_ready)
- `builderPrefill.ts` — server-only prefill loader (deals, ownership_entities, memo overrides, BIE)
- `builderCanonicalWrite.ts` — server-only write-through to deals, ownership_entities, deal_memo_overrides

**API routes (`/api/deals/[dealId]/builder/`)**
- `sections/route.ts` — GET + PATCH with ON CONFLICT upsert + canonical write-through
- `prefill/route.ts` — GET Buddy prefill
- `collateral/route.ts` — GET + POST
- `collateral/[itemId]/route.ts` — PATCH + DELETE
- `proceeds/route.ts` — GET + POST
- `proceeds/[itemId]/route.ts` — DELETE

**Shared atoms (`src/components/builder/`)**
- `BuddySourceBadge.tsx` — ✨ "Buddy found this" amber chip
- `SaveStatePill.tsx` — "Saved ✓" / "Saving..." / error state
- `MilestoneChip.tsx` — Credit Ready / Doc Ready status chip
- `BuilderField.tsx` — label + input + badge + save pill wrapper
- `MissingItemsPanel.tsx` — right-rail missing items list

**Shell (`src/components/builder/`)**
- `BuilderPageClient.tsx` — root client component, owns all state
- `BuilderHeader.tsx` — always-visible header: name, product, amount, milestone chips, primary actions
- `BuilderWorkflowRail.tsx` — 9-step top nav rail with completion/warning indicators
- `BuilderWorkspace.tsx` — active step switcher
- `BuilderRightRail.tsx` — persistent right rail

**Drawers (`src/components/builder/drawers/`)**
- `DrawerShell.tsx` — right-side slide-in base (CSS transform, ~480px, explicit Save button)
- `OwnerDrawer.tsx` — create/edit owner/principal
- `GuarantorDrawer.tsx` — create/edit guarantor with "Same as owner" shortcut
- `LoanRequestDrawer.tsx` — full loan request fields
- `StoryPromptDrawer.tsx` — single story prompt with Buddy draft + confirm flow
- `EntityProfileDrawer.tsx` — entity profile tabs (Core Info stub in 53A)

**Modals (`src/components/builder/modals/`)**
- `CollateralModal.tsx` — add/edit collateral item
- `ProceedsModal.tsx` — use of proceeds line items

**Workspaces (`src/components/builder/workspaces/`)**
- `OverviewWorkspace.tsx` — deal snapshot, financial summary, BIE summary, missing-for-milestone
- `PartiesWorkspace.tsx` — entity cards from ownership_entities + drawers
- `LoanRequestWorkspace.tsx` — summary card + LoanRequestDrawer + ProceedsModal
- `FinancialsWorkspace.tsx` — read-only snapshot + deep-links (Phase 53B: interactive)
- `CollateralWorkspace.tsx` — collateral cards + CollateralModal
- `RiskWorkspace.tsx` — read-only risk summary + deep-link
- `DocumentsWorkspace.tsx` — doc checklist + deep-links
- `StoryWorkspace.tsx` — 6 prompt cards with Buddy drafts + StoryPromptDrawer
- `ReviewWorkspace.tsx` — credit_ready/doc_ready readiness, blockers, handoff actions

**Pages**
- `src/app/(app)/deals/[dealId]/builder/page.tsx` — server component (auth + parallel fetches)
- `src/app/(borrower)/portal/[dealId]/apply/page.tsx` — Coming Soon stub (Phase 53C)

**Modified**
- `src/app/(app)/deals/[dealId]/DealShell.tsx` — "Builder" added as first tab

### Key decisions enforced
- `ownership_entities` is the canonical entity store in 53A. No `entities` or `deal_entities` tables.
- `parties` is the section_key (not `borrowers`) — aligns with long-term model.
- Drawers have explicit Save buttons. Workspace fields are debounced 500ms.
- Collateral/proceeds fire immediately on add/delete (not debounced).
- `ssn_last4` (4 chars max) only. Full PII vault is Phase 53C.
- Financials, Risk, Documents workspaces are read-only deep-link surfaces in 53A.
- Story write-through: `competitive_position` and `committee_notes` are new `deal_memo_overrides` keys. Always merge, never replace.
- Milestone facts written to `deal_financial_facts` after every section save: `BUILDER_COMPLETION_PCT`, `CREDIT_READY_PCT`, `DOC_READY_PCT`.
- `generate_docs` button is present but disabled with "Coming Soon" — milestone architecture wired, action activates in 53C.

### God Tier impact
**Item #65 ✅ COMPLETE** — Borrower Intake wired. Banker UX + data model in place. Borrower portal wizard skin in Phase 53C.

---

## Supabase CLI Sync ✅ COMPLETE

**Problem:** `supabase db push` was broken. `schema_migrations` had 247 entries in mixed formats (bare timestamps and full filenames from dashboard-applied migrations). Supabase CLI requires numeric-only timestamps and one-to-one local↔remote file mapping.

**What was done:**
1. Truncated `schema_migrations` on remote (247 entries with inconsistent formats)
2. Renamed 156 local migration files to have unique numeric timestamp prefixes
3. Registered all 248 versions via `supabase migration repair --status applied`
4. Verified: `supabase db push --dry-run` → "Remote database is up to date"
5. Committed and pushed to `main`

**Result:** `supabase db push` now works cleanly. All future migrations can be applied with `supabase db push` or `supabase migration up`. No more manual dashboard-applied migrations needed.

**Important:** 248 migrations are now registered. Every future migration file must follow the numeric timestamp naming convention that the CLI expects. Do not create migration files via the Supabase dashboard — always create locally and apply via CLI.

---

## Current P1 Status

| Item | Status |
|---|---|
| Builder migration applied to production | ✅ Confirmed live (`deal_builder_sections`, `deal_collateral_items`, `deal_proceeds_items` all exist with RLS) |
| Supabase CLI sync | ✅ Complete — `supabase db push` works |
| Retype Ialacci bio | 🔴 One-time manual task — re-open wizard, retype bio under UUID key |
| Reconciliation (`recon_status` NULL) | 🔴 Blocks Committee Approve signal |
