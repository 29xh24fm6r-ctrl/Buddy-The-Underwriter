# Phase 53 — Deal Builder

**Status:** 🔴 Spec — Ready for Build  
**Prereq:** Phase 52 complete ✅  
**Architect:** Claude (codebase-reconciled spec)  
**Builder:** Antigravity / Claude Code  

---

## Overview

Phase 53 introduces the **Deal Builder** — a structured deal origination
workspace accessible from the DealShell tab row. It is the informational
foundation of every deal: the place where a banker (or a borrower) provides
all data required for a complete credit decision.

The Builder is equivalent to what a banker enters in nCino to originate a
deal, but redesigned from the ground up to be:

- **Zero friction.** Completely intuitive. An untrained banker can follow it
  without training.
- **Dual-use.** Identical data model whether a banker fills it or a borrower
  fills it via the portal.
- **Buddy-assisted.** Fields Buddy already knows from documents and research
  are pre-populated. Bankers confirm, not retype.
- **Auto-saving.** No Save button. Every keystroke persists.
- **Non-blocking.** Missing fields are flagged visually, never block progress.

The six sections of the Builder collect everything needed for a complete
credit file: deal terms, business information, borrowers/owners, guarantors,
deal structure, and the qualitative deal story.

---

## Architecture Decision

### Route

```
/deals/[dealId]/builder
```

- Lives inside `src/app/(app)/deals/[dealId]/builder/`
- Uses the existing DealShell chrome (same layout as all other deal pages)
- Own 2-column internal layout: left sidebar nav + right content area
- Does NOT live inside the cockpit — it is a sibling route to cockpit, documents, structure, etc.

### Entry Point

Add **"Builder"** as the **first tab** in the DealShell tab array in
`DealShell.tsx`. Position before "Intelligence".

