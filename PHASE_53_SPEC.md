# Phase 53 — Deal Builder (Reconciled Spec)

**Status:** 🔴 Spec — Ready for Build  
**Prereq:** Phase 52 complete ✅  
**Architect:** Claude (codebase-reconciled) + ChatGPT (UX model)  
**Builder:** Antigravity / Claude Code  
**Replaces:** PHASE_53_SPEC.md v1 (form-grid approach — superseded)

---

## Reconciliation Notes

ChatGPT produced a significantly better UX architecture: workflow rail,
summary-first workspaces, modal/drawer editing, entity-first model, story
as prompt cards, and milestone readiness. All of that is correct and
adopted here.

Four guardrails were applied before this spec was finalized:

**1. Entity model scoped to Phase 53B.**
ChatGPT proposes `entities` + `deal_entities` + `entity_relationships` tables.
These conflict with `ownership_entities`, which is deeply wired into the
extraction pipeline (Phase 49 `ensureOwnerEntity()`, principal bio UUID keys,
1040/PFS auto-creation). Introducing parallel entity tables in 53A creates
two competing identity systems. Fix: Phase 53A uses `ownership_entities` as
the entity layer. `deal_entities` (participation/role table) moves to Phase 53B.
`entity_relationships` moves to Phase 53C.

**2. PII vault scoped to Phase 53C.**
"Encrypted storage / vault / external provider" is correct long-term but
would block Phase 53A entirely. Fix: ssn_last4 only in Phase 53A. Full PII
vault path is Phase 53C.

**3. Financials, Risk, Documents workflow steps are read-only surfaces in 53A.**
Buddy already owns all financial data. The Builder surfaces it as a snapshot
with a deep-link to the full tab. Phase 53A does not re-implement financial
entry. These steps become interactive review surfaces in Phase 53B.

**4. "Generate Docs" gating is stubbed.**
Loan-doc generation does not yet exist. The button is present, disabled, with
"Coming Soon" state. The milestone architecture is in place. The button
activates in a future phase.

---

## Product Goal

The Deal Builder is the primary workspace where a banker assembles a complete
commercial loan package from start to finish — and where a borrower completes
their own intake using the exact same underlying data model.

It is:
- A deal assembly system
- An entity configuration system
- A story capture system
- A readiness engine
- A bridge to credit memo and loan-doc generation

It is not a dashboard and not a static form engine.

The standard: **dramatically easier than nCino, while more rigorous underneath.**

---

## Phased Architecture

### Phase 53A — Foundation (build now)
Route, shell, workflow rail, summary-first workspaces, auto-save, prefill,
Parties using `ownership_entities`, Story prompt cards, collateral/proceeds
modals, completion scoring, milestone readiness UI.

### Phase 53B — Entity-first upgrade (next phase)
Add `deal_entities` participation table. Introduce "Select Existing Entity"
cross-deal modal. Promote Owner → Guarantor flow. Full entity profile drawer.

### Phase 53C — Readiness + PII (future)
Secure SSN/TIN vault path. Doc-ready milestone gates. Submit to Credit gating.
Borrower portal wizard skin.

### Phase 53D — Observability (future)
Full ledger events for all builder actions. Builder activity in Timeline tab.
Pulse telemetry forwarding.

**This spec covers Phase 53A in full detail. Phases 53B–D are scoped
conceptually to inform architecture decisions made now.**

---

## Route + Placement

### Primary route

```
/deals/[dealId]/builder
```

Inside `src/app/(app)/deals/[dealId]/builder/`.
Uses the existing DealShell chrome. Does NOT live inside cockpit — it is
a sibling route alongside cockpit, documents, financials, etc.

### DealShell Tab

Add **"Builder"** as the **first tab** in `DealShell.tsx`:

```tsx
// DealShell.tsx — tabs array (updated, one line change)
const tabs = [
  { label: "Builder", href: `${base}/builder` },       // ← NEW — first
  { label: "Intelligence", href: `${base}/intelligence` },
  { label: "Documents", href: `${base}/documents` },
  { label: "Financials", href: `${base}/financials` },
  { label: "Structure", href: `${base}/structure` },
  { label: "Risk", href: `${base}/risk` },
  { label: "Relationship", href: `${base}/relationship` },
  { label: "Committee", href: `${base}/committee-studio` },
  { label: "Borrower", href: `${base}/borrower` },
  { label: "Portal", href: `${base}/portal-inbox` },
  { label: "Classic Spreads", href: `${base}/classic-spreads` },
];
```

### Borrower portal route

```
/portal/[dealId]/apply
```

Inside `src/app/(borrower)/portal/[dealId]/apply/`.
Phase 53C implementation. The route must exist in 53A but renders a
"Coming Soon" placeholder until 53C.

---

## Primary Interaction Model

### Page layout

```
[DealShell Header + Tab Row]
┌──────────────────────────────────────────────────────────────────────────┐
│ BUILDER HEADER                                                           │
│ Deal Name | Product | $Amount | Stage | [In Progress] [Credit Ready ○]  │
│ [Run Analysis]  [View Credit Memo]  [Submit to Credit ○]                 │
├──────────────────────────────────────────────────────────────────────────┤
│ WORKFLOW RAIL (top, full-width)                                          │
│ [Overview] [Parties] [Loan Request] [Financials] [Collateral]           │
│ [Risk] [Documents] [Story] [Review]                                     │
│  ✅ 100%    ⚠ 2      ✅ 100%        📊 view      ○ 0 items              │
├──────────────────────────────────────────────────────┬───────────────────┤
│ MAIN WORKSPACE (active step)                         │ RIGHT RAIL        │
│                                                      │                   │
│ [Summary cards]                                      │ Missing Items     │
│ [Entity cards]                                       │ Buddy Suggestions │
│ [Action buttons → drawers/modals]                    │ Risk Flags        │
│                                                      │ Save State        │
│                                                      │ Credit Readiness  │
└──────────────────────────────────────────────────────┴───────────────────┘
```

### Builder Header (always visible)

Always shows:
- Deal name (editable, same `DealNameInlineEditor` used in DealShell)
- Product / Loan type badge
- Requested amount
- Stage
- Milestone chips: `In Progress` | `Credit Ready ●` | `Doc Ready ●`
  (filled green when milestone passes, gray with checkmark outline when not)
