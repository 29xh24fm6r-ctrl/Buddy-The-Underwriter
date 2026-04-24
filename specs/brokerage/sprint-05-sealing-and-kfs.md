# Sprint 5 — Package Sealing + Key Facts Summary + Borrower Redaction

**Status:** Specification — ready for implementation
**Depends on:** Sprint 0 (score), Sprint 3 (trident previews), Sprint 4 (LMA + audit log)
**Blocks:** Sprint 6 (marketplace needs sealed packages with KFS)
**References:** [brokerage-master-plan.md](./brokerage-master-plan.md) §6

---

## Purpose

Three things:

1. **Package sealing** — a one-way borrower action that freezes the deal state, finalizes the Buddy SBA Score, and commits the package to be listed on the next marketplace preview cycle.
2. **Key Facts Summary (KFS)** — a one-page borrower-redacted listing view that lenders see during preview and claim. Built deterministically from the sealed deal.
3. **Redaction engine** — a pure function that transforms full deal data into the marketplace-safe KFS shape, stripping all borrower-identifying fields.

---

## What "sealing" does

When a borrower clicks "Seal my package" in the portal:

1. **Gate checks:** Buddy SBA Score ≥ 60 (otherwise ineligible); all required facts present (gap queue empty for sealing-critical items); SOP 50 10 7.1 eligibility passed; at least one preview trident bundle exists.
2. **Snapshot immutably:** create `buddy_sealed_packages` row with a frozen snapshot of all deal data at the time of sealing. Future changes to the deal do not change the sealed snapshot.
3. **Generate KFS:** run the redactor on the sealed snapshot, persist `marketplace_listings` row in `pending_preview` state.
4. **Schedule:** compute `preview_opens_at` (next 9am CT) and `claim_opens_at` (24 hours later) and persist. Weekend handling per master plan §4.
5. **Borrower portal changes state** — deal enters "Listed" status, portal shows "Your deal previews at 9am CT on [date] and claims open at 9am CT on [next date]."

Sealing is reversible until `preview_opens_at` — borrower can un-seal to make changes. After preview opens, sealing is locked.

---

## Database

### Migration: `supabase/migrations/20260429_sealing_and_listings.sql`