```tsx
// DealShell.tsx — tabs array (updated)
const tabs = [
  { label: "Builder", href: `${base}/builder` },      // ← NEW — first
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

### Data Model Strategy

Two storage layers:

1. **`deal_builder_sections`** — primary key-value store. One row per section
   per deal. `data jsonb` holds all field values for that section. Auto-saved
   on every change via debounced PATCH.

2. **Canonical write-through.** On save, key structured fields are also
   written to their canonical tables so the rest of the system sees them:
   - Business entity name / EIN → `deals.name` (if not already set)
   - Borrowers/owners → `ownership_entities` (upsert by display_name per
     existing `ensureOwnerEntity()` pattern)
   - Story fields → `deal_memo_overrides` (merge PATCH, same pattern as
     Phase 52 Story tab)
   - Loan amount → `deals.loan_amount` (if changed)

   This write-through is best-effort and non-fatal. If the canonical write
   fails, the builder data is still saved to `deal_builder_sections`.

3. **`deal_collateral_items`** — structured collateral rows (one per
   collateral item, not JSONB array inside sections). This allows the
   underwriting engine to query collateral independently.

4. **`deal_proceeds_items`** — structured use-of-proceeds rows (same
   rationale — line-item format).

---

## Database Migration

File: `supabase/migrations/20260320_deal_builder.sql`

### Table 1: `deal_builder_sections`

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

-- RLS: bank-scoped via deals join
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

### Table 2: `deal_collateral_items`

```sql
create table if not exists deal_collateral_items (
  id               uuid        primary key default gen_random_uuid(),
  deal_id          uuid        not null references deals(id) on delete cascade,
  item_type        text        not null,
    -- real_estate | equipment | accounts_receivable | inventory
    -- blanket_lien | vehicle | other
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

### Table 3: `deal_proceeds_items`

```sql
create table if not exists deal_proceeds_items (
  id          uuid        primary key default gen_random_uuid(),
  deal_id     uuid        not null references deals(id) on delete cascade,
  category    text        not null,
    -- equipment | real_estate | working_capital | debt_payoff
    -- acquisition | renovation | other
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

---

## Section Architecture

Six sections. Each has a `section_key` used as the `deal_builder_sections`
lookup key and a set of typed fields stored in `data jsonb`.

---

### Section 1 — The Deal

**section_key:** `deal`  
**Plain-language prompt:** "What are you trying to do?"

| Field | Type | Required | Notes |
|---|---|---|---|
| `loan_purpose` | text | ✅ | Free text — plain language |
| `requested_amount` | numeric | ✅ | Pre-fill from `deals.loan_amount` |
| `loan_type` | enum | ✅ | See values below |
| `desired_term_months` | integer | ✅ | |
| `desired_amortization_months` | integer | — | Defaults to term if blank |
| `target_close_date` | date | — | |
| `referral_source` | text | — | |
| `relationship_manager` | text | — | Pre-fill from Clerk user name |
| `existing_bank_customer` | boolean | — | |

**loan_type enum values:**
`term_loan` | `line_of_credit` | `sba_7a` | `sba_504` | `usda_b_and_i` |
`cre_mortgage` | `ci_loan` | `equipment` | `construction` | `other`

**Completion rule:** `loan_purpose` + `requested_amount` + `loan_type` +
`desired_term_months` = 100%.

---

### Section 2 — The Business

**section_key:** `business`  
**Plain-language prompt:** "Tell us about the company."

| Field | Type | Required | Notes |
|---|---|---|---|
| `legal_entity_name` | text | ✅ | Pre-fill from `deals.name` |
| `dba` | text | — | |
| `ein` | text | — | Store full EIN. Display as XX-XXXXXXX. |
| `entity_type` | enum | ✅ | See values below |
| `state_of_formation` | text | ✅ | |
| `date_formed` | date | — | Derives `years_in_business` client-side |
| `business_address` | text | ✅ | |
| `city` | text | ✅ | |
| `state` | text | ✅ | |
| `zip` | text | ✅ | |
| `phone` | text | — | |
| `website` | text | — | |
| `naics_code` | text | — | Auto-suggest from description |
| `industry_description` | text | — | Derived from NAICS, editable |
| `operations_description` | text | ✅ | Pre-fill from BIE research |
| `employee_count` | integer | — | |
| `seasonal` | boolean | — | |
| `key_customers` | text | — | Concentration risk narrative |

**entity_type enum:** `llc` | `s_corp` | `c_corp` | `partnership` |
`sole_prop` | `trust` | `non_profit` | `other`

**Completion rule:** `legal_entity_name` + `entity_type` +
`state_of_formation` + `business_address` + `city` + `state` + `zip` +
`operations_description` = 100%.

**Buddy pre-fill sources:**
- `deals.name` → `legal_entity_name`
- `deal_financial_facts` where `fact_key = 'ENTITY_TYPE'` → `entity_type`
- BIE narrative `Business Overview` section → `operations_description`

---

### Section 3 — Borrowers / Owners

**section_key:** `borrowers`  
**Plain-language prompt:** "Who owns this business?"

Stored as `data.owners` — a JSON array. Each element is one owner card.

**Owner card fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | ✅ | Client-generated on Add |
| `ownership_entity_id` | uuid | — | FK to `ownership_entities.id` if linked |
| `full_legal_name` | text | ✅ | |
| `ssn_last4` | text | — | Store ONLY last 4 digits. Never store full SSN. |
| `dob` | date | — | |
| `home_address` | text | — | |
| `home_city` | text | — | |
| `home_state` | text | — | |
| `home_zip` | text | — | |
| `ownership_pct` | numeric | ✅ | Validate sum ≤ 100% |
| `title` | text | ✅ | CEO, President, Managing Member, etc. |
| `years_with_company` | integer | — | |
| `credit_auth_obtained` | boolean | — | Flag only — Buddy doesn't store credit data |
| `pfs_document_id` | uuid | — | Link to uploaded PFS document |

**Completion rule:** At least one owner card with `full_legal_name` +
`ownership_pct` + `title` = 100%.

**Buddy pre-fill sources:**
- `ownership_entities` rows for this `deal_id` → one card per entity, mapped
  to `ownership_entity_id` + `full_legal_name` (from `display_name`) +
  `ownership_pct` + `title`

**Canonical write-through on save:**
- For each card with `full_legal_name`, call `ensureOwnerEntity()` pattern:
  upsert `ownership_entities` by `(deal_id, display_name)` with
  `ownership_pct` and `title`. If `ownership_entity_id` is present, use it
  as the conflict key.

**UX:**
- Each owner is a collapsible card. Completed cards show name + ownership %
  in the collapsed header.
- "Add Another Owner" button appends a new blank card.
- Ownership % sum is shown at the bottom. Turns red if > 100%.
- Cards with 100% completion show a green checkmark.

---

### Section 4 — Guarantors

**section_key:** `guarantors`  
**Plain-language prompt:** "Who is guaranteeing this loan?"

Stored as `data.guarantors` — JSON array.

**Guarantor card fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | ✅ | Client-generated |
| `same_as_borrower_id` | uuid | — | If guarantor = owner, link to borrower card id |
| `full_legal_name` | text | ✅ | Auto-filled if same_as_borrower_id set |
| `guaranty_type` | enum | ✅ | full \| limited \| springing \| environmental |
| `guaranty_amount` | numeric | — | Required only if type = limited |
| `net_worth` | numeric | — | From PFS if uploaded |
| `liquid_assets` | numeric | — | From PFS if uploaded |
| `pfs_document_id` | uuid | — | |

**Completion rule:** This section is optional if `data.no_guarantors = true`
(e.g., for certain SBA deals with fee waivers or non-recourse structures).
If guarantors exist, each card needs `full_legal_name` + `guaranty_type`.

**UX:**
- "Same as an owner" shortcut — selecting from a dropdown of borrower cards
  auto-fills name and links the record.
- "No personal guaranty" toggle sets `data.no_guarantors = true` and
  collapses the section with a note.

---

### Section 5 — Structure

**section_key:** `structure`  
**Plain-language prompt:** "How is the deal put together?"

This section has two subsections backed by separate DB tables
(`deal_collateral_items` and `deal_proceeds_items`) plus scalar fields
stored in `deal_builder_sections.data`.

#### 5A — Collateral

Each collateral item is a row in `deal_collateral_items`. The UI renders
them as repeatable cards.

**Collateral card fields:**

| Field | DB Column | Required |
|---|---|---|
| Type | `item_type` | ✅ |
| Description | `description` | ✅ |
| Estimated Value | `estimated_value` | — |
| Lien Position | `lien_position` | ✅ |
| Appraisal Date | `appraisal_date` | — |
| Property Address | `address` | — (real_estate only) |

**item_type display labels:**
- `real_estate` → "Real Estate"
- `equipment` → "Equipment / Machinery"
- `accounts_receivable` → "Accounts Receivable"
- `inventory` → "Inventory"
- `blanket_lien` → "Blanket Business Lien"
- `vehicle` → "Vehicle / Fleet"
- `other` → "Other"

#### 5B — Use of Proceeds

Each line is a row in `deal_proceeds_items`.

**Proceeds line fields:**

| Field | DB Column | Required |
|---|---|---|
| Category | `category` | ✅ |
| Description | `description` | — |
| Amount | `amount` | ✅ |

**category display labels:**
- `equipment` → "Equipment / Machinery"
- `real_estate` → "Real Estate Purchase"
- `working_capital` → "Working Capital"
- `debt_payoff` → "Debt Payoff / Refinance"
- `acquisition` → "Business Acquisition"
- `renovation` → "Leasehold / Renovation"
- `other` → "Other"

Running total is shown below the list. Must equal `requested_amount` ±5%
before this section is marked complete (soft warning, not a blocker).

#### 5C — Scalar Structure Fields (stored in `deal_builder_sections.data`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `equity_injection_amount` | numeric | — | |
| `equity_injection_source` | text | — | |
| `equity_injection_type` | enum | — | cash \| equity_in_property \| seller_note \| other |
| `existing_debt_payoff` | boolean | — | |
| `existing_debt_description` | text | — | If true |
| `deposit_dda` | boolean | — | Primary checking account |
| `deposit_treasury` | boolean | — | Treasury / cash management |
| `deposit_payroll` | boolean | — | Payroll services |
| `deposit_merchant` | boolean | — | Merchant processing |
| `participation_flag` | boolean | — | |
| `participation_details` | text | — | If true |

**Completion rule:** At least one collateral item + at least one proceeds
line + `requested_amount` roughly matches proceeds total.

---

### Section 6 — The Story

**section_key:** `story`  
**Plain-language prompt:** "Help Buddy understand this deal."

All fields stored in `deal_builder_sections.data`. On save, also PATCH to
`deal_memo_overrides` using the same merge pattern as Phase 52.

| Field Key | Memo Override Key | Prompt Label |
|---|---|---|
| `loan_purpose_narrative` | `use_of_proceeds` | "Why does this business need this loan right now?" |
| `management_qualifications` | `principal_background` | "What makes this management team qualified?" |
| `competitive_position` | _(new key)_ `competitive_position` | "What is this business's competitive advantage?" |
| `known_weaknesses` | `key_weaknesses` | "What are the known deal weaknesses and how are they mitigated?" |
| `deal_strengths` | `key_strengths` | "What makes this a strong credit?" |
| `committee_notes` | _(new key)_ `committee_notes` | "Anything else the credit committee should know?" |

**Completion rule:** At least 3 of the 6 fields filled with ≥ 50 characters.

**Buddy pre-fill sources:**
- `deal_memo_overrides` → any fields already set via Phase 52 Story tab
- BIE narrative `Management` section → `management_qualifications` seed
- BIE narrative `Competitive Position` section → `competitive_position` seed
- Pre-filled fields are clearly badged as "✨ Buddy found this — confirm or edit"

---

## Completion Scoring

### Section weights

| Section | Key | Weight | Required Fields |
|---|---|---|---|
| The Deal | `deal` | 20% | 4 fields |
| The Business | `business` | 20% | 8 fields |
| Borrowers | `borrowers` | 20% | 1+ card with 3 fields |
| Guarantors | `guarantors` | 5% | Optional — full credit if no_guarantors=true |
| Structure | `structure` | 20% | 1+ collateral + 1+ proceeds |
| The Story | `story` | 15% | 3+ of 6 fields |

**Overall score** = weighted average of section completion percentages.

### Storage

Completion % per section is stored as `deal_builder_sections.completed`
(boolean) and derived client-side via `builderCompletion.ts`. The overall
score is also surfaced as a fact:

- After save, write `BUILDER_COMPLETION_PCT` to `deal_financial_facts` with
  `source_type = "COMPUTED"`, `confidence = 1.00`.
- The Readiness Panel can read this fact to include Builder completion in
  the overall deal readiness signal.

---

## UI Layout

### Page Layout

```
[DealShell Header + Tab Row]

[Builder Page — full width inside DealShell]
┌─────────────────────────────────────────────────────────────────┐
│  DEAL BUILDER                                    87% Complete   │
│  ████████████████████░░░░  [View Credit Memo]                   │
├───────────────┬─────────────────────────────────────────────────┤
│ SECTION NAV   │  ACTIVE SECTION CONTENT                        │
│               │                                                 │
│ ✅ The Deal   │  [Section heading]                             │
│ ✅ Business   │  [Sub-heading / prompt]                        │
│ ⏳ Borrowers  │                                                 │
│ ○  Guarantors │  [Fields — 1 or 2 column grid]                 │
│ ○  Structure  │                                                 │
│ ○  The Story  │  [Repeatable cards if applicable]              │
│               │                                                 │
│               │  [Completion bar for this section]             │
│               │  [→ Next Section button]                        │
└───────────────┴─────────────────────────────────────────────────┘
```

### Section Nav (left sidebar)

- Fixed position, scrolls with page on mobile (collapses to top tab strip)
- Each section shows:
  - Icon
  - Section name
  - Completion status: green checkmark (done) | amber clock (in progress) |
    gray circle (not started)
  - Completion % in small text
- Active section highlighted
- Clicking any section nav item jumps to that section

### Section Content (right panel)

- One section visible at a time
- Large plain-language heading at top
- Sub-prompt in gray below ("Fill this in so Buddy can...")
- Fields in a responsive 1–2 column grid
- Each field:
  - Plain-language label (bold)
  - Technical label below in gray small text (e.g., "NAICS Code" below
    "Industry")
  - Input / select / date / toggle
  - Buddy-pre-fill badge: ✨ small amber chip "Buddy found this"
  - Auto-save indicator: brief "Saved ✓" flash after debounce
- Repeatable cards (borrowers, guarantors, collateral, proceeds) use
  `RepeatableCard.tsx` — each card expandable/collapsible
- "→ Next Section" button at bottom right of each section
- "← Previous" ghost button at bottom left

### Progress Bar

- Full-width amber/green gradient bar at top of page (below DealShell tabs)
- Shows overall completion %
- Changes to green when ≥ 80% complete

---

## Auto-Save Pattern

```
User types in field
  → field `onChange` updates local React state immediately
  → debounced 800ms → PATCH /api/deals/[dealId]/builder/sections
      body: { section_key: "business", data: { ...fullSectionData } }
  → API: upsert deal_builder_sections ON CONFLICT (deal_id, section_key)
  → API: trigger canonical write-through (non-fatal)
  → Response: { ok: true, updated_at }
  → Client: flash "Saved ✓" for 1.2s on the field or section header
```

No Save button anywhere on the page.

---

## Buddy Pre-Fill

Route: `GET /api/deals/[dealId]/builder/prefill`

Reads from:
1. `deals` — `name`, `loan_amount`, `stage`
2. `ownership_entities` — all rows for deal_id
3. `deal_memo_overrides` — all existing overrides
4. `deal_financial_facts` — `ENTITY_TYPE`, `DATE_FORMED`
5. `buddy_research_narratives` — version 3 (BIE), extract
   `Business Overview`, `Management`, `Competitive Position` sections

Returns a structured `BuilderPrefill` object:

```ts
type BuilderPrefill = {
  deal: Partial<DealSectionData>;
  business: Partial<BusinessSectionData>;
  borrowers: Partial<BorrowerCard>[];
  story: Partial<StorySectionData>;
  sources: Record<string, 'buddy' | 'manual'>;  // field-level source tracking
};
```

The `sources` map is keyed by field path (e.g., `"business.operations_description"`)
and its value tells the UI whether to show the ✨ badge.

Pre-fill is fetched once on page load. If `deal_builder_sections` already
has saved data, it takes priority over pre-fill for that field — pre-fill
only fills blank fields.

---

## Borrower Portal — Dual-Use

### New Route

```
/portal/[dealId]/apply
```

Inside `src/app/(borrower)/portal/[dealId]/apply/`

### Sections shown to borrower

| Section | Borrower sees? | Notes |
|---|---|---|
| The Deal | ❌ | Banker-only (loan terms) |
| The Business | ✅ | All fields |
| Borrowers / Owners | ✅ | Their own card only (filtered by identity) |
| Guarantors | ✅ | All guarantor info |
| Structure | ❌ | Banker-only (collateral, proceeds) |
| The Story | ✅ | 4 of 6 fields (no committee_notes, no known_weaknesses) |

### Same DB — different skin

The borrower portal reads from and writes to the same `deal_builder_sections`,
`deal_collateral_items`, and `deal_proceeds_items` tables. RLS governs
access by bank_id, not by user type — borrower portal auth is handled via
the existing magic-link / portal session pattern.

### Consumer skin differences

| Attribute | Banker Builder | Borrower Portal |
|---|---|---|
| Background | Dark (`#0b0d10`) | White |
| Type scale | Compact | Large / generous padding |
| Field labels | Plain + technical sub-label | Plain language only |
| Help text | Minimal | Contextual tooltips on every field |
| Progress | "87% complete" + section status | "Your application is 87% complete" |
| ✨ Pre-fill badge | Amber "Buddy found this" | Hidden — borrower shouldn't see Buddy |
| SSN field | Last 4 only, masked | Full SSN with confirmation re-entry |
| Navigation | Sidebar nav | Step-by-step wizard (one section per screen) |

### Borrower completion flow

When borrower reaches 100% on their sections, show:
> "✅ Your application information is complete. Your banker has been notified
> and will be in touch shortly."

Trigger a `deal_events` ledger entry: `borrower.application_completed`.

---

## API Routes

### `GET | PATCH /api/deals/[dealId]/builder/sections`

```ts
// GET — load all sections for a deal
// Response: { sections: Record<string, BuilderSectionRow> }

// PATCH — save one section
// Body: { section_key: string; data: Record<string, unknown> }
// Response: { ok: true; updated_at: string }
```

- Upsert `deal_builder_sections` ON CONFLICT (deal_id, section_key)
- After upsert, fire canonical write-through (non-fatal try/catch)
- Do NOT recalculate completion % server-side — keep route fast
- `export const runtime = "nodejs"`
- No `maxDuration` needed (simple DB write, <1s)

### `GET | POST | DELETE /api/deals/[dealId]/builder/collateral`

```ts
// GET — list all collateral items
// Response: { items: CollateralItem[] }

// POST — create a collateral item
// Body: CollateralItemInput
// Response: { item: CollateralItem }

// DELETE /api/deals/[dealId]/builder/collateral/[itemId]
// Response: { ok: true }
```

### `GET | POST | DELETE /api/deals/[dealId]/builder/proceeds`

```ts
// GET — list all proceeds items
// Response: { items: ProceedsItem[] }

// POST — create a proceeds item
// Body: ProceedsItemInput
// Response: { item: ProceedsItem }

// DELETE /api/deals/[dealId]/builder/proceeds/[itemId]
// Response: { ok: true }
```

### `GET /api/deals/[dealId]/builder/prefill`

```ts
// GET — compute Buddy pre-fill for this deal
// Response: BuilderPrefill
```

- Sequential queries (no FK-dependent joins per codebase principle)
- `supabaseAdmin()` — server-only
- `export const runtime = "nodejs"`

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

// Section data shapes (stored in deal_builder_sections.data jsonb)
export type DealSectionData = {
  loan_purpose?: string;
  requested_amount?: number;
  loan_type?: LoanType;
  desired_term_months?: number;
  desired_amortization_months?: number;
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

export type BorrowersSectionData = {
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
};

export type BuilderSections = {
  deal?: DealSectionData;
  business?: BusinessSectionData;
  borrowers?: BorrowersSectionData;
  guarantors?: GuarantorsSectionData;
  structure?: StructureSectionData;
  story?: StorySectionData;
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
  borrowers: Partial<BorrowerCard>[];
  story: Partial<StorySectionData>;
  sources: Record<string, 'buddy' | 'manual'>;
};

export type SectionKey = 'deal' | 'business' | 'borrowers' | 'guarantors' | 'structure' | 'story';

export type SectionCompletion = {
  key: SectionKey;
  label: string;
  pct: number;
  complete: boolean;
};

export type BuilderCompletion = {
  sections: SectionCompletion[];
  overall_pct: number;
};
```

---

## File Manifest

### New Files

#### Pages

| File | Purpose |
|---|---|
| `src/app/(app)/deals/[dealId]/builder/page.tsx` | Server component — loads deal, sections, prefill |
| `src/app/(app)/deals/[dealId]/builder/BuilderPageClient.tsx` | Main client component — layout + state |
| `src/app/(borrower)/portal/[dealId]/apply/page.tsx` | Borrower portal — server component |
| `src/app/(borrower)/portal/[dealId]/apply/ApplyPageClient.tsx` | Borrower portal — client |

#### Components

| File | Purpose |
|---|---|
| `src/components/builder/BuilderShell.tsx` | 2-column layout: sidebar + content |
| `src/components/builder/BuilderSectionNav.tsx` | Left sidebar with section list + progress |
| `src/components/builder/BuilderProgressBar.tsx` | Top-level progress bar |
| `src/components/builder/BuilderField.tsx` | Base field: label + input + Buddy badge + save state |
| `src/components/builder/RepeatableCard.tsx` | Add/remove card pattern |
| `src/components/builder/sections/TheDealSection.tsx` | Section 1 |
| `src/components/builder/sections/TheBusinessSection.tsx` | Section 2 |
| `src/components/builder/sections/BorrowersSection.tsx` | Section 3 |
| `src/components/builder/sections/GuarantorsSection.tsx` | Section 4 |
| `src/components/builder/sections/StructureSection.tsx` | Section 5 (includes collateral + proceeds) |
| `src/components/builder/sections/TheStorySection.tsx` | Section 6 |
| `src/components/builder/borrower/BorrowerBuilderShell.tsx` | Consumer skin wrapper |

#### Library

| File | Purpose |
|---|---|
| `src/lib/builder/builderTypes.ts` | All TypeScript types (see above) |
| `src/lib/builder/builderCompletion.ts` | `computeBuilderCompletion(sections, collateral, proceeds)` |
| `src/lib/builder/builderPrefill.ts` | `loadBuilderPrefill(dealId, sb)` — reads research + ownership + overrides |
| `src/lib/builder/builderCanonicalWrite.ts` | `writeBuilderCanonical(dealId, sectionKey, data, sb)` — non-fatal write-through |

#### API Routes

| File | Purpose |
|---|---|
| `src/app/api/deals/[dealId]/builder/sections/route.ts` | GET + PATCH sections |
| `src/app/api/deals/[dealId]/builder/collateral/route.ts` | GET + POST collateral |
| `src/app/api/deals/[dealId]/builder/collateral/[itemId]/route.ts` | DELETE collateral item |
| `src/app/api/deals/[dealId]/builder/proceeds/route.ts` | GET + POST proceeds |
| `src/app/api/deals/[dealId]/builder/proceeds/[itemId]/route.ts` | DELETE proceeds item |
| `src/app/api/deals/[dealId]/builder/prefill/route.ts` | GET prefill |

#### Migration

| File | Purpose |
|---|---|
| `supabase/migrations/20260320_deal_builder.sql` | 3 tables + RLS + indexes |

### Modified Files

| File | Change |
|---|---|
| `src/app/(app)/deals/[dealId]/DealShell.tsx` | Add "Builder" tab as first tab in tabs array |

---

## Build Sequence

Build in this order to avoid blocked dependencies:

### Step 1 — Migration

Apply `supabase/migrations/20260320_deal_builder.sql`.
Verify: `deal_builder_sections`, `deal_collateral_items`, `deal_proceeds_items`
all exist with correct RLS.

### Step 2 — Types + Library

Create:
- `src/lib/builder/builderTypes.ts`
- `src/lib/builder/builderCompletion.ts`
- `src/lib/builder/builderPrefill.ts`
- `src/lib/builder/builderCanonicalWrite.ts`

No DB reads yet — pure functions only. Confirm `tsc --noEmit` clean.

### Step 3 — API Routes

Create all 6 API routes. Routes must:
- Use `supabaseAdmin()` not `createSupabaseServerClient()`
- Use `export const runtime = "nodejs"`
- Use sequential queries, no FK-dependent joins
- Return typed responses

Smoke-test with curl against `ffcc9733` before proceeding.

### Step 4 — Builder Components (banker skin)

Create in this order:
1. `BuilderField.tsx` (atomic)
2. `RepeatableCard.tsx` (atomic)
3. `BuilderProgressBar.tsx` (atomic)
4. `BuilderSectionNav.tsx` (depends on progress types)
5. `BuilderShell.tsx` (depends on nav)
6. Six section components (depend on shell + field)

Each section component must:
- Accept `data`, `prefill`, `prefillSources`, `onChange` props
- Call `onChange(sectionKey, updatedData)` on any field change
- Not call the API directly — auto-save is handled by `BuilderPageClient`

### Step 5 — Builder Page

Create:
- `src/app/(app)/deals/[dealId]/builder/page.tsx`
  - Server component
  - Fetches deal, all sections, prefill in parallel
  - Passes to `BuilderPageClient`
- `src/app/(app)/deals/[dealId]/builder/BuilderPageClient.tsx`
  - Holds all section state
  - Manages active section
  - Implements debounced auto-save (800ms)
  - Merges prefill into blank fields on mount

### Step 6 — DealShell Tab

In `DealShell.tsx`, add "Builder" as first tab. Confirm active state
highlights correctly when pathname starts with `/deals/[dealId]/builder`.

### Step 7 — Borrower Portal

Create:
- `src/components/builder/borrower/BorrowerBuilderShell.tsx`
- `src/app/(borrower)/portal/[dealId]/apply/page.tsx`
- `src/app/(borrower)/portal/[dealId]/apply/ApplyPageClient.tsx`

Reuse section components from Step 4 — pass `skin="borrower"` prop to
toggle between dark/light styling and hide banker-only fields.

### Step 8 — Canonical Write-Through + Completion Fact

Wire `builderCanonicalWrite.ts` into the sections PATCH route (non-fatal).
After every section save, also write `BUILDER_COMPLETION_PCT` to
`deal_financial_facts`.

### Step 9 — tsc Clean + Smoke Test

- `tsc --noEmit` must pass with zero errors
- Smoke test: load Builder on `ffcc9733`
  - Pre-fill should show entity name + owner cards
  - Type in a field → confirm auto-save fires → confirm DB row updated
  - Check "Builder" tab appears and highlights correctly in DealShell

---

## Key Implementation Constraints

1. **Never store full SSN.** Section 3 `ssn_last4` is the only SSN-related
   field. Store exactly 4 characters. No exceptions.

2. **EIN display vs storage.** Store full EIN (9 digits) in `ein` field.
   Display as `XX-XXXXXXX` with only last 4 visible. Never log the full EIN.

3. **Ownership entity write-through uses existing pattern.** When saving
   Section 3, use the same `ensureOwnerEntity()` upsert pattern introduced
   in Phase 49. Conflict key is `(deal_id, display_name)`. The `id` field
   on the borrower card is a client-local UUID until it is linked to a real
   `ownership_entity_id` via write-through.

4. **Story fields must merge into `deal_memo_overrides`.** Use the
   sequential select-then-update/insert pattern from Phase 52. Never replace
   the full JSONB — always merge. Two new keys are added:
   `competitive_position` and `committee_notes`.

5. **Prefill takes no precedence over existing builder data.** If
   `deal_builder_sections` has a value for a field, display that value.
   Only display prefill for fields that are null/empty in builder sections.

6. **Proceeds total mismatch is a warning, not a blocker.** If proceeds
   total differs from `requested_amount` by more than 5%, show an amber
   warning banner in Section 5. Never block save.

7. **RepeatableCard add/remove must be instant.** Card adds/removes update
   local state immediately. The full section data (including the updated
   cards array) is then auto-saved via the debounced PATCH. Never make an
   API call per card operation — always save the full section array.

8. **CSS skin rule.** Banker Builder uses the existing dark theme
   (`bg-[#0b0d10]`, `text-white`). Borrower portal uses `bg-white`,
   `text-gray-900`. Per the known build principle: always set
   `text-gray-900 bg-white placeholder-gray-400` explicitly on every
   `<input>` and `<textarea>` in the borrower skin.

---

## Definition of Done

- [ ] Migration applied — 3 tables exist with RLS
- [ ] All 6 API routes return correct responses for deal `ffcc9733`
- [ ] "Builder" tab appears first in DealShell, highlights on active route
- [ ] Builder page loads for `ffcc9733` with Buddy pre-fill visible:
  - Entity name pre-filled in Section 2
  - Owner cards pre-filled from `ownership_entities` in Section 3
  - Story fields pre-filled from existing `deal_memo_overrides` in Section 6
- [ ] Auto-save fires on field change, "Saved ✓" appears, DB row updated
- [ ] Repeatable cards (borrowers, collateral, proceeds) add/remove correctly
- [ ] Overall completion % renders correctly in progress bar
- [ ] Story section save also writes to `deal_memo_overrides` (merge, not replace)
- [ ] Canonical write-through writes to `ownership_entities` on borrower save
- [ ] `BUILDER_COMPLETION_PCT` written to `deal_financial_facts` after save
- [ ] Borrower portal `/portal/[dealId]/apply` renders with white skin,
  shows only borrower-facing sections, wizard-style navigation
- [ ] `tsc --noEmit` zero errors
- [ ] No `console.error` in browser on load or save

---

## Roadmap Impact

Phase 53 completes **God Tier item #65** (Borrower Intake wired) and
establishes the data foundation for:
- Credit memo auto-population from builder fields (replaces wizard)
- Model Engine V2 can read `loan_type` and `entity_type` from builder
- Completeness scoring in Readiness Panel includes builder data
- Borrower-facing portal replaces the current ad hoc portal flows
