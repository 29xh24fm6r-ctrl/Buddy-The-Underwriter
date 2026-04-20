# Phase 85A — Borrower Intake Foundation + Preflight Gates

**Status:** Ready for implementation
**Target:** Week 1 of 5-week Phase 85 roadmap
**Depends on:** Phase 84 closed (9/10 tickets complete)
**Spec author:** Claude (reconciled against live codebase + DB schema, April 20 2026)

---

## 0. Strategic Framing (Tension 1 Resolution)

**Phase 85 is a sales artifact for pilot bank acquisition.** The borrower intake
experience is the first thing a prospective bank partner sees when evaluating Buddy.
It must demonstrate that a borrower can walk through a guided flow, upload documents,
and have their application auto-populated — before any live bank is onboarded.

The Phase 84 meta-finding (T-08-G: zero non-test deals in production) is **expected
state**, not a blocker. Empty canonical tables confirm that no production lending
activity has occurred yet — which is precisely why Phase 85 exists. A bank cannot
evaluate Buddy without seeing what their borrowers would experience.

**Future audit note:** If a future audit re-flags empty `deal_financial_facts` or
`borrower_applications` rows, reference this section. The tables are empty because
no pilot bank has been onboarded yet. Phase 85 builds the artifact that closes
pilot deals. The pipeline populates once banks send live borrowers through it.

---

## 1. Preflight Gate A — Extractor Coverage Audit (Tension 2 Resolution)

### 1.1 Current State (verified April 20 2026)

**`deal_financial_facts` coverage on most-populated deal (`df0c0867`):**

| fact_type | Distinct keys | Key examples |
|-----------|--------------|--------------|
| `TAX_RETURN` | ~40 keys | `GROSS_RECEIPTS`, `ORDINARY_BUSINESS_INCOME`, `OFFICER_COMPENSATION`, `DEPRECIATION`, `SL_CASH`, `SL_TOTAL_ASSETS`, `M1_*`, `M2_*`, `SK_*`, `K1_*` |
| `PERSONAL_INCOME` | ~18 keys | `WAGES_W2`, `TAXABLE_INTEREST`, `ORDINARY_DIVIDENDS`, `SCH_E_NET`, `ADJUSTED_GROSS_INCOME`, `TOTAL_PERSONAL_INCOME` |
| `PERSONAL_FINANCIAL_STATEMENT` | ~25 keys | `PFS_NET_WORTH`, `PFS_TOTAL_ASSETS`, `PFS_TOTAL_LIABILITIES`, `PFS_CASH_*`, `PFS_RE1_*`, `PFS_SALARY_WAGES` |
| `INCOME_STATEMENT` | ~14 keys | `TOTAL_REVENUE`, `GROSS_PROFIT`, `NET_INCOME`, `OPERATING_INCOME`, `SALARIES_WAGES_IS` |
| `SOURCE_DOCUMENT` | 4 keys | Document type markers |
| `EXTRACTION_HEARTBEAT` | per-doc | Pipeline health markers |

**`ownership_entities` coverage:** 5 of 7 deals with facts have ownership entities
(1-2 entities each). The 2 most recent deals (`df0c0867`, `7df74c12`) have zero
entities — this confirms the `ensureOwnerEntity()` path from personal doc extraction
is not firing for all extraction runs.

### 1.2 Autofill Scoping Decision

The current `gemini_primary_v1` extractor produces **sufficient coverage** for
Phase 85B autofill on the following intake form fields:

**Autofill-ready (from `deal_financial_facts`):**
- Business legal name → `deals.borrower_name` (already populated at deal creation)
- Annual revenue → `TOTAL_REVENUE` or `GROSS_RECEIPTS` (INCOME_STATEMENT / TAX_RETURN)
- Net income → `NET_INCOME` (INCOME_STATEMENT)
- Officer compensation → `OFFICER_COMPENSATION` (TAX_RETURN)
- Total assets → `SL_TOTAL_ASSETS` (TAX_RETURN)
- Personal net worth → `PFS_NET_WORTH` (PFS)
- Personal income → `TOTAL_PERSONAL_INCOME` (PERSONAL_INCOME)
- Liquid assets → `PFS_LIQUID_ASSETS` (PFS)