```sql
-- ============================================================================
-- Sprint 5: Package Sealing + Marketplace Listings + Key Facts Summary
-- ============================================================================

-- 1) Sealed packages — immutable snapshot at seal time.
CREATE TABLE IF NOT EXISTS public.buddy_sealed_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  -- Immutable snapshot payload — everything needed to reconstruct the package.
  sealed_snapshot jsonb NOT NULL,

  -- Storage paths for final-mode PDFs (generated at pick, not seal)
  final_business_plan_path text,
  final_projections_path text,
  final_feasibility_path text,
  final_credit_memo_path text,
  final_forms_path text,
  final_source_docs_zip_path text,

  sealed_at timestamptz NOT NULL DEFAULT now(),
  unsealed_at timestamptz,
  unseal_reason text,

  CONSTRAINT sealed_packages_one_active_per_deal
    EXCLUDE (deal_id WITH =) WHERE (unsealed_at IS NULL)
);

CREATE INDEX buddy_sealed_packages_deal_id_idx ON public.buddy_sealed_packages (deal_id);
CREATE INDEX buddy_sealed_packages_sealed_at_idx ON public.buddy_sealed_packages (sealed_at);

ALTER TABLE public.buddy_sealed_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY sealed_packages_select_for_bank_members
  ON public.buddy_sealed_packages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = buddy_sealed_packages.bank_id AND m.user_id = auth.uid()
  ));

-- 2) Marketplace listings — public-face of a sealed deal.
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sealed_package_id uuid NOT NULL REFERENCES public.buddy_sealed_packages(id),
  deal_id uuid NOT NULL REFERENCES public.deals(id),

  -- Redacted Key Facts Summary data.
  kfs jsonb NOT NULL,

  -- Buddy SBA Score snapshot (also embedded in kfs, but denormalized for queries).
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  band text NOT NULL,

  -- Rate card anchor at time of listing.
  rate_card_tier text NOT NULL,
  published_rate_bps integer NOT NULL,   -- rate_card[band][program][term_tier]
  sba_program text NOT NULL,
  loan_amount numeric NOT NULL,
  term_months integer NOT NULL,

  -- Matched lender set, snapshotted at sealing.
  matched_lender_bank_ids uuid[] NOT NULL DEFAULT '{}',

  -- Cadence timestamps.
  preview_opens_at timestamptz NOT NULL,
  claim_opens_at timestamptz NOT NULL,
  claim_closes_at timestamptz NOT NULL,

  -- State machine.
  status text NOT NULL DEFAULT 'pending_preview' CHECK (status IN (
    'pending_preview',
    'previewing',
    'claiming',
    'awaiting_borrower_pick',
    'picked',
    'expired',
    'relisted'
  )),

  rolled_count integer NOT NULL DEFAULT 0,   -- 0-3 for rollover tracking

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  picked_at timestamptz,
  expired_at timestamptz
);

CREATE INDEX marketplace_listings_deal_id_idx ON public.marketplace_listings (deal_id);
CREATE INDEX marketplace_listings_status_idx ON public.marketplace_listings (status);
CREATE INDEX marketplace_listings_preview_opens_at_idx ON public.marketplace_listings (preview_opens_at);
CREATE INDEX marketplace_listings_claim_opens_at_idx ON public.marketplace_listings (claim_opens_at);

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

-- Brokerage ops sees all listings.
CREATE POLICY listings_select_for_brokerage_ops
  ON public.marketplace_listings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    JOIN public.banks b ON b.id = m.bank_id
    WHERE m.user_id = auth.uid() AND b.bank_kind = 'brokerage'
  ));

-- Matched lenders see listings they are matched to, during preview + claim + awaiting_pick.
CREATE POLICY listings_select_for_matched_lenders
  ON public.marketplace_listings FOR SELECT
  USING (
    status IN ('previewing', 'claiming', 'awaiting_borrower_pick')
    AND EXISTS (
      SELECT 1 FROM public.bank_user_memberships m
      WHERE m.user_id = auth.uid()
        AND m.bank_id = ANY (marketplace_listings.matched_lender_bank_ids)
    )
  );

-- 3) Rate card table.
CREATE TABLE IF NOT EXISTS public.marketplace_rate_card (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,              -- semver
  effective_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,

  -- Pricing key: (band × program × loan amount tier × term tier)
  score_band text NOT NULL CHECK (score_band IN (
    'institutional_prime','strong_fit','selective_fit','specialty_lender'
  )),
  sba_program text NOT NULL CHECK (sba_program IN ('7a','504','express')),
  loan_amount_tier text NOT NULL CHECK (loan_amount_tier IN ('<350K','350K-1M','1M-5M','>5M')),
  term_tier text NOT NULL CHECK (term_tier IN ('<=7yr','7-15yr','>15yr')),

  -- Rate expressed as spread over Prime, in basis points.
  spread_bps_over_prime integer NOT NULL,

  notes text,

  UNIQUE (version, score_band, sba_program, loan_amount_tier, term_tier)
);

CREATE INDEX marketplace_rate_card_version_idx ON public.marketplace_rate_card (version);

-- Seed v1.0.0 (placeholder spreads — tune before launch).
-- Run this after migration; values are illustrative.
-- Actual spreads: Matt + counsel set before launch.
```

---

## Code

### Redactor — `src/lib/brokerage/redactForMarketplace.ts`

Pure function. Takes a sealed snapshot, returns the KFS shape.