- Primary actions:
  - **Run Analysis** → triggers research/risk run (existing routes)
  - **View Credit Memo** → `/credit-memo/[dealId]/canonical`
  - **Submit to Credit** → disabled if not credit-ready, enabled when milestone passes
  - **Generate Docs** → disabled + "Coming Soon" in Phase 53A

### Workflow Rail (top navigation)

Nine steps rendered as a horizontal chip rail below the header.
Each chip shows:
- Step name
- Completion indicator: ✅ complete | ⚠ N warnings | ○ not started | 🔴 N blockers
- Clicking navigates to that step's workspace
- Active step is highlighted (same pill style as DealShell tabs)

Steps:
1. **Overview** — deal snapshot + launch actions
2. **Parties** — borrowers, owners, guarantors
3. **Loan Request** — amount, type, structure terms
4. **Financials** — Buddy's extracted data (read-only in 53A)
5. **Collateral** — collateral package
6. **Risk** — live risk flags (read-only in 53A)
7. **Documents** — doc checklist status (read-only in 53A)
8. **Story** — qualitative capture
9. **Review** — readiness + handoff

### Right Intelligence Rail (persistent)

Always visible on the right (collapsible on mobile):
- **Missing Items** — list of required fields not yet filled
- **Buddy Suggestions** — prefill opportunities (click to apply)
- **Risk Flags** — from `ai_risk_runs` if available
- **Save State** — last saved timestamp, retry indicator if offline
- **Credit Readiness** — `credit_ready_pct` progress bar
  with checklist of what's blocking

---

## Workspace Definitions (Phase 53A)

### 1 — Overview

Purpose: instant deal understanding, launch actions.

Display:
- **Deal Snapshot Card** — name, borrower, loan type, amount, stage
- **Parties Snapshot** — number of owners identified, guarantors
- **Financial Snapshot** — DSCR, NOI, LTV from `useFinancialSnapshot` hook
  (already exists and used in DealShell)
- **Buddy Deal Summary** — 2–3 sentence narrative from BIE research
  (read from `buddy_research_narratives` version 3, `Summary` section)
- **Top Strengths** — from `ai_risk_runs.result_json` if available
- **Top Risks** — from `ai_risk_runs.result_json` if available
- **Missing for Credit Ready** — computed list of credit_ready blockers
- **Missing for Doc Ready** — computed list (shown but gated actions are 53C)

Actions (launch into other steps):
- "Add Owner" → opens Parties workspace
- "Define Loan Request" → opens Loan Request workspace
- "Complete Story" → opens Story workspace
- "Resolve Blockers" → scrolls right rail missing items into view

No large forms here. Summary only.

---

### 2 — Parties

Purpose: manage all entities on the transaction.

**Phase 53A entity model:** Uses `ownership_entities` as the underlying
entity store. Each `ownership_entities` row is an "entity" for Builder purposes.
The Phase 53B `deal_entities` table will add a richer participation/role layer.

Default display:
- **Borrower Entity Card** per `ownership_entities` row (type: business)
- **Owner/Principal Cards** per `ownership_entities` row (type: person)
- **Guarantor Cards** per guarantors in `deal_builder_sections.guarantors`
- **Ownership % summary** — total shown at bottom, red if > 100%

Primary actions:
- "Add Owner" → opens `OwnerDrawer` (right-side drawer)
- "Add Guarantor" → opens `GuarantorDrawer` (right-side drawer)
- "Same as Owner" shortcut in `GuarantorDrawer` — links guarantor to owner card
- Clicking any entity card → opens `EntityProfileDrawer`

**OwnerDrawer fields** (right-side drawer, not inline form):
- Full legal name
- Role / title (CEO, President, Managing Member, Partner, etc.)
- Ownership %
- DOB
- Home address, city, state, zip
- SSN last 4 (never full SSN — see Implementation Constraints)
- Years with company
- Credit authorization obtained (checkbox)
- Link PFS document (file reference)

On save → upserts to both `deal_builder_sections.borrowers.owners` (full
section PATCH) AND calls `ensureOwnerEntity()` write-through to
`ownership_entities`. Conflict key: `(deal_id, display_name)`.

**GuarantorDrawer fields**:
- "Same as existing owner" dropdown (auto-fills name + links record)
- Full legal name
- Guaranty type: Full | Limited | Springing | Environmental
- Guaranty amount (only if Limited)
- Net worth (from PFS if uploaded)
- Liquid assets (from PFS if uploaded)
- Link PFS document

"No personal guaranty" toggle — sets `data.no_guarantors = true`, collapses
section with a note.

**EntityProfileDrawer** (read/edit):
- Tabs: Core Info | Deal Role | Financial Snapshot | Associated Docs
- Core Info = all the fields from OwnerDrawer, editable
- Deal Role = ownership %, title, guaranty status
- Financial Snapshot = PFS summary if PFS uploaded (read-only)
- Associated Docs = documents linked to this entity

Buddy pre-fill: `ownership_entities` rows auto-populate the cards on load.
Fields already set are shown with source badge. Banker can confirm or edit.

---

### 3 — Loan Request

Purpose: define the requested credit structure.

Default display: summary card showing current loan request, not raw fields.

**Loan Request Summary Card** shows:
- Product type badge
- Requested amount (large, prominent)
- Term / Amortization
- Loan Purpose (first 80 chars)
- Target close date
- Deposit relationship badges (DDA ✓ | Treasury | Payroll | Merchant)

Action: "Edit Loan Request" → opens `LoanRequestDrawer`

**Use of Proceeds Card**:
- Proceeds lines list with category, description, amount
- Running total vs. requested amount
- Variance warning if > 5% off
- "Edit Proceeds" → opens `ProceedsModal`

**Equity Injection Card** (if applicable):
- Amount, source, type
- "Edit" → opens `EquityDrawer` (subset of LoanRequestDrawer)

**LoanRequestDrawer fields** (right-side drawer):
- Loan purpose (plain text — "What does the borrower intend to use this loan for?")
- Requested amount
- Product type (select — see LoanType enum below)
- Desired term (months)
- Desired amortization (months — defaults to term)
- Interest-only period (months, optional)
- Fixed vs. floating (toggle)
- Target close date
- Referral source
- Relationship manager (pre-fill from Clerk user display name)
- Existing customer (toggle)
- Deposit relationship (checkboxes: DDA | Treasury | Payroll | Merchant)
- Equity injection amount + source + type