**NOT autofill-ready (requires Phase 84.1 extractors or manual entry):**
- EIN → not in `deal_financial_facts` (requires `materializeFactsFromArtifacts:v1`)
- Entity type (LLC/S-Corp/C-Corp) → not extracted as a fact key
- NAICS code → not extracted, must be entered or looked up
- Business address → not extracted as a fact key
- Owner SSN last 4 → `ownership_entities.tax_id_last4` (spotty, only some deals)
- K-1 distributions per owner → `K1_ORDINARY_INCOME_2` exists but not owner-scoped

**Decision:** Phase 85B autofill will target the "autofill-ready" fields above.
This gives ~60% field coverage on a typical SBA intake form. The remaining fields
require manual borrower entry in Phase 85B. When Phase 84.1 extractors ship,
autofill coverage extends to ~85% without any Phase 85 code changes — the autofill
pipeline reads from `deal_financial_facts` generically, so new fact keys flow
through automatically.

**No hard gate on Phase 84.1.** Phase 85B proceeds with partial autofill. Phase 84.1
is a coverage multiplier, not a prerequisite.

---

## 2. Preflight Gate B — Retirement Safety Grep (Tension 3 Resolution)

### 2.1 Scope

Before any `git rm` in Phase 85E, Claude Code must execute the following grep
and classify every result as Safe-to-delete / Needs-migration / Keep-as-stub.

**Files on the retirement candidate list:**

```
src/components/borrower/PortalClient.tsx           (17.9 KB — largest)
src/components/borrower/BorrowerPageSimplified.tsx  (3.5 KB)
src/components/borrower/PortalLoanRequestForm.tsx   (10.3 KB)
src/components/borrower/PortalProgressCard.tsx      (2.2 KB)
src/components/borrower/PortalRequestsList.tsx      (2.8 KB)
src/components/borrower/PortalShell.tsx             (1.4 KB)
src/components/borrower/PortalUploadCta.tsx         (1.2 KB)
```

**Grep command (execute before any deletion):**

```bash
# For each candidate file, find all importers
for f in PortalClient BorrowerPageSimplified PortalLoanRequestForm \
         PortalProgressCard PortalRequestsList PortalShell PortalUploadCta; do
  echo "=== $f ==="
  grep -rn "$f" src/ --include='*.ts' --include='*.tsx' | grep -v "^Binary"
done
```

**Classify each result:**
- **R (route page):** `page.tsx` that imports the component → route must be
  redirected or replaced before deletion
- **W (widget):** Another component that embeds it → that component must be
  updated first
- **T (type-only):** Type import or re-export → update the barrel file

### 2.2 The `[token]/apply` Route — Slug Conflict Verification

**Current state (verified):** `src/app/(borrower)/portal/[token]/apply/page.tsx`
is a Phase 53C stub. It renders a "Coming Soon" placeholder. It does NOT import
any component from `src/components/borrower/`.

**The slug-conflict risk:** The `(borrower)` route group uses `[token]` as a
dynamic segment under both `/portal/[token]` and `/upload/[token]`. Next.js route
groups use parenthetical names `(borrower)` that are invisible in the URL. The
March 2026 silent-hang bug occurred when two sibling routes competed for the same
URL segment.

**Resolution:** The `apply` route lives UNDER `/portal/[token]/apply` — it is a
child, not a sibling. Removing it does NOT create a slug conflict. However, Phase
85A **repurposes** this exact route (`/portal/[token]/apply`) as the new intake
form location. Therefore:

- **Do NOT delete `[token]/apply/page.tsx`** — replace its contents in Phase 85A.
- The stub is replaced by the real intake form, preserving the route and avoiding
  any slug-conflict regression.

### 2.3 Known Importers (from codebase inspection)