```typescript
import "server-only";

export type KeyFactsSummary = {
  // Deal snapshot
  sbaProgram: "7a" | "504" | "express";
  loanAmount: number;
  termMonths: number;
  useOfProceeds: Array<{ category: string; amount: number }>;
  equityInjectionAmount: number;
  equityInjectionPct: number;

  // Buddy SBA Score
  score: number;
  band: string;
  scoreComponents: {
    borrowerStrength: number;
    businessStrength: number;
    dealStructure: number;
    repaymentCapacity: number;
    franchiseQuality: number | null;
  };
  scoreNarrative: string;

  // Risk + eligibility
  sopEligibilityPassed: boolean;
  sopEligibilityChecks: Array<{ requirement: string; passed: boolean }>;
  riskGrade: "low" | "medium" | "high" | "very_high";

  // Financial snapshot
  dscrBaseHistorical: number | null;
  dscrBaseProjected: number;
  dscrStressProjected: number;
  globalCashFlowDscr: number | null;

  // Borrower profile — BUCKETED, NOT RAW
  state: string;                         // only state, never city/zip
  industryNaics: string;
  industryDescription: string;
  yearsInBusinessBucket: "startup" | "<2yr" | "2-5yr" | "5-10yr" | "10+yr";
  ficoBucket: "<680" | "680-720" | "720-760" | "760+";
  liquidityBucket: string;               // e.g. "$50K-$150K"
  netWorthBucket: string;
  industryExperienceYears: number;       // OK to share raw — not identifying

  // Franchise info — conditional
  franchiseBlock: {
    brandName: string | null;            // only if brand has 50+ open units
    brandCategory: string;               // always — e.g. "QSR", "Automotive Service"
    brandMaturityYears: number | null;
  } | null;

  // Feasibility
  feasibilityScore: number;
  feasibilityDimensions: {
    marketDemand: number;
    locationSuitability: number;
    financialViability: number;
    operationalReadiness: number;
  };

  // Anonymized deal narrative — Gemini-paraphrased with identifiers stripped
  anonymizedNarrative: string;

  // Package metadata — what the winning lender will get
  packageManifest: {
    businessPlanPages: number;
    projectionsPages: number;
    feasibilityPages: number;
    formsIncluded: string[];             // e.g. ["1919","413"]
    sourceDocumentsCount: number;
  };
};

export function redactForMarketplace(sealedSnapshot: any): KeyFactsSummary {
  // 1. Bucket raw values
  // 2. Strip identity fields (names, emails, addresses beyond state, business legal name, EIN, etc.)
  // 3. Conditional franchise brand disclosure (only if brand has ≥50 open units nationally —
  //    query franchise_brands.total_open_units)
  // 4. Build anonymized narrative via Gemini Flash with explicit "strip all identifying details"
  //    system instruction. Cache the output — don't regenerate each lender view.
  // 5. Assemble package manifest (page counts from trident previews + forms list).
  return { /* ... */ };
}

// Bucketing helpers
function bucketFico(fico: number | null): KeyFactsSummary["ficoBucket"] {
  if (fico == null) return "<680";
  if (fico >= 760) return "760+";
  if (fico >= 720) return "720-760";
  if (fico >= 680) return "680-720";
  return "<680";
}

function bucketLiquidity(amount: number | null): string {
  if (amount == null) return "undisclosed";
  if (amount < 50_000) return "<$50K";
  if (amount < 150_000) return "$50K-$150K";
  if (amount < 500_000) return "$150K-$500K";
  if (amount < 2_000_000) return "$500K-$2M";
  return "$2M+";
}

// ... similar for net worth, years in business, etc.
```

### Franchise brand disclosure gate

```typescript
export async function shouldDiscloseFranchiseBrand(
  brandId: string | null,
  sb: SupabaseClient,
): Promise<boolean> {
  if (!brandId) return false;
  const { data } = await sb
    .from("franchise_brands")
    .select("total_open_units")
    .eq("id", brandId)
    .single();
  return (data?.total_open_units ?? 0) >= 50;
}
```

### Anonymized narrative generator

Gemini Flash call with explicit stripping instruction:

```typescript
const narrativePrompt = `You are producing an anonymized deal narrative for a lender marketplace. The narrative will be shown to potential lenders who must NOT be able to identify the borrower.

Source deal facts: [structured summary]

Write a 2-3 paragraph narrative that conveys the deal's strengths and weaknesses for lender decision-making WITHOUT revealing any of:
- Borrower first/last name
- Business legal name, DBA, or trading name
- Street address, city, ZIP, county
- Specific franchise location (brand OK only if system-level reference, e.g. "an established QSR franchise")
- Specific prior employers by name
- Specific schools attended by name
- Phone numbers, emails, URLs

Use only:
- State-level geography ("a Midwestern state")
- Industry category and scale ("a mid-sized commercial HVAC firm")
- Years in business, management experience
- Financial and risk metrics

If any identifying detail appears in your output, rewrite to remove it.

Return the narrative as a single plain text string.`;
```

### Sealing API: `POST /api/brokerage/deals/[dealId]/seal`

```typescript
// Pseudocode
export async function POST(req: NextRequest, { params }: { params: { dealId: string } }) {
  // 1. Auth: borrower session matches this deal_id
  // 2. Gate: score ≥ 60, eligibility pass, gap queue empty for seal-critical items
  // 3. Snapshot: load full deal state, write to buddy_sealed_packages
  // 4. Redact: run redactForMarketplace on snapshot → KFS
  // 5. Match: run matchLendersToDeal → matched_lender_bank_ids array
  // 6. Schedule: compute preview_opens_at, claim_opens_at, claim_closes_at
  // 7. Insert marketplace_listings row with status='pending_preview'
  // 8. Update deals.status = 'sealed'
  // 9. Return { ok: true, listingId, previewOpensAt, claimOpensAt }
}
```