**ProceedsModal** (centered modal):
- Repeatable rows: category (select) + description + amount
- Running total shown at bottom
- Variance indicator vs. requested amount
- "Add Line" button at bottom
- Save closes modal and returns to workspace

Data persistence: Scalar fields → `deal_builder_sections` (section_key: `deal`
and `structure`). Proceeds lines → `deal_proceeds_items` table (one row per
line, INSERT/DELETE via API).

---

### 4 — Financials (read-only in Phase 53A)

Purpose: show what Buddy extracted. Not a data entry surface in 53A.

Display:
- **Financial Summary Card** — DSCR, NOI, ADS, net income — from
  `useFinancialSnapshot` hook (already built, used in DealShell)
- **Borrower Financial Health** — trends, year-over-year, from snapshot
- **Confidence Badges** per metric — from `ConfidenceBadge.tsx` (already exists)
- **Extraction Status** — number of docs extracted, any unresolved issues
- **"Open Full Financials"** → links to `/deals/[dealId]/financials`
- **"Open Spreads"** → links to `/deals/[dealId]/classic-spreads`

In Phase 53B: this step becomes an interactive financial review surface where
bankers can confirm/override extracted values directly.

---

### 5 — Collateral

Purpose: manage the collateral package.

Default display:
- **Collateral Item Cards** — one card per `deal_collateral_items` row
- **Total Collateral Value** — sum of all estimated values
- **Lien Summary** — 1st lien items listed
- **Coverage Ratio** — total collateral value / requested amount (computed)

Each collateral card shows: type badge, description, value, lien position,
appraisal date (if set), address (if real estate).

Actions:
- "Add Collateral" → opens `CollateralModal`
- Clicking a card → opens `CollateralModal` in edit mode
- Delete icon on each card (confirm inline, no modal)

**CollateralModal fields** (centered modal):
- Type (select — see CollateralType enum)
- Description (plain text — "Describe the collateral")
- Estimated value ($)
- Lien position (1st, 2nd, 3rd — select)
- Appraisal date (date picker)
- Property address (conditional — only shown if type = real_estate)

Saves to `deal_collateral_items` table via POST/PATCH API route.

---

### 6 — Risk (read-only in Phase 53A)

Purpose: surface live underwriting concerns.

Display:
- **AI Risk Grade** — from `ai_risk_runs` (BB+, pricing) — already rendered
  in existing Risk tab
- **Top 3 Risks** — from `ai_risk_runs.result_json`
- **Key Strengths** — from `ai_risk_runs.result_json`
- **Policy Exceptions** — any active exceptions (future)
- **"Open Full Risk Analysis"** → links to `/deals/[dealId]/risk`

In Phase 53B: bankers can enter mitigants directly in this step.

---

### 7 — Documents (read-only in Phase 53A)

Purpose: documents are evidence, not the center of experience.

Display:
- **Core Documents Status** — the same checklist from the cockpit
  (5/5 received, etc.) — reuse `CoreDocumentsChecklist` component if it exists
- **Missing Required Docs** — list with "Request from Borrower" action
- **Extraction Issues** — any docs with unresolved extraction problems
- **"Open Documents"** → links to `/deals/[dealId]/documents`
- **"Request from Borrower"** → links to portal inbox

In Phase 53B: doc linking to entities (this appraisal belongs to this
collateral item, this PFS belongs to this guarantor) is added here.

---

### 8 — Story

Purpose: capture qualitative intelligence. Never stacked text areas.

Display: six **Prompt Cards** arranged in a 2-column grid (3 rows).

Each Prompt Card shows:
- Question (plain language, large)
- Buddy draft (if available — extracted from BIE or existing `deal_memo_overrides`)
  with ✨ "Buddy found this" amber badge
- Current banker answer (first 120 chars, truncated)
- Banker status badge: `Untouched` | `Reviewed` | `Edited` | `Confirmed`
- Character count + minimum indicator (50 char minimum)
- "Edit" button → opens `StoryPromptDrawer`

The six prompts:

| Card | Field Key | Memo Override Key | Prompt |
|---|---|---|---|
| 1 | `loan_purpose_narrative` | `use_of_proceeds` | Why does this business need this loan right now? |
| 2 | `management_qualifications` | `principal_background` | What makes this management team qualified? |
| 3 | `competitive_position` | `competitive_position` (new) | What is this business's competitive advantage? |
| 4 | `known_weaknesses` | `key_weaknesses` | What are the known weaknesses and how are they mitigated? |
| 5 | `deal_strengths` | `key_strengths` | What makes this a strong credit? |
| 6 | `committee_notes` | `committee_notes` (new) | Anything else the credit committee should know? |

**StoryPromptDrawer** (right-side drawer):
- Prompt shown at top (large, gray)
- Buddy draft shown below in amber-tinted box (if available):
  "✨ Buddy found this — review and confirm, or edit below"
  - "Use Buddy's Draft" button → copies draft to editable field
- Large textarea (editable)
- Character count live
- Auto-saves to `deal_builder_sections.story` on debounce
- On save, ALSO merges into `deal_memo_overrides` (sequential
  select-then-update/insert pattern — never replace full JSONB)
- "Confirm" button sets `status = "confirmed"` in local state (persisted
  in `deal_builder_sections.story_confirmations jsonb`)

Buddy pre-fill sources:
- `deal_memo_overrides` — any fields already set via Phase 52 Story tab
  (pre-existing data — confirmed, not just draft)
- BIE narrative `Management` section → `management_qualifications` draft
- BIE narrative `Competitive Position` → `competitive_position` draft
- Pre-fill takes no precedence over existing builder data. Only fills
  null/empty fields.

Completion rule: 3+ of 6 cards with ≥ 50 characters each.

---

### 9 — Review

Purpose: final readiness check and handoff surface.

Display:
- **Milestone Readiness** (two large status cards):
  - Credit Ready: pct + blockers list
  - Doc Ready: pct + blockers list (actions gated until 53C)
- **Section Completeness Table** — all 6 sections, completion %, warnings
- **Entity Completeness** — each owner/guarantor, completeness
- **Document Completeness** — required docs received/missing
- **Memo Completeness** — story fields filled / not filled
- **Actions**:
  - "Generate Credit Memo" → `/credit-memo/[dealId]/canonical`
  - "Submit to Credit" → enabled only when `credit_ready_pct >= 100`
  - "Generate Docs" → disabled + "Coming Soon" (Phase 53C)
  - "Request Missing Docs from Borrower" → portal inbox link