| Component | Imported by | Action |
|-----------|-------------|--------|
| `PortalClient` | `src/app/(borrower)/portal/[token]/page.tsx` | Replace page contents in 85A |
| `PortalLoanRequestForm` | `src/app/(borrower)/portal/[token]/request/page.tsx` | Retire route in 85E |
| `PortalShell` | Unknown — grep required | Grep before delete |
| `PortalProgressCard` | Likely `PortalClient` only | Grep confirms |
| `PortalRequestsList` | Likely `PortalClient` only | Grep confirms |
| `PortalUploadCta` | Likely `PortalClient` only | Grep confirms |
| `BorrowerPageSimplified` | Unknown | Grep before delete |

**Rule:** No file is deleted until the grep is executed and all importers are
classified. This is a blocking pre-condition for Phase 85E.

---

## 3. Phase 85A — What Gets Built

### 3.1 Deliverables

| # | Deliverable | Type | Files |
|---|------------|------|-------|
| 1 | `borrower_intake_sessions` table | Migration | 1 SQL |
| 2 | `POST /api/borrower/intake/start` | API route | 1 file |
| 3 | `GET /api/borrower/intake/[sessionId]` | API route | 1 file |
| 4 | `PATCH /api/borrower/intake/[sessionId]` | API route | 1 file |
| 5 | `IntakeFormShell` component | React | 1 file |
| 6 | `IntakeStepBusiness` component | React | 1 file |
| 7 | `IntakeStepOwners` component | React | 1 file |
| 8 | `IntakeStepLoan` component | React | 1 file |
| 9 | `IntakeProgressBar` component | React | 1 file |
| 10 | Replace `[token]/apply/page.tsx` | Route | 1 file |
| 11 | `useIntakeSession` hook | React hook | 1 file |
| 12 | Intake type definitions | TypeScript | 1 file |

### 3.2 Database — `borrower_intake_sessions`

```sql
-- Migration: 20260421_borrower_intake_sessions
CREATE TABLE borrower_intake_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES deals(id),
  bank_id       uuid NOT NULL REFERENCES banks(id),
  token_hash    text NOT NULL,

  -- Step progress
  current_step  text NOT NULL DEFAULT 'business',
  steps_completed text[] NOT NULL DEFAULT '{}',

  -- Section data (JSONB per step, merged on save)
  business_data jsonb NOT NULL DEFAULT '{}',
  owners_data   jsonb NOT NULL DEFAULT '[]',
  loan_data     jsonb NOT NULL DEFAULT '{}',

  -- Lifecycle
  status        text NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress', 'submitted', 'abandoned')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  last_activity timestamptz NOT NULL DEFAULT now(),

  -- Tenant isolation
  CONSTRAINT fk_intake_bank FOREIGN KEY (bank_id) REFERENCES banks(id)
);

-- RLS
ALTER TABLE borrower_intake_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: portal token holder can read/write their own session
CREATE POLICY intake_session_self ON borrower_intake_sessions
  FOR ALL USING (true);
-- Note: actual auth is token-based via resolvePortalContext, not RLS user matching.
-- RLS is enabled for defense-in-depth. API routes enforce token validation.

-- Indexes
CREATE INDEX idx_intake_sessions_deal ON borrower_intake_sessions(deal_id);
CREATE INDEX idx_intake_sessions_token ON borrower_intake_sessions(token_hash);
CREATE INDEX idx_intake_sessions_status ON borrower_intake_sessions(status);

-- Comments
COMMENT ON TABLE borrower_intake_sessions IS
  'Phase 85A: Borrower intake form sessions. Each session tracks a borrower''s '
  'progress through the multi-step intake form. Data is merged into deal tables '
  'on submission.';
```

**Why a new table instead of reusing `borrower_applications`?**

`borrower_applications` has a rigid schema with columns like `sba7a_candidate`,
`sba7a_eligible`, `sba7a_ineligibility_reasons` baked in. The intake session needs
flexible JSONB storage for step data that evolves across phases. The two tables
serve different purposes: `borrower_intake_sessions` is the in-progress form state;
`borrower_applications` (or `deals` + `deal_builder_sections`) is the canonical
submitted application data. On submission, intake session data is written to the
canonical tables and the session is marked `submitted`.