### Matching engine: `src/lib/brokerage/matchLenders.ts`

```typescript
export async function matchLendersToDeal(args: {
  dealId: string;
  sb: SupabaseClient;
}): Promise<string[]> {
  // Load deal facts: score, program, loan_amount, state, industry (NAICS),
  // franchise/non-franchise, DSCR
  // Load all active-LMA lender tenants with their lender_programs.
  // Filter: score >= program.score_threshold, loan_amount within program range,
  //         state in program.geography, asset_types match, sbaOnly respected.
  // Return array of matched bank_ids (5-10 typical).
  return [];
}
```

### Sealing gate: `src/lib/brokerage/sealingGate.ts`

```typescript
export async function canSeal(dealId: string, sb: SupabaseClient): Promise<
  | { ok: true }
  | { ok: false; reasons: string[] }
> {
  const reasons: string[] = [];
  // 1. Score exists and >= 60
  // 2. Eligibility passed
  // 3. Gap queue empty for seal-critical items
  // 4. Latest preview trident bundle exists
  // 5. Assumptions confirmed
  // 6. Validation pass not FAIL
  // Return ok or aggregated reasons.
}
```

### Portal UI: seal button

New borrower portal component `SealPackageCard.tsx`:

- Shows current Buddy SBA Score band
- Shows "What's needed before sealing" list (gap items)
- When all gates pass: "Seal my package" button
- On click: confirmation modal → POST to seal API → portal refresh showing "Listed" state with cadence dates

---

## Acceptance criteria

1. Migrations applied. `buddy_sealed_packages`, `marketplace_listings`, `marketplace_rate_card` tables exist with RLS.
2. Rate card seeded with v1.0.0 placeholder rows for all 4 bands × 3 programs × 4 loan tiers × 3 term tiers.
3. `redactForMarketplace` strips all identifying fields. Manual review: KFS contains no borrower name, business name, street address, city, or specific franchise location (unless brand has 50+ units).
4. Bucket functions produce correct buckets across boundary values (tested per bucket).
5. Franchise disclosure gate: brands with <50 open units return `brandName: null`, brands with ≥50 return the brand name.
6. Seal API creates sealed_package, marketplace_listing with correct cadence timestamps.
7. Weekend handling: sealing on Friday after 9am schedules preview for Monday 9am.
8. Matching engine returns 5-10 lenders for a typical deal, 0 for deals outside all lender boxes.
9. Unseal path works: borrower can un-seal a listing in `pending_preview` state; once `previewing`, unseal is blocked.
10. RLS: a lender matched to listing A can see it during preview; a lender not matched sees nothing. Brokerage ops sees all.

---

## Test plan

- **Redactor unit tests:** known-input fixture with full PII, expected KFS output with bucketed values and no PII. Run through a grep for prohibited strings (first name, business name, email, address) — must return zero matches in the KFS JSON.
- **Anonymized narrative test:** generate narrative, regex-scan for borrower first name, last name, business name, city name — must return zero matches.
- **Matching:** 10 synthetic lender programs + 10 synthetic deals; verify matches are correct per criteria.
- **Cadence:** seal on Monday, Tuesday, Wednesday, Thursday, Friday — verify preview_opens_at is correctly the following business day 9am CT.
- **Sealing gate negative cases:** missing facts, score below 60, ineligible — all should return descriptive reasons.
- **Integration:** seal the Samaritus test deal end-to-end, manually review the generated KFS for PII leaks and narrative quality.

---

## Non-goals

- Rate card recompute job (Sprint 6 builds the cron).
- Actual claim flow (Sprint 6).
- Lender-facing KFS UI (Sprint 6).
- Borrower-facing bid review (Sprint 6).

---

## Notes for implementer

- **The redactor is security-critical.** A bug here leaks borrower PII to lenders. Write exhaustive tests, including adversarial cases (what if the narrative generator mentions the borrower's name? what if a field is misclassified as non-PII?).
- The franchise disclosure threshold of 50 units is intentional — below that, naming the brand can identify the specific borrower when combined with state + loan amount. Don't lower it without thinking about re-identification risk.
- The sealed_snapshot jsonb should include EVERYTHING needed to reconstruct the deal at seal time: all concierge facts, score components, feasibility data, projections, forms field data, document references. A future bug in extraction code should not change the sealed snapshot.
- The rate card is version-managed — once a listing is created with `published_rate_bps` from rate card v1.0.0, that rate sticks even if the rate card is later bumped to v1.1.0. Lenders commit to what they saw at claim time.