---

## Data Model

### Three new tables (same as v1 spec)

All three tables are additive. No existing tables are modified.

#### `deal_builder_sections`

```sql
create table if not exists deal_builder_sections (
  id          uuid        primary key default gen_random_uuid(),
  deal_id     uuid        not null references deals(id) on delete cascade,
  section_key text        not null,
  data        jsonb       not null default '{}',
  completed   boolean     not null default false,
  updated_at  timestamptz not null default now(),
  unique(deal_id, section_key)
);

alter table deal_builder_sections enable row level security;

create policy "bank_scoped_builder_sections"
  on deal_builder_sections
  using (
    deal_id in (
      select id from deals
      where bank_id = (
        select bank_id from bank_users
        where user_id = auth.uid()
        limit 1
      )
    )
  );

create index idx_deal_builder_sections_deal_id
  on deal_builder_sections(deal_id);
```

#### `deal_collateral_items`

```sql
create table if not exists deal_collateral_items (
  id               uuid        primary key default gen_random_uuid(),
  deal_id          uuid        not null references deals(id) on delete cascade,
  item_type        text        not null,
  description      text,
  estimated_value  numeric,
  lien_position    integer     not null default 1,
  appraisal_date   date,
  address          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table deal_collateral_items enable row level security;

create policy "bank_scoped_collateral"
  on deal_collateral_items
  using (
    deal_id in (
      select id from deals
      where bank_id = (
        select bank_id from bank_users
        where user_id = auth.uid()
        limit 1
      )
    )
  );

create index idx_deal_collateral_items_deal_id
  on deal_collateral_items(deal_id);
```

#### `deal_proceeds_items`

```sql
create table if not exists deal_proceeds_items (
  id          uuid        primary key default gen_random_uuid(),
  deal_id     uuid        not null references deals(id) on delete cascade,
  category    text        not null,
  description text,
  amount      numeric     not null,
  created_at  timestamptz not null default now()
);

alter table deal_proceeds_items enable row level security;

create policy "bank_scoped_proceeds"
  on deal_proceeds_items
  using (
    deal_id in (
      select id from deals
      where bank_id = (
        select bank_id from bank_users
        where user_id = auth.uid()
        limit 1
      )
    )
  );

create index idx_deal_proceeds_items_deal_id
  on deal_proceeds_items(deal_id);
```

Migration file: `supabase/migrations/20260320_deal_builder.sql`

### `deal_builder_sections.data` shapes by section_key

Section keys and their JSONB data structures:

**`deal`** → `DealSectionData`
**`business`** → `BusinessSectionData`
**`parties`** → `{ owners: BorrowerCard[]; }` (same structure as `borrowers` from v1)
**`guarantors`** → `{ guarantors: GuarantorCard[]; no_guarantors?: boolean; }`
**`structure`** → `StructureSectionData` (scalar fields only — collateral/proceeds are rows)
**`story`** → `{ [fieldKey]: string; story_confirmations?: Record<string, 'confirmed' | 'edited'> }`

Note: `section_key = 'parties'` replaces `'borrowers'` from v1. The data
shape is identical. Using `parties` aligns with the ChatGPT long-term model
where this section grows to include affiliates and co-borrowers.

---

## Canonical Write-Through

When any section is saved, `builderCanonicalWrite.ts` fires non-fatally:

| Section | What gets written | Where |
|---|---|---|
| `deal` | `loan_amount` if changed | `deals.loan_amount` |
| `business` | `legal_entity_name` if not already set | `deals.name` |
| `parties` | Each owner card → `ensureOwnerEntity()` | `ownership_entities` |
| `story` | All 6 story fields | `deal_memo_overrides` (merge, never replace) |
| any | `BUILDER_COMPLETION_PCT` | `deal_financial_facts` |

Write-through is always best-effort. Failure logs to `console.error` with
`error.code`, `error.details`, `error.hint` but never throws.

Story fields written to `deal_memo_overrides` use the sequential
select-then-update/insert pattern (not upsert). New keys added:
`competitive_position`, `committee_notes`.

---

## Milestone Readiness Engine

File: `src/lib/builder/builderReadiness.ts`

Computes two milestone states from current builder data:

### Credit Ready Checklist

A deal is Credit Ready when ALL of the following are present:

| Check | Source |
|---|---|
| Loan purpose filled | `deal.loan_purpose` |
| Requested amount > 0 | `deal.requested_amount` |
| Loan type set | `deal.loan_type` |
| Legal entity name | `business.legal_entity_name` |
| Entity type | `business.entity_type` |
| At least one owner with name + ownership % + title | `parties.owners` |
| At least one story field ≥ 50 chars | `story.*` |
| Financial snapshot exists | `deal_financial_facts` (DSCR present) |

### Doc Ready Checklist (Phase 53C gates actions, but compute now)

A deal is Doc Ready when Credit Ready PLUS:

| Check | Source |
|---|---|
| State of formation | `business.state_of_formation` |
| Business address complete | `business.business_address` + city + state + zip |
| All owners have home address | `parties.owners[*].home_address` |
| Guarantors configured (or no_guarantors=true) | `guarantors.*` |
| At least one collateral item | `deal_collateral_items` count |
| Proceeds lines sum within 5% of requested | `deal_proceeds_items` sum |
| 3+ story fields ≥ 50 chars | `story.*` |

Output type:

```ts
type BuilderReadiness = {
  credit_ready: boolean;
  credit_ready_pct: number;
  credit_ready_blockers: string[];
  doc_ready: boolean;
  doc_ready_pct: number;
  doc_ready_blockers: string[];
};
```

After every section save, compute readiness client-side and write
`CREDIT_READY_PCT` and `DOC_READY_PCT` to `deal_financial_facts`
with `source_type = "COMPUTED"`, `confidence = 1.00`.

---

## Auto-Save Pattern

```
Drawer/field onChange → local React state updated immediately
  → debounced 500ms → PATCH /api/deals/[dealId]/builder/sections
      body: { section_key: "parties", data: { owners: [...] } }
  → API: upsert ON CONFLICT (deal_id, section_key) DO UPDATE SET data = ...
  → API: fire builderCanonicalWrite (non-fatal async)
  → Response: { ok: true; updated_at: string }
  → Client: SaveStatePill flashes "Saved ✓" for 1.2s
```