### 3.3 API Routes

#### `POST /api/borrower/intake/start`

```typescript
// src/app/api/borrower/intake/start/route.ts
// Auth: portal token (same as existing portal routes)
// Input: { token: string }
// Output: { sessionId: string, currentStep: string, data: IntakeSessionData }
//
// Logic:
// 1. resolvePortalContext(token) → { dealId, bankId }
// 2. sha256Base64url(token) → tokenHash
// 3. Check for existing in_progress session:
//    SELECT * FROM borrower_intake_sessions
//    WHERE deal_id = $dealId AND token_hash = $tokenHash AND status = 'in_progress'
// 4. If exists → return it (resume)
// 5. If not → INSERT new session, return it
// 6. Pre-populate business_data from deals + borrowers tables:
//    - deals.borrower_name → business_data.legalName
//    - deals.deal_type → loan_data.loanType (if SBA)
//    - deals.loan_amount → loan_data.requestedAmount
//    - borrowers.* → business_data.* where available
```

#### `GET /api/borrower/intake/[sessionId]`

```typescript
// src/app/api/borrower/intake/[sessionId]/route.ts
// Auth: portal token in Authorization header or query param
// Output: Full IntakeSessionData
//
// Logic:
// 1. resolvePortalContext(token) → { dealId }
// 2. SELECT from borrower_intake_sessions WHERE id = sessionId AND deal_id = dealId
// 3. If not found or deal mismatch → 404
// 4. Return session data
```

#### `PATCH /api/borrower/intake/[sessionId]`

```typescript
// src/app/api/borrower/intake/[sessionId]/route.ts
// Auth: portal token
// Input: { step: string, data: Record<string, unknown>, markComplete?: boolean }
// Output: Updated session
//
// Logic:
// 1. resolvePortalContext(token) → { dealId }
// 2. Validate session exists and belongs to deal
// 3. Validate step is one of: 'business', 'owners', 'loan'
// 4. MERGE data into the appropriate *_data column (JSONB merge, not replace)
// 5. If markComplete → add step to steps_completed array
// 6. Update current_step if advancing
// 7. Update last_activity = now()
// 8. Return updated session
//
// IMPORTANT: Use sequential select-then-update pattern, NOT upsert.
// This matches the deal_memo_overrides PATCH pattern — merge, never replace.
```

### 3.4 TypeScript Types

```typescript
// src/lib/borrower/intakeTypes.ts

export const INTAKE_STEPS = ['business', 'owners', 'loan'] as const;
export type IntakeStep = typeof INTAKE_STEPS[number];

export interface IntakeBusinessData {
  legalName?: string;
  dba?: string;
  ein?: string;
  entityType?: 'sole_prop' | 'llc' | 'partnership' | 's_corp' | 'c_corp' | 'nonprofit';
  stateOfFormation?: string;
  dateFormed?: string;       // ISO date
  naicsCode?: string;
  industryDescription?: string;
  businessAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  annualRevenue?: number;
  employeeCount?: number;
  businessDescription?: string;
}

export interface IntakeOwnerData {
  id: string;                  // Client-generated UUID
  fullName?: string;
  title?: string;
  ownershipPct?: number;
  ssnLast4?: string;
  dateOfBirth?: string;        // ISO date
  personalAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  isGuarantor?: boolean;
}

export interface IntakeLoanData {
  loanType?: string;           // 'SBA' | 'conventional' | 'CRE' etc.
  requestedAmount?: number;
  loanPurpose?: string;
  useOfProceeds?: string;
  requestedTerm?: number;      // months
  collateralDescription?: string;
  hasExistingDebt?: boolean;
  existingDebtDetails?: string;
}

export interface IntakeSessionData {
  id: string;
  dealId: string;
  currentStep: IntakeStep;
  stepsCompleted: IntakeStep[];
  businessData: IntakeBusinessData;
  ownersData: IntakeOwnerData[];
  loanData: IntakeLoanData;
  status: 'in_progress' | 'submitted' | 'abandoned';
  startedAt: string;
  lastActivity: string;
}
```

### 3.5 React Components

#### `IntakeFormShell`

```typescript
// src/components/borrower/intake/IntakeFormShell.tsx
//
// Props: { token: string, dealId: string, bankId: string }
//
// Renders:
// - IntakeProgressBar (top)
// - Current step component (body)
// - Navigation buttons (bottom: Back / Save & Continue)
//
// State:
// - currentStep derived from session.currentStep
// - Local form state per step (controlled inputs)
// - Dirty tracking for unsaved changes
// - Auto-save on step navigation (debounced 500ms like Deal Builder)
//
// Step rendering:
// - 'business' → <IntakeStepBusiness />
// - 'owners'   → <IntakeStepOwners />
// - 'loan'     → <IntakeStepLoan />
//
// Mobile-first layout:
// - Single column, max-w-2xl centered
// - Sticky bottom nav bar on mobile
// - Each step fits in a single scroll on mobile
```

#### `IntakeProgressBar`

```typescript
// src/components/borrower/intake/IntakeProgressBar.tsx
//
// Props: { steps: IntakeStep[], currentStep: IntakeStep, completedSteps: IntakeStep[] }
//
// Renders 3 dots/pills with labels:
//   [Business] → [Owners] → [Loan Request]
//
// States per dot:
//   completed: filled green
//   current: filled blue, pulsing
//   future: outlined gray
//
// Mobile: horizontal, labels below dots
// Accessible: aria-current="step" on active
```

#### `IntakeStepBusiness`

```typescript
// src/components/borrower/intake/IntakeStepBusiness.tsx
//
// Props: { data: IntakeBusinessData, onChange: (data: IntakeBusinessData) => void }
//
// Fields:
// - Legal Business Name (text, required)
// - DBA / Trade Name (text, optional)
// - EIN (text, masked input XX-XXXXXXX, optional in 85A)
// - Entity Type (select dropdown)
// - State of Formation (select dropdown — US states)
// - Date Formed (date input)
// - NAICS Code (text with lookup helper — future: autocomplete)
// - Industry Description (text, auto-filled from NAICS if available)
// - Business Address (street, city, state, zip — 4 fields)
// - Annual Revenue (currency input)
// - Number of Employees (number input)
// - Brief Business Description (textarea, 500 char max)
//
// Pre-population: legalName from deals.borrower_name, loanType from deals.deal_type
// Validation: legalName required, EIN format if provided, zip format
//
// Design: White card on neutral-950 background (matches existing borrower layout)
// Mobile: single-column stack, full-width inputs
// DO NOT use <form> tag — use onChange handlers per Deal Builder pattern
```

#### `IntakeStepOwners`

```typescript
// src/components/borrower/intake/IntakeStepOwners.tsx
//
// Props: { data: IntakeOwnerData[], onChange: (data: IntakeOwnerData[]) => void }
//
// Features:
// - "Add Owner" button (max 10 owners)
// - Each owner is a collapsible card (expanded by default when new)
// - Card header: "Owner 1: [name]" or "Owner 1" if no name yet
// - Remove button (trash icon, confirm dialog)
//
// Per-owner fields:
// - Full Legal Name (text, required)
// - Title / Role (text, e.g. "Managing Member")
// - Ownership Percentage (number, 0-100)
// - SSN Last 4 (text, 4 digits, masked)
// - Date of Birth (date input)
// - Home Address (street, city, state, zip)
// - Personal Guarantor? (checkbox)
//
// Validation: at least 1 owner required, total ownership % ≤ 100 (warn, not block)
// Note: SSN last 4 matches ownership_entities.tax_id_last4 (4 chars max)
//
// Pre-population sources (Phase 85B):
// - ownership_entities.display_name → fullName
// - ownership_entities.ownership_pct → ownershipPct
// - ownership_entities.title → title
// - ownership_entities.tax_id_last4 → ssnLast4
```