Collateral and proceeds items use their own atomic API routes (POST/DELETE).
These are not debounced — they fire immediately on add/delete.

No Save button anywhere. Every state change persists.

---

## Buddy Prefill

Route: `GET /api/deals/[dealId]/builder/prefill`

Sequential queries (no FK-dependent joins):
1. `deals` → `name`, `loan_amount`, `stage`
2. `ownership_entities` → all rows for deal_id
3. `deal_memo_overrides` → existing overrides
4. `deal_financial_facts` → `ENTITY_TYPE`, `DATE_FORMED`
5. `buddy_research_narratives` → latest version 3 (BIE), extract:
   `Business Overview` → `business.operations_description`
   `Management` → `story.management_qualifications`
   `Competitive Position` → `story.competitive_position`

Returns `BuilderPrefill`:
```ts
type BuilderPrefill = {
  deal: Partial<DealSectionData>;
  business: Partial<BusinessSectionData>;
  owners: Partial<BorrowerCard>[];
  story: Partial<StorySectionData>;
  sources: Record<string, 'buddy' | 'manual'>;
};
```

`sources` map keyed by field path → drives ✨ badge display in UI.

Pre-fill populates only blank fields. Any field with existing value in
`deal_builder_sections` takes priority over pre-fill.

---

## Ledger Events (Phase 53A subset)

Fire to `deal_events` (append-only) for:
- `builder.section_updated` — on every section save
- `builder.owner_added` — when a new owner card is created
- `builder.guarantor_added` — when a new guarantor card is created
- `builder.story_confirmed` — when a story prompt is confirmed
- `builder.credit_ready_changed` — when `credit_ready` flips true/false

Events are best-effort fire-and-forget. Never block the save response.

---

## TypeScript Types

File: `src/lib/builder/builderTypes.ts`

```ts
export type LoanType =
  | 'term_loan' | 'line_of_credit' | 'sba_7a' | 'sba_504'
  | 'usda_b_and_i' | 'cre_mortgage' | 'ci_loan' | 'equipment'
  | 'construction' | 'other';

export type EntityType =
  | 'llc' | 's_corp' | 'c_corp' | 'partnership'
  | 'sole_prop' | 'trust' | 'non_profit' | 'other';

export type GuarantyType = 'full' | 'limited' | 'springing' | 'environmental';

export type CollateralType =
  | 'real_estate' | 'equipment' | 'accounts_receivable' | 'inventory'
  | 'blanket_lien' | 'vehicle' | 'other';

export type ProceedsCategory =
  | 'equipment' | 'real_estate' | 'working_capital' | 'debt_payoff'
  | 'acquisition' | 'renovation' | 'other';

export type BuilderStepKey =
  | 'overview' | 'parties' | 'loan_request' | 'financials'
  | 'collateral' | 'risk' | 'documents' | 'story' | 'review';

export type BuilderSectionKey =
  | 'deal' | 'business' | 'parties' | 'guarantors' | 'structure' | 'story';

export type DealSectionData = {
  loan_purpose?: string;
  requested_amount?: number;
  loan_type?: LoanType;
  desired_term_months?: number;
  desired_amortization_months?: number;
  interest_only_months?: number;
  fixed_vs_floating?: 'fixed' | 'floating';
  target_close_date?: string;
  referral_source?: string;
  relationship_manager?: string;
  existing_bank_customer?: boolean;
};

export type BusinessSectionData = {
  legal_entity_name?: string;
  dba?: string;
  ein?: string;
  entity_type?: EntityType;
  state_of_formation?: string;
  date_formed?: string;
  business_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  website?: string;
  naics_code?: string;
  industry_description?: string;
  operations_description?: string;
  employee_count?: number;
  seasonal?: boolean;
  key_customers?: string;
};

export type BorrowerCard = {
  id: string;
  ownership_entity_id?: string;
  full_legal_name?: string;
  ssn_last4?: string;
  dob?: string;
  home_address?: string;
  home_city?: string;
  home_state?: string;
  home_zip?: string;
  ownership_pct?: number;
  title?: string;
  years_with_company?: number;
  credit_auth_obtained?: boolean;
  pfs_document_id?: string;
};

export type PartiesSectionData = {
  owners: BorrowerCard[];
};

export type GuarantorCard = {
  id: string;
  same_as_borrower_id?: string;
  full_legal_name?: string;
  guaranty_type?: GuarantyType;
  guaranty_amount?: number;
  net_worth?: number;
  liquid_assets?: number;
  pfs_document_id?: string;
};

export type GuarantorsSectionData = {
  guarantors: GuarantorCard[];
  no_guarantors?: boolean;
};

export type StructureSectionData = {
  equity_injection_amount?: number;
  equity_injection_source?: string;
  equity_injection_type?: 'cash' | 'equity_in_property' | 'seller_note' | 'other';
  existing_debt_payoff?: boolean;
  existing_debt_description?: string;
  deposit_dda?: boolean;
  deposit_treasury?: boolean;
  deposit_payroll?: boolean;
  deposit_merchant?: boolean;
  participation_flag?: boolean;
  participation_details?: string;
};

export type StorySectionData = {
  loan_purpose_narrative?: string;
  management_qualifications?: string;
  competitive_position?: string;
  known_weaknesses?: string;
  deal_strengths?: string;
  committee_notes?: string;
  story_confirmations?: Record<string, 'confirmed' | 'edited'>;
};

export type CollateralItem = {
  id: string;
  deal_id: string;
  item_type: CollateralType;
  description?: string;
  estimated_value?: number;
  lien_position: number;
  appraisal_date?: string;
  address?: string;
  created_at: string;
  updated_at: string;
};

export type ProceedsItem = {
  id: string;
  deal_id: string;
  category: ProceedsCategory;
  description?: string;
  amount: number;
  created_at: string;
};

export type BuilderPrefill = {
  deal: Partial<DealSectionData>;
  business: Partial<BusinessSectionData>;
  owners: Partial<BorrowerCard>[];
  story: Partial<StorySectionData>;
  sources: Record<string, 'buddy' | 'manual'>;
};

export type StepCompletion = {
  key: BuilderStepKey;
  label: string;
  pct: number;
  complete: boolean;
  warnings: number;
  blockers: number;
};

export type BuilderReadiness = {
  credit_ready: boolean;
  credit_ready_pct: number;
  credit_ready_blockers: string[];
  doc_ready: boolean;
  doc_ready_pct: number;
  doc_ready_blockers: string[];
};

export type BuilderState = {
  sections: Partial<Record<BuilderSectionKey, Record<string, unknown>>>;
  collateral: CollateralItem[];
  proceeds: ProceedsItem[];
  prefill: BuilderPrefill | null;
  readiness: BuilderReadiness;
  activeStep: BuilderStepKey;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  lastSaved: string | null;
};
```