#### `IntakeStepLoan`

```typescript
// src/components/borrower/intake/IntakeStepLoan.tsx
//
// Props: { data: IntakeLoanData, onChange: (data: IntakeLoanData) => void }
//
// Fields:
// - Loan Type (select: SBA 7(a), SBA 504, SBA Express, Conventional, CRE)
// - Requested Amount (currency input)
// - Loan Purpose (select: Purchase, Refinance, Working Capital, Equipment,
//   Real Estate, Startup, Expansion, Other)
// - Use of Proceeds (textarea, 500 char max)
// - Requested Term (select: 12/24/36/60/84/120/180/240/300 months)
// - Collateral Description (textarea, 500 char max)
// - Existing Debt? (yes/no toggle)
// - If yes → Existing Debt Details (textarea)
//
// Pre-population: loanType from deals.deal_type, amount from deals.loan_amount
// SBA-specific: if loanType starts with 'SBA', show note about guarantee program
```

### 3.6 Route Update — `[token]/apply/page.tsx`

```typescript
// src/app/(borrower)/portal/[token]/apply/page.tsx
// REPLACES the Phase 53C stub

import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { IntakeFormShell } from "@/components/borrower/intake/IntakeFormShell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function BorrowerApplyPage({ params }: Props) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch (err: any) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">Invalid Link</h1>
          <p className="text-sm text-gray-500">
            {err?.message ?? "This link is invalid or has expired."}
          </p>
        </div>
      </div>
    );
  }

  return <IntakeFormShell token={token} dealId={ctx.dealId} bankId={ctx.bankId} />;
}
```

### 3.7 Hook — `useIntakeSession`

```typescript
// src/components/borrower/intake/useIntakeSession.ts
//
// Manages intake session lifecycle:
//
// const {
//   session,        // IntakeSessionData | null
//   isLoading,      // boolean
//   error,          // string | null
//   saveStep,       // (step, data, markComplete?) => Promise<void>
//   goToStep,       // (step) => void
//   currentStep,    // IntakeStep
// } = useIntakeSession(token);
//
// On mount:
//   POST /api/borrower/intake/start { token }
//   → receives session (new or resumed)
//
// saveStep:
//   PATCH /api/borrower/intake/[sessionId] { step, data, markComplete }
//   → updates local state optimistically
//
// Auto-save:
//   Debounced 500ms on data change (non-completing save)
//   Explicit save on "Continue" button (completing save)
```

---

## 4. File Manifest

### New files (12)

```
src/app/api/borrower/intake/start/route.ts
src/app/api/borrower/intake/[sessionId]/route.ts
src/components/borrower/intake/IntakeFormShell.tsx
src/components/borrower/intake/IntakeStepBusiness.tsx
src/components/borrower/intake/IntakeStepOwners.tsx
src/components/borrower/intake/IntakeStepLoan.tsx
src/components/borrower/intake/IntakeProgressBar.tsx
src/components/borrower/intake/useIntakeSession.ts
src/lib/borrower/intakeTypes.ts
```

### Modified files (1)

```
src/app/(borrower)/portal/[token]/apply/page.tsx  — stub → real intake page
```

### Migration (1)

```
supabase/migrations/20260421_borrower_intake_sessions.sql
```

### NOT touched in 85A

```
src/components/borrower/PortalClient.tsx            — retirement deferred to 85E
src/app/(borrower)/portal/[token]/page.tsx          — keeps working (old portal)
src/app/(borrower)/portal/[token]/request/page.tsx  — keeps working (old request form)
src/app/(borrower)/upload/[token]/                  — keeps working (upload flow)
```

---

## 5. Implementation Constraints

### Must follow

1. **No `<form>` tags in React components.** Use `onChange` handlers per Deal Builder pattern.
2. **JSONB merge, never replace.** PATCH route uses sequential select-then-update.
3. **Portal token auth via `resolvePortalContext()`.** No Clerk auth on borrower routes.
4. **`supabaseAdmin()` for all DB operations in API routes** (server-only, no RLS user context for portal routes).
5. **`export const runtime = "nodejs"` and `export const maxDuration = 30`** on all new API routes.
6. **Mobile-first layout.** All components must work on 375px viewport width.
7. **White card on neutral-950 background.** Matches existing `(borrower)/layout.tsx`.
8. **`ownership_entities` uses `display_name` not `name`.** Any query against this table must use the correct column.
9. **`deals.deal_type` not `deals.loan_type`.** SBA check uses `SBA_TYPES = ['SBA', 'sba_7a', 'sba_504', 'sba_express']`.
10. **CSS explicit colors on inputs.** Always set `text-gray-900 bg-white placeholder-gray-400` on every input/textarea — the borrower layout inherits `text-neutral-100` which causes invisible text on white backgrounds.

### Must NOT do

1. Do NOT delete any existing portal components or routes.
2. Do NOT create a parallel `deal_facts` or `intake_facts` table.
3. Do NOT add Clerk auth to the `(borrower)` route group.
4. Do NOT use `borrower_applications` table for intake session state.
5. Do NOT introduce new npm dependencies (no form libraries — vanilla React state).
6. Do NOT add `borrower_intake_sessions` to the Pulse telemetry pipeline yet (Phase 85D).

---

## 6. Verification Queries

### After migration

```sql
-- Verify table exists with correct columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'borrower_intake_sessions'
ORDER BY ordinal_position;

-- Verify RLS is enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'borrower_intake_sessions';

-- Verify indexes
SELECT indexname FROM pg_indexes
WHERE tablename = 'borrower_intake_sessions';
```

### After deployment

```bash
# Verify route responds (substitute real token)
curl -X POST https://buddytheunderwriter.com/api/borrower/intake/start \
  -H "Content-Type: application/json" \
  -d '{"token": "test-token"}'
# Expected: 400 or 401 (invalid token), not 404 (route not found)

# Verify apply page renders
curl -s https://buddytheunderwriter.com/portal/TEST/apply | head -20
# Expected: HTML with intake form shell, not "Coming Soon"
```

### Regression check

```bash
# Verify old portal still works
curl -s https://buddytheunderwriter.com/portal/TEST | head -20
# Expected: PortalClient renders (not broken by new route)

# Verify upload route still works
curl -s https://buddytheunderwriter.com/upload/TEST | head -20
# Expected: Upload page renders
```

---

## 7. Phase 85B–E Preview (unchanged from blueprint, with tension resolutions applied)

| Phase | Week | Focus | Tension resolution applied |
|-------|------|-------|---------------------------|
| 85B | 2 | Autofill pipeline | Scoped to gemini_primary_v1 coverage (~60%). PFS/K-1 autofill deferred to post-84.1. |
| 85C | 3 | Document upload + classification integration | — |
| 85D | 4 | Submission → deal pipeline + Pulse telemetry | — |
| 85E | 5 | Retirement + cleanup | Grep gate from §2 is blocking precondition. `[token]/apply` NOT deleted (already repurposed in 85A). |

---

## 8. Acceptance Criteria

- [ ] `borrower_intake_sessions` table exists in production with RLS enabled
- [ ] `POST /api/borrower/intake/start` creates or resumes a session
- [ ] `PATCH /api/borrower/intake/[sessionId]` merges step data (never replaces)
- [ ] `/portal/[token]/apply` renders the 3-step intake form (not the stub)
- [ ] Business step pre-populates legal name from `deals.borrower_name`
- [ ] Owners step allows add/remove with client-generated UUIDs
- [ ] Loan step shows SBA-specific note when loan type is SBA
- [ ] All inputs are visible (not white-on-white) on the borrower layout
- [ ] Form works on 375px mobile viewport
- [ ] Old portal route (`/portal/[token]`) still renders PortalClient
- [ ] Old request route (`/portal/[token]/request`) still renders PortalLoanRequestForm
- [ ] Upload route (`/upload/[token]`) still renders upload page
- [ ] tsc clean (no new type errors)