---

## API Routes

### `GET | PATCH /api/deals/[dealId]/builder/sections`

```
GET  → { sections: Record<BuilderSectionKey, { data: unknown; updated_at: string }> }
PATCH body: { section_key: BuilderSectionKey; data: Record<string, unknown> }
PATCH response: { ok: true; updated_at: string }
```

- `supabaseAdmin()` — server-only
- Upsert `deal_builder_sections` ON CONFLICT (deal_id, section_key)
- Fire `builderCanonicalWrite` non-fatally after upsert
- `export const runtime = "nodejs"`

### `GET /api/deals/[dealId]/builder/prefill`

```
GET → BuilderPrefill
```

- Sequential queries — no FK joins
- `supabaseAdmin()`
- `export const runtime = "nodejs"`

### `GET | POST /api/deals/[dealId]/builder/collateral`

```
GET  → { items: CollateralItem[] }
POST body: CollateralItemInput → { item: CollateralItem }
```

### `PATCH | DELETE /api/deals/[dealId]/builder/collateral/[itemId]`

```
PATCH body: Partial<CollateralItemInput> → { item: CollateralItem }
DELETE → { ok: true }
```

### `GET | POST /api/deals/[dealId]/builder/proceeds`

```
GET  → { items: ProceedsItem[] }
POST body: ProceedsItemInput → { item: ProceedsItem }
```

### `DELETE /api/deals/[dealId]/builder/proceeds/[itemId]`

```
DELETE → { ok: true }
```

All routes: `supabaseAdmin()`, `export const runtime = "nodejs"`,
sequential queries, no FK-dependent joins.

---

## Library Files

### `src/lib/builder/builderTypes.ts`
All TypeScript types (see above).

### `src/lib/builder/builderCompletion.ts`

```ts
// computeStepCompletions(state: BuilderState): StepCompletion[]
// computeOverallPct(steps: StepCompletion[]): number
```

Pure functions, no DB access. Driven entirely by `BuilderState`.

Step completion rules:
- **Overview:** always 100% (informational)
- **Parties:** ≥ 1 owner with name + ownership_pct + title
- **Loan Request:** loan_purpose + requested_amount + loan_type + desired_term_months
- **Financials:** true if financial snapshot exists (passed as prop from server)
- **Collateral:** ≥ 1 collateral item
- **Risk:** true if ai_risk_run exists (passed as prop from server)
- **Documents:** true if lifecycle.documentsReady (passed as prop)
- **Story:** ≥ 3 of 6 fields with ≥ 50 chars
- **Review:** computed from all above

### `src/lib/builder/builderReadiness.ts`

```ts
// computeBuilderReadiness(state: BuilderState, serverFlags: ServerFlags): BuilderReadiness
```

Pure function. `ServerFlags` carries booleans from server (snapshotExists,
documentsReady, etc.) that the client can't compute alone.

### `src/lib/builder/builderPrefill.ts`

```ts
// loadBuilderPrefill(dealId: string, sb: SupabaseClient): Promise<BuilderPrefill>
```

Server-only. Sequential queries. Returns `BuilderPrefill`.

### `src/lib/builder/builderCanonicalWrite.ts`

```ts
// writeBuilderCanonical(
//   dealId: string,
//   sectionKey: BuilderSectionKey,
//   data: Record<string, unknown>,
//   sb: SupabaseClient
// ): Promise<void>
```

Server-only. Never throws — all errors logged. Contains the deterministic
field map from section data to canonical tables. Story section always calls
the sequential select-then-update/insert pattern for `deal_memo_overrides`.

---

## Component Manifest

### Shell / Layout

| File | Purpose |
|---|---|
| `src/components/builder/BuilderPageClient.tsx` | Root client component — owns all state, coordinates all workspaces |
| `src/components/builder/BuilderHeader.tsx` | Always-visible header: name, loan type, amount, milestone chips, primary actions |
| `src/components/builder/BuilderWorkflowRail.tsx` | Top step navigation rail — 9 steps with completion/warning indicators |
| `src/components/builder/BuilderWorkspace.tsx` | Main content area — renders active step workspace |
| `src/components/builder/BuilderRightRail.tsx` | Persistent right rail: missing items, Buddy suggestions, save state, readiness |

### Shared Atoms

| File | Purpose |
|---|---|
| `src/components/builder/BuilderField.tsx` | Field: label + input + Buddy badge + save flash |
| `src/components/builder/BuddySourceBadge.tsx` | ✨ "Buddy found this" amber chip |
| `src/components/builder/SaveStatePill.tsx` | "Saved ✓" / "Saving..." / error indicator |
| `src/components/builder/MilestonChip.tsx` | Credit Ready / Doc Ready status chip |
| `src/components/builder/MissingItemsPanel.tsx` | Right-rail missing items list |

### Step Workspaces

| File | Purpose |
|---|---|
| `src/components/builder/workspaces/OverviewWorkspace.tsx` | Deal snapshot, financial summary, missing-for-milestone |
| `src/components/builder/workspaces/PartiesWorkspace.tsx` | Entity cards, add/edit via drawers |
| `src/components/builder/workspaces/LoanRequestWorkspace.tsx` | Summary card + edit via LoanRequestDrawer |
| `src/components/builder/workspaces/FinancialsWorkspace.tsx` | Read-only snapshot + deep-link to Financials tab |
| `src/components/builder/workspaces/CollateralWorkspace.tsx` | Collateral cards + CollateralModal |
| `src/components/builder/workspaces/RiskWorkspace.tsx` | Read-only risk summary + deep-link |
| `src/components/builder/workspaces/DocumentsWorkspace.tsx` | Doc checklist + deep-link |
| `src/components/builder/workspaces/StoryWorkspace.tsx` | Six prompt cards + StoryPromptDrawer |
| `src/components/builder/workspaces/ReviewWorkspace.tsx` | Readiness, blockers, handoff actions |

### Drawers + Modals

| File | Purpose |
|---|---|
| `src/components/builder/drawers/OwnerDrawer.tsx` | Right-side drawer: create/edit owner |
| `src/components/builder/drawers/GuarantorDrawer.tsx` | Right-side drawer: create/edit guarantor |
| `src/components/builder/drawers/EntityProfileDrawer.tsx` | Right-side drawer: full entity profile (tabs) |
| `src/components/builder/drawers/LoanRequestDrawer.tsx` | Right-side drawer: loan request fields |
| `src/components/builder/drawers/StoryPromptDrawer.tsx` | Right-side drawer: single story prompt edit |
| `src/components/builder/modals/CollateralModal.tsx` | Centered modal: add/edit collateral item |
| `src/components/builder/modals/ProceedsModal.tsx` | Centered modal: use of proceeds lines |

### Pages

| File | Purpose |
|---|---|
| `src/app/(app)/deals/[dealId]/builder/page.tsx` | Server component — fetches all data, passes to client |
| `src/app/(app)/deals/[dealId]/builder/BuilderPageClient.tsx` | See Shell above |
| `src/app/(borrower)/portal/[dealId]/apply/page.tsx` | Borrower portal — Phase 53C (stub in 53A) |

### Modified Files

| File | Change |
|---|---|
| `src/app/(app)/deals/[dealId]/DealShell.tsx` | Add "Builder" tab as first tab in tabs array |

---

## Drawer Architecture Pattern

All drawers are right-side slide-in panels (not modals). They should:
- Slide in from the right, width ~480px
- Have a title row with close button (X)
- Have a Save button at the bottom (NOT auto-save — drawers have an explicit
  save action because they represent a more deliberate edit flow than inline fields)
- On Save: close drawer + trigger section auto-save (debounced PATCH)
- On Close without save: discard local drawer state (confirm if dirty)

Use existing `dialog.tsx` in `src/components/ui/` as the base. The drawer
variant slides from the right using CSS transforms. No new UI libraries needed.

Modals (CollateralModal, ProceedsModal) are centered dialogs using the same
`dialog.tsx` base.

---

## Build Sequence (Phase 53A)

### Step 1 — Migration
Apply `supabase/migrations/20260320_deal_builder.sql`.
Verify 3 tables exist with correct RLS + indexes.
Smoke: `select count(*) from deal_builder_sections` returns 0 rows, no error.

### Step 2 — Types + Library (pure functions)
Create `src/lib/builder/builderTypes.ts` — all types verbatim from above.
Create `src/lib/builder/builderCompletion.ts` — pure completion functions.
Create `src/lib/builder/builderReadiness.ts` — pure readiness functions.
Create `src/lib/builder/builderPrefill.ts` — server-only prefill loader.
Create `src/lib/builder/builderCanonicalWrite.ts` — server-only write-through.
Confirm `tsc --noEmit` clean before proceeding.

### Step 3 — API Routes
Create all 8 API routes (sections GET/PATCH, collateral CRUD, proceeds CRUD, prefill GET).
`supabaseAdmin()` everywhere. `export const runtime = "nodejs"` everywhere.
Smoke-test against `ffcc9733`:
- GET sections → empty `{}` (no rows yet, expected)
- GET prefill → populated with entity name + owner cards

### Step 4 — Shared Atoms
Build in order (smallest first):
1. `BuddySourceBadge.tsx`
2. `SaveStatePill.tsx`
3. `MilestoneChip.tsx`
4. `BuilderField.tsx` (wraps input + label + badge + save pill)
5. `MissingItemsPanel.tsx`

Confirm renders correctly in isolation with mock props.

### Step 5 — Shell + Rail
Build:
1. `BuilderRightRail.tsx` (receives readiness + missing items as props)
2. `BuilderWorkflowRail.tsx` (receives step completions as props)
3. `BuilderHeader.tsx` (receives deal data + readiness as props)
4. `BuilderWorkspace.tsx` (switch on activeStep, renders workspace component)
5. `BuilderPageClient.tsx` (owns state, wires everything together)

### Step 6 — Drawers + Modals
Build:
1. Right-side drawer base (CSS transform variant of `dialog.tsx`)
2. `OwnerDrawer.tsx`
3. `GuarantorDrawer.tsx`
4. `LoanRequestDrawer.tsx`
5. `CollateralModal.tsx`
6. `ProceedsModal.tsx`
7. `StoryPromptDrawer.tsx`
8. `EntityProfileDrawer.tsx` (can be stub with Core Info tab only in 53A)

### Step 7 — Workspace Components
Build workspaces in order:
1. `OverviewWorkspace.tsx` (surfaces existing data, no new inputs)
2. `PartiesWorkspace.tsx` (entity cards + opens OwnerDrawer/GuarantorDrawer)
3. `LoanRequestWorkspace.tsx` (summary card + opens LoanRequestDrawer)
4. `CollateralWorkspace.tsx` (cards + opens CollateralModal)
5. `StoryWorkspace.tsx` (prompt cards + opens StoryPromptDrawer)
6. `ReviewWorkspace.tsx` (readiness display)
7. `FinancialsWorkspace.tsx` (read-only snapshot)
8. `RiskWorkspace.tsx` (read-only summary)
9. `DocumentsWorkspace.tsx` (checklist + deep-links)

### Step 8 — Builder Page (server component)
Create `src/app/(app)/deals/[dealId]/builder/page.tsx`:
- Auth via `clerkAuth()` + `ensureDealBankAccess()`
- Parallel fetches: deal row, all sections, prefill, collateral, proceeds,
  financial snapshot existence flag, lifecycle state (reuse pattern from
  cockpit page.tsx)
- Pass all as props to `BuilderPageClient`

### Step 9 — DealShell Tab
One-line change in `DealShell.tsx`. Confirm active state highlights on
`/deals/[dealId]/builder` and any sub-path.

### Step 10 — Canonical Write-Through + Completion Facts
Wire `builderCanonicalWrite.ts` into sections PATCH route.
After every section save, compute `BUILDER_COMPLETION_PCT`,
`CREDIT_READY_PCT`, `DOC_READY_PCT` and write to `deal_financial_facts`.
Fire ledger events.

### Step 11 — tsc Clean + Smoke Test
- `tsc --noEmit` zero errors
- Load Builder on `ffcc9733`:
  - Overview shows entity name, financial snapshot, BIE summary
  - Parties shows owner cards pre-populated from `ownership_entities`
  - Loan Request shows requested amount from `deals.loan_amount`
  - Story shows existing `deal_memo_overrides` fields as Buddy drafts
  - Workflow rail shows correct completion states for each step
  - "Edit" any owner → drawer opens, save → card updates, DB updated
  - Add collateral → modal opens → item appears in Collateral workspace
  - Edit story prompt → drawer opens, confirm → memo override updated
  - Credit Ready milestone chip updates when required fields are filled
- No `console.error` in browser on load or save

---

## Key Implementation Constraints

1. **Never store full SSN.** `ssn_last4` (4 chars max) only in `PartiesSectionData`.
   No exceptions. Full SSN vault path is Phase 53C.

2. **EIN: store full, display masked.** Store 9 digits in `business.ein`.
   Display as `XX-XXXXXXX` (last 4 visible). Never log full EIN.

3. **`ownership_entities` is the canonical entity store in Phase 53A.**
   Do NOT introduce `entities` or `deal_entities` tables. Every owner save
   calls `ensureOwnerEntity()` (Phase 49 pattern). Conflict key: `(deal_id, display_name)`.

4. **Story write-through is a MERGE, never a replace.** Sequential
   select-then-update/insert into `deal_memo_overrides`. Never overwrite
   existing keys. Two new keys: `competitive_position`, `committee_notes`.

5. **Prefill never overwrites.** Only fills null/empty fields. Saved builder
   data always wins.

6. **Proceeds mismatch = amber warning, not a blocker.** Never block save.

7. **Drawer save is explicit. Workspace saves are debounced.** Drawers have
   a Save button. Inline workspace field changes (if any) are debounced 500ms.
   Collateral/proceeds API calls fire immediately on add/delete.

8. **CSS skin rules.** Builder: `bg-[#0b0d10]`, `text-white`. Every
   `<input>` and `<textarea>` must set `text-gray-900 bg-white placeholder-gray-400`
   explicitly. Borrower portal (Phase 53C): `bg-white`, `text-gray-900`.

9. **Financials, Risk, Documents steps are read-only in 53A.** No new DB
   writes from those workspaces. Deep-link buttons navigate to existing tabs.

10. **"Generate Docs" button is disabled + "Coming Soon" in 53A.** The
    button exists so the milestone architecture is visible, but it does nothing.

11. **`supabaseAdmin()` in all server-side routes.** Never
    `createSupabaseServerClient()` in API routes. Sequential queries everywhere,
    no FK-dependent join syntax.

12. **`export const runtime = "nodejs"` on all API routes.** No maxDuration
    needed for builder routes (all simple DB reads/writes <1s).

---

## Definition of Done — Phase 53A

- [ ] Migration applied: 3 tables with RLS + indexes on `ffcc9733` DB
- [ ] `tsc --noEmit` zero errors
- [ ] "Builder" tab is first in DealShell, highlights on active route
- [ ] Builder loads for `ffcc9733`:
  - [ ] Builder Header shows deal name, loan type badge, amount, milestone chips
  - [ ] Workflow Rail shows 9 steps with correct completion/warning states
  - [ ] Overview workspace renders deal snapshot + financial summary + BIE summary
  - [ ] Parties workspace shows owner cards pre-populated from `ownership_entities`
  - [ ] Loan Request workspace shows requested amount + summary card
  - [ ] Financials workspace shows snapshot data + "Open Full Financials" link
  - [ ] Story workspace shows 6 prompt cards, Buddy drafts from `deal_memo_overrides`
  - [ ] Review workspace shows credit_ready_pct progress
  - [ ] Right rail shows missing items
- [ ] Edit owner in OwnerDrawer → Save → card updates → `ownership_entities` updated
- [ ] Add collateral → CollateralModal → item appears in Collateral workspace
- [ ] Edit story prompt → StoryPromptDrawer → save → `deal_memo_overrides` updated (merged)
- [ ] SaveStatePill flashes "Saved ✓" on every successful save
- [ ] Credit Ready milestone chip turns green when required fields are filled
- [ ] "Generate Docs" button is visible but disabled with "Coming Soon"
- [ ] No `console.error` in browser on load or save

---

## Future Phases (scoped, not built in 53A)

### Phase 53B — Entity-First Upgrade

New table `deal_entities`:
```sql
create table deal_entities (
  id                uuid primary key default gen_random_uuid(),
  deal_id           uuid not null references deals(id) on delete cascade,
  ownership_entity_id uuid not null references ownership_entities(id),
  role_key          text not null,
    -- lead_borrower | co_borrower | guarantor | limited_guarantor
    -- key_principal | affiliate | holding_company | operating_company
  is_primary        boolean not null default false,
  ownership_pct     numeric,
  guaranty_type     text,
  guaranty_amount   numeric,
  title             text,
  participation_data jsonb,
  completed         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique(deal_id, ownership_entity_id, role_key)
);
```

Adds:
- "Select Existing Entity" modal with cross-deal search
- "Promote Owner to Guarantor" flow
- EntityProfileDrawer fully built out (all tabs)
- Financials step becomes interactive review surface

### Phase 53C — Readiness + PII + Borrower Portal

- Secure PII path for full SSN/TIN (vault table or encrypted ref)
- "Submit to Credit" gate fully wired
- "Generate Docs" activated (when loan-doc generation exists)
- Borrower portal `/portal/[dealId]/apply` — wizard skin, light theme,
  borrower-visible sections only
- `borrower.application_completed` ledger event

### Phase 53D — Observability

- Full builder ledger events flowing to Pulse telemetry
- Builder activity in Timeline tab
- `builder.credit_ready_changed` Pulse push notification

---

## Roadmap Impact

Phase 53A completes **God Tier item #65** (Borrower Intake wired — data
model and banker UX in place; borrower portal UI in 53C) and creates:

- Credit memo auto-population foundation (builder story fields → memo, replacing wizard)
- Model Engine V2 can read `loan_type` and `entity_type` from builder sections
- Readiness Panel can include `CREDIT_READY_PCT` in deal readiness scoring
- Collateral data accessible to underwriting engine independently
- Proceeds data accessible for covenant and use-of-funds verification
