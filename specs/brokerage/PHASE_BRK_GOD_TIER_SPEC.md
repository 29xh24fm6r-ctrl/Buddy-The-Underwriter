# PHASE-BRK-GOD-TIER — Canonical SBA Brokerage Build Spec

**Status:** Specification — ready for Claude Code implementation, phase-by-phase.
**Authored:** 2026-05-08 (post relentless audit of repo @ `main` and Supabase prod).
**Owner:** Matt (product), Claude (architecture), Claude Code (implementation).
**Supersedes:** governs over `sprint-01-v2-canonical.md`, `sprint-02-v2-canonical.md`, `sprint-03-trident-previews.md`, `sprint-04-lma-and-lender-portal.md`, `sprint-05-sealing-and-kfs.md`, `sprint-06-marketplace-and-pick.md` for the v1 god-tier launch path. Those sprint specs remain reference material; where they conflict with this spec, this spec wins.
**Master plan precedence:** `specs/brokerage/brokerage-master-plan.md` v1.1. Where THIS spec adds detail, it adds it within master-plan invariants. Where this spec contradicts master plan, master plan wins (escalate before building).

---

## 0. Build principle additions (codify as #14–#16 in the project roadmap)

- **#14 — Concierge writes through to canonical tables.** No brokerage flow may capture facts only into `borrower_concierge_sessions.extracted_facts`. Every fact extracted in conversation is propagated to the canonical underwriting tables (`borrower_applications`, `deal_financial_facts`, `deal_ownership_entities`, `deal_ownership_interests`, `borrower_applicants`, `borrower_applicant_financials`, `deals`) on the same turn it's extracted. The concierge session is a transcript, not a system of record.
- **#15 — Defense in depth, not defense by accident.** A function whose name is `redactForMarketplace` is a redactor. If it also throws when band='not_eligible', that's a side effect, not a security boundary. Every gate is at least two-deep — explicit gate, plus invariant assertion at the next layer. The redactor's eligibility throw stays as a backstop; an explicit gate must exist upstream and be tested.
- **#16 — Schema column names are an integration contract.** When two modules read the same table with different column names (e.g. `deal_financial_facts.value_numeric` vs `fact_value_num`), one of them is wrong and the test that would catch it is missing. Every schema-touching module must have a contract test that reads against a real Supabase row and asserts the column names match.

---

## 1. PIV — Problem, Insight, Value

**Problem.** The brokerage exists as scaffolding. After 6 anonymous deals over 3 weeks, `marketplace_listings=0`, `buddy_sba_scores=0`, `buddy_trident_bundles` 5/6 failed and 1/6 pending. The one borrower (Matthew Paller) who got to 100% concierge progress and 78 turns of conversation hit a hard wall — every trident attempt failed with "Assumption validation failed" and no score, KFS, listing, or lender match could be produced.

**Insight from audit.** The system is not blocked by complexity or unbuilt intelligence. It is blocked by:
1. **One specific data-flow seam:** the concierge captures facts into a JSON blob (`borrower_concierge_sessions.extracted_facts`) but never propagates them to the canonical tables (`borrower_applications`, `deal_financial_facts`, `deal_ownership_entities`, etc.) that the SBA orchestrator and score loader read. The bank-side machinery is mature; the brokerage flow doesn't write the inputs it expects.
2. **One latent column-name bug:** `src/lib/score/inputs.ts` queries `value_numeric`/`value_text` on `deal_financial_facts`. Those columns do not exist. The actual columns are `fact_value_num`/`fact_value_text` (the orchestrator gets it right). Score compute returns zeros silently and persists garbage.
3. **One sparse rate card:** `marketplace_rate_card` has 44 rows out of the 144 expected (4 bands × 3 programs × 4 amount tiers × 3 term tiers). The `>15yr` term tier is entirely missing — meaning every 25-year SBA 7(a) real-estate deal hits `rate_card_miss` and the seal returns 500.
4. **Sprints 4 and 6 unbuilt.** No `marketplace_claims`, no `marketplace_audit_log`, no `lender_marketplace_agreements`, no `legal_documents`, no `marketplace_picks`, no atomic-unlock module, no claim RPC, no daily cron, no `/lender/listings` page, no `/admin/brokerage/*`. Zero lender programs seeded.
5. **No brokerage-side write path to `deal_borrower_story`** — the table that `loadBorrowerStory()` reads to drive the god-tier plan thesis, milestone timeline, and KPI dashboard. The bank-side interview writes here; the brokerage funnel has no equivalent.
6. **Borrower portal is a 254-byte stub.** No Discovery Interview UI, no upload checklist, no trident preview viewer, no score/band display, no seal button, no claim-review panel, no pick UI.
7. **Defense-in-depth violation in `redactForMarketplace.ts`.** The eligibility throw is the actual gate; if anyone wraps it in try/catch the security boundary disappears with no compile-time signal.

**Value when built.** A borrower lands on `/start`, has a 15–30 minute Buddy-led conversation (text + optional voice), uploads tax returns and bank statements, gives 10 minutes of voice for the Discovery Interview, watches Buddy build a watermarked preview of the business plan / projections / feasibility study, sees a Buddy SBA Score with an explainable breakdown, seals the package, sees N matched lenders previewing, sees up to 3 lenders claim, picks one, and gets a full god-tier package delivered to themselves and to the picked lender — all without ever talking to a banker. Every package the lender receives is materially better than what a borrower could buy from a $20K SBA consultant. Buddy-as-brokerage earns 1.0% of funded amount + $1,000 packaging fee at close. Compute cost: $2–6 per deal. Margin: >99%.

---

## 2. Scope — eight ordered build phases

This spec defines eight implementation phases. They build in order. Each is a Claude Code build target with a hand-off message at the end of this document.

| Phase | Name | What it ships | Depends on |
|---|---|---|---|
| BRK-G1 | The Wire-Through | Concierge writes to canonical tables every turn | none (root unblocker) |
| BRK-G2 | Score Loader Column Fix | `inputs.ts` uses `fact_value_num`/`fact_value_text` + contract test | none (latent bug) |
| BRK-G3 | Discovery Interview | Brokerage-side write path into `deal_borrower_story` via guided text/voice | BRK-G1 |
| BRK-G4 | Borrower Document Upload | `/portal/[token]/uploads` ties into existing extraction pipeline | BRK-G1 |
| BRK-G5 | Borrower Portal Shell | PortalClient renders concierge transcript, story, score, previews, seal | BRK-G1, BRK-G2, BRK-G3, BRK-G4 |
| BRK-G6 | Sprint 4 — LMA + Lender Portal + Audit Log | All Sprint 4 tables, lender provisioning, lender portal shell | BRK-G2 |
| BRK-G7 | Sprint 6 — Marketplace Mechanics | Claims, picks, atomic unlock, cron, Stripe, re-list, rate card recompute | BRK-G5, BRK-G6 |
| BRK-G8 | Brokerage Ops Cockpit | `/admin/brokerage/listings` activity dashboard + per-deal drill-in | BRK-G6, BRK-G7 |

**Cross-cutting hardening** (applied across all phases, not a separate build):
- Fix `buildSealedSnapshot` redactor-gate-by-accident violation
- Eliminate test-fixture leakage on `deals.name`/`borrower_name` for borrower-facing surfaces
- Backfill rate card to all 144 (band × program × amount × term) combinations
- Borrower-facing string audit — only `display_name` ever surfaces
- End-to-end Golden Brokerage Run script

---

## 3. Master plan invariants this spec inherits

These are non-negotiable. Implementer applies regardless of any local optimization.

- **Tenant model:** `banks.bank_kind = 'brokerage'` for the singleton Buddy Brokerage tenant. No parallel `brokerages` table. Lenders are `bank_kind = 'commercial_bank'`.
- **Session security:** every anonymous session is identified by a 32-byte token. The cookie holds the raw token; the database holds only `sha256(token)`. Already implemented in `borrower_session_tokens`. Extends to any new tokens introduced (magic links, email confirmation tokens, etc.).
- **Rate limits:** every anonymous-write endpoint applies the §3a rate limit table. Fail open. HTTP 429 with `Retry-After` on over-limit.
- **One-directional redaction:** lender sees redacted KFS during preview/claim. Borrower sees full lender identity post-claim-close. Never reverse.
- **Rate card:** Buddy publishes rates by (band × program × loan tier × term tier). Lenders commit to the published rate when they claim. They cannot set per-deal rates. Lenders compete on closing timeline + relationship terms.
- **3-slot cap:** at most 3 active claims per listing. Atomically enforced via Postgres `FOR UPDATE` row lock + count guard inside an RPC.
- **Atomic unlock:** at borrower pick, trident-final + full E-Tran package release together or roll back together. Idempotent on retry.
- **Daily cadence:** seal → next business day 9am CT preview → following day 9am CT claim → same day 5pm CT claim close → 48h borrower pick window. Up to 3 zero-claim rolls then expire.
- **OCC SR 11-7 / FDIC compliance wall:** Buddy owns the deterministic underwriting state. Omega Prime is advisory only. Brokerage doesn't change this — every fact written to canonical tables is auditable, versioned, and reconcilable.

---

## 4. Phase BRK-G1 — The Wire-Through

**The unblocker.** Without this, no other phase produces working output for a real borrower.

### 4.1 What gets written, where, when

**Trigger:** every `POST /api/brokerage/concierge` turn after `mergedFacts = deepMerge(existing, newFacts)`. Runs **before** the response prompt. New helper `propagateConciergeFactsToCanonical(dealId, mergedFacts, sb)` in `src/lib/brokerage/factPropagation.ts`. Fire-and-await; non-fatal on partial failure (logs `propagation_partial` to `ai_events` with the field-level error map, does not block the conversation reply).

**Per-turn write set (idempotent upserts):**

| Source field in `mergedFacts` | Destination |
|---|---|
| `borrower.first_name`, `borrower.last_name` | `deals.borrower_name` (concat); also seeds `deal_ownership_entities` (next row) |
| `business.legal_name` | `deals.display_name` (preferred when present); `borrower_applications.business_legal_name` |
| `business.industry_description` | `borrower_applications.industry` |
| `business.naics` | `borrower_applications.naics` |
| `business.is_franchise` | `borrower_applications.is_franchise` |
| `business.franchise_brand` | `borrower_applications.franchise_brand_text` (free text, no FK yet — see master plan §15 deferred franchise FK) |
| `business.years_in_business` | `deal_financial_facts` row with `fact_key='YEARS_IN_BUSINESS'`, `fact_value_num` |
| `business.state` | `deals.state` |
| `loan.amount_requested` | `deals.loan_amount`; AND `buddy_sba_assumptions.loan_impact.loanAmount` (the ensure path already does this, but seed early) |
| `loan.use_of_proceeds` | `deal_proceeds_items` (row per category if borrower gives a structured breakdown; otherwise single row category='general' with full text in description) |
| `borrower.first_name + last_name` | `deal_ownership_entities` row (`entity_type='individual'`, `display_name` = full name) + `deal_ownership_interests` row (`ownership_pct=100`) when no other entities exist for the deal |

**`borrower_applications` upsert** uses `(deal_id)` as conflict target. One row per deal. New columns added if not present (see schema migration in §4.5).

**Applicant + applicant financials:** when name first appears, also create:
- `borrower_applicants` row (`application_id`, `applicant_first_name`, `applicant_last_name`, `is_primary=true`)
- `borrower_applicant_financials` row keyed by `applicant_id`. Fields populated from concierge as they arrive: `fico_score`, `liquid_assets`, `net_worth`, `industry_experience_years`. Initially all null. Concierge prompts add these to the extraction schema (see §4.2).

### 4.2 Concierge extraction schema additions

`buildExtractionPrompt` extends the JSON shape:

```json
{
  "borrower": {
    "first_name": null, "last_name": null,
    "email": null, "phone": null,
    "fico_score": null,
    "liquid_assets": null,
    "net_worth": null,
    "industry_experience_years": null
  },
  "business": {
    "legal_name": null, "industry_description": null, "naics": null,
    "is_startup": null, "years_in_business": null, "state": null,
    "is_franchise": null, "franchise_brand": null,
    "annual_revenue": null,
    "annual_cogs": null,
    "monthly_payroll": null,
    "employee_count": null
  },
  "loan": {
    "amount_requested": null,
    "use_of_proceeds": null,
    "use_of_proceeds_breakdown": [
      { "category": null, "amount": null }
    ],
    "term_years_preferred": null,
    "equity_injection_amount": null,
    "equity_injection_source": null
  }
}
```

These additions feed deal_financial_facts as:

| Concierge field | fact_key |
|---|---|
| `business.annual_revenue` | `TOTAL_REVENUE` |
| `business.annual_cogs` | `COST_OF_GOODS_SOLD` |
| `business.monthly_payroll` | `MONTHLY_PAYROLL` (annualized when stored: `*12`, written under `TOTAL_PAYROLL`) |
| `business.employee_count` | `EMPLOYEE_COUNT` |
| `business.years_in_business` | `YEARS_IN_BUSINESS` |
| `loan.equity_injection_amount` | also written to `buddy_sba_assumptions.loan_impact.equityInjectionAmount` via the existing draft persist path |

**Provenance:** every `deal_financial_facts` row written by concierge gets:
- `fact_type = 'borrower_self_reported'`
- `provenance.source = 'concierge'`
- `provenance.session_id = <concierge_session_id>`
- `provenance.confidence = 0.5` (low — borrower self-report, not document-extracted)

When the same fact later arrives from document extraction (e.g. tax return parsed in BRK-G4), the document value supersedes the concierge value via existing reconciliation rules. The concierge row is marked `is_superseded=true` rather than deleted.

### 4.3 The propagation function

```typescript
// src/lib/brokerage/factPropagation.ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PropagationResult = {
  dealUpdated: boolean;
  applicationUpserted: boolean;
  applicantUpserted: boolean;
  factsWritten: string[];   // fact_keys written this turn
  ownershipSeeded: boolean;
  proceedsItemsWritten: number;
  errors: Array<{ field: string; error: string }>;
};

export async function propagateConciergeFactsToCanonical(args: {
  dealId: string;
  mergedFacts: Record<string, any>;
  sessionId: string;
  sb: SupabaseClient;
}): Promise<PropagationResult> { /* ... */ }
```

**Idempotency rule:** every write is upsert-shaped or natural-key-conditional. Running propagation 100 times with the same `mergedFacts` produces zero net schema change after the first run.

**Fact write rule:** for each fact_key, the function checks if the most recent non-superseded row with `(deal_id, fact_key, owner_type='deal')` exists. If absent, insert. If present and `provenance.source='concierge'` and `fact_value_num != mergedFactValue`, supersede the old row and insert new. If present and `provenance.source != 'concierge'` (document-derived), do nothing — document data wins over concierge data.

### 4.4 Wiring in `route.ts`

In `src/app/api/brokerage/concierge/route.ts`, after `mergedFacts = deepMerge(...)` and the existing `persistAssumptionsDraft` fire-and-forget, add:

```typescript
const propagation = await propagateConciergeFactsToCanonical({
  dealId: session.deal_id,
  mergedFacts,
  sessionId: conciergeRow.id,
  sb,
});
if (propagation.errors.length > 0) {
  console.warn("[brokerage-concierge] propagation_partial:", propagation.errors);
  await sb.from("ai_events").insert({
    deal_id: session.deal_id,
    scope: "brokerage_concierge",
    action: "propagation_partial",
    output_json: propagation,
    confidence: 1,
    requires_human_review: false,
  });
}
```

Note: `await`ed (not fire-and-forget). The score-compute trigger at turn 5 / on email-claim must run AFTER propagation so the score sees up-to-date facts. The existing `computeBuddySBAScore` call moves to AFTER this block.

### 4.5 Schema migration

`supabase/migrations/20260508_brk_g1_application_columns.sql`:

```sql
-- BRK-G1: borrower_applications columns required by the wire-through.
ALTER TABLE public.borrower_applications
  ADD COLUMN IF NOT EXISTS business_legal_name text,
  ADD COLUMN IF NOT EXISTS is_franchise boolean,
  ADD COLUMN IF NOT EXISTS franchise_brand_text text;

-- Some deployments may already have these via earlier migrations.
-- The IF NOT EXISTS guards make the migration safe to re-run.

-- Single-app-per-deal invariant. borrower_applications has historically had
-- no unique constraint on deal_id; create one if absent so upserts are clean.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'borrower_applications_deal_id_key'
  ) THEN
    -- Only add if no current duplicates would violate. Check first.
    IF NOT EXISTS (
      SELECT deal_id FROM public.borrower_applications
      GROUP BY deal_id HAVING count(*) > 1
    ) THEN
      ALTER TABLE public.borrower_applications
        ADD CONSTRAINT borrower_applications_deal_id_key UNIQUE (deal_id);
    END IF;
  END IF;
END $$;
```

If the unique-constraint add finds duplicates (it won't on prod today — `borrower_applications` is empty — but might on staging): emit a notice and proceed. The propagation function uses select-then-upsert anyway, so the absence of the unique constraint is not fatal.

### 4.6 Tests

`src/lib/brokerage/__tests__/factPropagation.test.ts`:

1. **Empty facts in, no writes out.** `propagateConciergeFactsToCanonical` with `mergedFacts={}` returns `factsWritten=[]`, no DB writes.
2. **Borrower name → ownership entity seeded.** Given `borrower.first_name='Matthew'`, `borrower.last_name='Paller'`, on a deal with no existing entities: creates `deal_ownership_entities` row with `display_name='Matthew Paller'`, `entity_type='individual'`, and `deal_ownership_interests` row with `ownership_pct=100`.
3. **Annual revenue → fact row.** Given `business.annual_revenue=1500000`: writes `deal_financial_facts` with `fact_key='TOTAL_REVENUE'`, `fact_value_num=1500000`, `provenance.source='concierge'`.
4. **Idempotency.** Running the same propagation 5x: exactly one entity, one interest, one fact row.
5. **Document supersedes concierge.** Pre-seed a concierge fact row with `fact_value_num=1000000`. Insert a document-derived row with `fact_value_num=1500000` and `provenance.source='extraction'`. Re-run propagation with `mergedFacts.business.annual_revenue=1200000`. Expectation: document row remains canonical, concierge row not modified.
6. **Use of proceeds breakdown.** Given a `loan.use_of_proceeds_breakdown` array of three categories: writes three `deal_proceeds_items` rows. Re-run with same payload: exactly three rows (no duplicates).
7. **Partial failure → returns error map.** Mock `deal_financial_facts` insert to fail. Expect `errors=[{field:'TOTAL_REVENUE', error:...}]`, other fields still wrote.

Integration test `src/app/api/brokerage/concierge/__tests__/wire-through.test.ts`:

8. **End-to-end:** POST 5 concierge turns with facts arriving incrementally; assert that after turn 5, `borrower_applications` has 1 row with naics+industry+legal_name, `deal_financial_facts` has rows for `TOTAL_REVENUE` and `YEARS_IN_BUSINESS`, `deals.loan_amount` is set, `deal_ownership_entities` has the borrower seeded, `buddy_sba_scores` has at least one row (the fire-and-forget compute fired and succeeded).

### 4.7 Verification

V-G1.1: query `borrower_applications` after 5 simulated concierge turns; row count=1 with naics+industry+legal_name populated.

V-G1.2: query `deal_financial_facts` after 5 turns including revenue and years-in-business in extracted facts; rows exist with `fact_value_num` set and `provenance.source='concierge'`.

V-G1.3: backfill the 6 existing brokerage deals: run `propagateConciergeFactsToCanonical` against each `borrower_concierge_sessions.extracted_facts`. The Matthew Paller deal (`e9486ec3-b1ae-431b-834b-00572169da9e`) must produce: `borrower_applications` row with naics inferred from "Used car dealership" (NAICS 441120), `deals.loan_amount=7000000`, `deal_ownership_entities` row with `display_name='Matthew Paller'`. After backfill, retry trident generation on this deal and observe: SBA orchestrator no longer hits "Assumption validation failed" because revenue/COGS facts can be added by uploading docs in BRK-G4 — for V-G1.3, partial population is sufficient (the assumptions row should now have a real loanAmount).

V-G1.4: contract test asserting no module under `src/lib/score/` reads `value_numeric` or `value_text` from `deal_financial_facts` — grep test fails the build if found.

---

## 5. Phase BRK-G2 — Score Loader Column Fix

**The latent bug.** Already understood. Clean and simple.

### 5.1 Patch

`src/lib/score/inputs.ts`:

```typescript
// BEFORE
const { data: factRows } = await sb
  .from("deal_financial_facts")
  .select("fact_key, value_numeric, value_text")
  .eq("deal_id", dealId);

function factNum(key: string): number | null {
  const row = factRows?.find((r: any) => r.fact_key === key);
  return tryNumber(row?.value_numeric);
}

// AFTER
const { data: factRows } = await sb
  .from("deal_financial_facts")
  .select("fact_key, fact_value_num, fact_value_text")
  .eq("deal_id", dealId);

function factNum(key: string): number | null {
  const row = factRows?.find((r: any) => r.fact_key === key);
  return tryNumber(row?.fact_value_num);
}
```

The `riskProfile` builder call further down also passes `facts` to `buildSBARiskProfile`; check that callee uses the same column names. If `sbaRiskProfile.ts` reads `value_numeric` anywhere on `deal_financial_facts`, fix there too.

Adjust the `facts.map(...)` block:

```typescript
const facts = (factRows ?? []).map((r: any) => ({
  fact_key: r.fact_key as string,
  value_numeric: tryNumber(r.fact_value_num),  // map to internal name expected by riskProfile
  value_text: (r.fact_value_text as string | null) ?? null,
}));
```

This preserves the internal contract `buildSBARiskProfile` expects (it can use the legacy field names internally) while reading the actual DB columns.

### 5.2 Repo-wide grep guard

Add a repo-wide test that asserts:
- No module other than `src/lib/score/inputs.ts` (in the post-fix mapping line) and TS types files mentions the literal string `value_numeric` in the context of `deal_financial_facts`.
- No module mentions `value_text` in the context of `deal_financial_facts`.

`src/lib/__tests__/schemaContract.test.ts`:

```typescript
import { execSync } from "child_process";

test("no module reads value_numeric from deal_financial_facts", () => {
  const out = execSync(
    "grep -rn 'deal_financial_facts' src --include='*.ts' || true",
  ).toString();
  const violations = out
    .split("\n")
    .filter((l) => /value_numeric|value_text/.test(l))
    .filter((l) => !/inputs\.ts:\s*value_numeric:/.test(l)); // allow the internal-mapping line
  expect(violations).toEqual([]);
});
```

### 5.3 Tests

`src/lib/score/__tests__/inputs.contract.test.ts`:
- Insert a real Supabase row with `fact_key='YEARS_IN_BUSINESS'`, `fact_value_num=5`. Run `loadScoreInputs`. Assert `yearsInBusiness=5`. Without the fix, this test fails.

### 5.4 Verification

V-G2.1: after backfill in V-G1.3, run `computeBuddySBAScore` for the Matthew Paller deal. Score persists with non-zero band. Without G2 fix, score persists with zeros and `band='not_eligible'` regardless of inputs.

V-G2.2: Schema contract test passes in CI.

---

## 6. Phase BRK-G3 — Discovery Interview

**The god-tier voice.** This is what makes the trident feel like a $20K consultant wrote it.

### 6.1 Architecture decision

Use the existing `deal_borrower_story` table as the destination. No new table. The bank-side flow already writes here through the banker interview UI. The brokerage flow needs an analogous write path — borrower-driven, voice-or-text, guided by Buddy.

The schema columns map directly onto the god-tier story shape (`growth_strategy`, `key_risks`, `customer_concentration`, `revenue_model`, `seasonality`, `competitive_position`, etc.). `loadBorrowerStory()` already reads from this table and feeds it to `generatePlanThesis`, `generateMilestoneTimeline`, `generateKPIDashboard`, `generateRiskContingencyMatrix`. Wire the brokerage borrower in and the entire god-tier plan generator stack lights up.

### 6.2 The 10-question Discovery Interview script

These are the questions Buddy asks. The borrower can answer each in voice or text. Buddy can re-ask follow-ups for thin answers, but never re-asks more than twice on a single question.

| # | Question (Buddy's words) | Maps to `deal_borrower_story` field |
|---|---|---|
| 1 | "Tell me about your business in your own words. What does it actually do, day to day?" | `business_description`, `products_services` |
| 2 | "Who are your customers? Are they mostly repeat or mostly one-time? Any one customer more than 20% of revenue?" | `customers`, `customer_concentration` |
| 3 | "How do you make money — what's the pricing model? One-time, subscription, hourly, blended?" | `revenue_model` |
| 4 | "Walk me through a typical year. Are some months busier than others? Any seasonality?" | `seasonality` |
| 5 | "Who do you compete with, and what makes you different from them — what would make a customer choose you?" | `competitive_position` |
| 6 | "Where do you see this business in three years? What's the plan for growing into the loan?" | `growth_strategy` |
| 7 | "What keeps you up at night about this business? What's the biggest thing that could go wrong?" | `key_risks` |
| 8 | "What's your background that makes you the right person to run this?" | flows into management bio (writes to `buddy_sba_assumptions.management_team[0].bio`, not `deal_borrower_story`) |
| 9 | "How will you use this loan, specifically? Walk me through what each chunk of the money is for." | enriches `loan.use_of_proceeds_breakdown` (re-runs propagation to write `deal_proceeds_items`) |
| 10 | "Last one — anything I haven't asked that a lender should know about you or this deal?" | `banker_notes` (reframed as borrower's own additional context) |

After Q10, Buddy summarizes back to the borrower: "Here's what I heard. Tell me if any of this is wrong." Borrower confirms or edits. On confirm, the row is written.

### 6.3 New routes

`POST /api/brokerage/discovery/start` — creates a `deal_interview_sessions` row with `mode='discovery'`, returns the next question. Anonymous-cookie-authed via `getBorrowerSession`. Rate-limited per master plan §3a.

`POST /api/brokerage/discovery/answer` — accepts `{ sessionId, questionIndex, answerText, source: 'voice' | 'text' }`. Writes `deal_interview_turns` row. Runs Gemini Flash extraction on the answer to produce a structured field-shaped value. Returns the next question or, after Q10, a summary for borrower confirmation.

`POST /api/brokerage/discovery/confirm` — borrower clicks "looks good". The function reads all turns, builds the final `deal_borrower_story` row (one per deal, upsert on `deal_id`), writes it, marks the session `status='confirmed'`. Also re-runs `persistAssumptionsDraft` so the management bio gets refreshed if Q8 produced one.

### 6.4 Voice path

For voice answers, route through the existing `pulse-voice-gateway` on Fly.io with model `gemini-2.5-flash-native-audio-preview-12-2025`. The voice gateway already exists; the new `/api/brokerage/discovery/answer` endpoint just accepts a transcript from the gateway when `source='voice'`. Voice transcripts are capped at 4000 chars per the master plan §3a payload cap.

### 6.5 Schema additions

`deal_interview_sessions` already exists. Confirm `mode` accepts `'discovery'` (already a free text column — no constraint). Document the convention.

`deal_interview_turns` (already exists per the audit) — confirm shape includes `(session_id, turn_index, role, content, structured_extraction jsonb)`. If not, add.

Add an optional `discovery_completed_at timestamptz` column to `deals` to flag completion at the deal level for portal status pills.

### 6.6 Borrower portal UI

In `PortalClient` (new in BRK-G5), add a "Tell Buddy your story" card that:
- Shows progress (3 / 10 questions answered)
- Picks up where the borrower left off if they refresh
- Offers voice or text per question
- Shows the question conversationally (not as a survey)
- Renders Buddy's summary at the end and asks for confirmation
- Disables itself once `deals.discovery_completed_at` is set, with a "Edit my story" button that creates a new `deal_interview_sessions` and re-walks Q1–Q10

### 6.7 Tests

- **Q1 → business_description.** Answer Q1 with a 2-paragraph response. After confirm, `deal_borrower_story.business_description` matches the substance (use Gemini to generate the canonical version; assert the Gemini-extracted output is a non-empty string of ≥40 chars).
- **Q5 + Q6 + Q7 produce non-trivial story fields.** All three of `competitive_position`, `growth_strategy`, `key_risks` are non-null after confirm.
- **Voice and text produce equivalent outputs.** Same answer given via voice transcript and via text → same structured extraction within tolerance (string similarity ≥0.85 via Levenshtein).
- **Re-edit creates new session, supersedes old story.** First confirm writes story v1. Editing creates a new session, re-confirming overwrites the row (one story per deal — upsert on `deal_id`).
- **Plan thesis improves.** Run `generatePlanThesis` on a deal before and after Discovery Interview confirm. Manual review of the thesis output: post-discovery thesis must reference at least 2 specific story elements (customer concentration, growth strategy, etc.). Quantitative test: compare `planThesis.length` before vs after — must be ≥1.5× longer post-discovery.

### 6.8 Verification

V-G3.1: Borrower completes Discovery Interview on a test deal; `deal_borrower_story` row exists with all 7 mapped fields populated.

V-G3.2: Trident generation post-discovery produces a business plan PDF where the executive summary, thesis, and milestone timeline reference specific borrower-stated facts (manual review on Samaritus-class test deal).

V-G3.3: Voice path works end-to-end: borrower speaks an answer, transcript arrives at `/api/brokerage/discovery/answer`, structured extraction populates `deal_interview_turns.structured_extraction` jsonb.

---

## 7. Phase BRK-G4 — Borrower Document Upload

The brokerage borrower must be able to upload documents that auto-populate `deal_financial_facts` via the existing extraction pipeline.

### 7.1 SBA 7(a) document checklist

Document type | Required for | Existing extraction pipeline supports?
---|---|---
3 yrs personal tax returns | Every applicant | Yes (`docTyping`/`extraction` libs)
3 yrs business tax returns | Existing business | Yes
12 mos business bank statements | Every deal | Yes
Schedule of liabilities | Existing business | Yes
Personal financial statement (SBA Form 413) | Every applicant | Form-fillable; existing
Business debt schedule | Existing business | Yes
Lease or purchase agreement | Real estate deals | Partial — text extraction only
Business licenses | Every deal | Document-of-record only, no facts extracted
Articles of incorporation / org docs | Entity verification | Document-of-record only
Driver's license or passport | KYC | Document-of-record only
Resume of each principal | KYC + management bio | Text extraction → flows to mgmt bio

For v1 god-tier launch, support SBA 7(a) only (per master plan §14 non-goals: 504/Express deferred). Express requires a different doc set; 504 requires CDC-side docs Buddy doesn't see.

### 7.2 Route

`POST /api/portal/[token]/upload` — already exists for bank-side. Route accepts the borrower-side cookie too. Add a `/portal/[token]/uploads` page (BRK-G5) that lists the checklist with green checks for received docs and pending pills for outstanding ones.

The existing `documentTruth` and extraction pipelines parse uploaded docs and write to `deal_financial_facts` with `provenance.source='extraction'` — these supersede concierge-source rows automatically per BRK-G1's reconciliation rule.

### 7.3 Extraction validation

After every upload, run a synchronous "fact summary" call:
- For each fact_key written, surface to the portal: "I just read your 2024 tax return — your revenue last year was $1,487,250."
- Borrower clicks "Looks right" or "That's wrong" → optional override (creates a `provenance.source='borrower_override'` row, SUPERSEDES extraction)
- All overrides flagged in `marketplace_audit_log` post-G6 build: brokerage ops can review patterns of suspicious overrides

### 7.4 Tests

Per existing extraction pipeline (already covered).

New brokerage-specific test:
- **Concierge revenue + later document revenue → document wins.** Concierge says $1.5M, tax return says $1.487M. After upload, `deal_financial_facts` non-superseded `TOTAL_REVENUE` row has `fact_value_num=1487000` (or near) with `provenance.source='extraction'`.

### 7.5 Verification

V-G4.1: Upload a synthetic 1120-S tax return on a test brokerage deal; revenue, COGS, depreciation, interest expense facts appear in `deal_financial_facts` with `provenance.source='extraction'`.

V-G4.2: Upload personal tax return and Form 413; FICO + liquid assets + net worth populate `borrower_applicant_financials` correctly.

V-G4.3: After full document checklist upload + Discovery Interview + concierge complete, `canSeal()` returns `{ok: true}` for the test deal — the seal gate's preconditions are all met.

---

## 8. Phase BRK-G5 — Borrower Portal Shell

Wire the 254-byte `PortalClient` stub into a real god-tier portal.

### 8.1 Layout

`/portal/[token]/page.tsx` renders a single column with these cards in order:

1. **"Welcome back, [first_name]"** header with the deal's `display_name` and current stage pill (`in_progress` / `discovery` / `documents` / `previewing` / `claims_open` / `awaiting_pick` / `picked` / `funded` / `expired`).
2. **Concierge transcript card** — show the existing concierge conversation, allow continuation.
3. **Discovery Interview card** (BRK-G3) — progress + entry button.
4. **Document upload card** (BRK-G4) — checklist with green checks / pending pills.
5. **Buddy SBA Score card** — show score number, band, narrative, top strengths, top weaknesses. Hidden until `buddy_sba_scores` has at least one row for the deal.
6. **Trident preview card** — three thumbnails (business plan, projections, feasibility) with "View preview" buttons. Disabled until `buddy_trident_bundles` has a succeeded preview bundle. Buttons download the watermarked PDF via signed URL with 15-min TTL.
7. **Marketplace status card** — once sealed, shows: "Your deal is being reviewed by N matched lenders" during preview; "N lenders are claiming today" during claim window; "K of 3 lenders claimed" with claim cards once the window closes.
8. **Pick card** — only when `marketplace_listings.status='awaiting_borrower_pick'`. Shows the active claims, each with: lender name + logo, closing timeline commitment, relationship terms, "Pick this lender" button. Plus a "Veto all and re-list" option (uses free re-list allowance).
9. **Post-pick card** — final trident downloads + lender contact info + closing timeline reminder.

Each card is a separate React component under `src/components/borrower/portal/`.

### 8.2 Data fetching

Single endpoint: `GET /api/portal/[token]/state` returns the full envelope:

```typescript
{
  deal: { id, displayName, state, status, loanAmount, loanType, ... },
  concierge: { conversationHistory, extractedFacts, progressPct, nextQuestion },
  discoveryInterview: { sessionId, status, currentQuestionIndex, answeredCount },
  documents: { received: [...], required: [...], outstanding: [...] },
  score: { score, band, narrative, topStrengths, topWeaknesses } | null,
  trident: { previewReady, businessPlanUrl, projectionsUrl, feasibilityUrl } | null,
  listing: { status, previewOpensAt, claimOpensAt, matchedLenderCount, activeClaims, ... } | null,
  pick: { picked, winningLenderName, closingTimelineDays, ... } | null,
}
```

Borrower-cookie-authed. Returns 404 on session/deal mismatch (master plan §3a invariant: opaque to outsiders).

### 8.3 Seal flow

The seal button on the portal calls `POST /api/brokerage/deals/[dealId]/seal`. Before it's enabled, the portal calls `GET /api/brokerage/deals/[dealId]/seal-status` to surface what's still missing. The seal-status route re-uses `canSeal()` and returns the human-readable reasons array.

When the seal button is disabled, render each missing precondition as a checklist item with a remediation link:
- "No locked Buddy SBA Score yet" → "Complete Discovery Interview" (or "Upload your tax returns")
- "Loan term missing" → "Add it to the structure card"
- "Preview trident not ready" → "Generating now... ~30 seconds" + auto-poll
- "Validation report is FAIL" → "Buddy needs to talk to you about a fact discrepancy" + flag to ops

### 8.4 Test fixture leakage hardening

Audit memo flagged `deals.name` and `deals.borrower_name` carrying "ChatGPT Fix 15" or other dev-fixture strings. The portal **never reads** `deals.name` or `deals.borrower_name`; it only renders `display_name` and `borrower_applicants.applicant_first_name + applicant_last_name`. Add a lint rule (TypeScript ESLint custom or codemod) that flags any borrower-portal-scoped component file accessing `.name` or `.borrower_name` on a `deals` row.

### 8.5 Tests

- **Empty deal renders without crashing.** Brand-new brokerage deal with only a concierge session, no docs, no score, no trident. Portal renders all 9 cards with appropriate empty states.
- **Score renders with band-appropriate styling.** `band='institutional_prime'` gets gold tier styling; `'specialty_lender'` gets standard styling. `band='not_eligible'` shows a "Buddy needs to review your deal manually — we'll be in touch" card instead of the usual score card.
- **Seal status surfaces all canSeal reasons.** Mock canSeal to return 4 reasons; portal renders 4 checklist items with remediation links.
- **Pick flow happy path.** Deal in `awaiting_borrower_pick` with 2 active claims renders the pick card with 2 lender cards. Clicking "Pick this lender" calls `/api/brokerage/deals/[dealId]/pick` with `winningClaimId`. On 200 response, portal refreshes to post-pick state.

### 8.6 Verification

V-G5.1: Manual walkthrough on staging — start at `/start`, complete concierge, complete Discovery Interview, upload docs, watch score appear, watch preview trident appear, click seal, verify listing row exists with `status='pending_preview'`.

V-G5.2: Lint rule blocks `deals.name` and `deals.borrower_name` reads in any portal component.

V-G5.3: All canSeal reasons render with remediation links that take the borrower to the right card.

---

## 9. Phase BRK-G6 — Sprint 4 Build (LMA + Lender Portal + Audit Log)

Build per `specs/brokerage/sprint-04-lma-and-lender-portal.md` exactly. That spec is canonical for this phase. Additions:

### 9.1 Hardening additions

- The `legal_documents` insert seeds LMA v1.0.0 with `content_hash='PLACEHOLDER_HASH_UPDATE_ON_REAL_UPLOAD'`. Add a CI check that fails the build if any `legal_documents` row in production has `content_hash LIKE 'PLACEHOLDER_%'` past the cutover date set in env: `LMA_PLACEHOLDER_DEADLINE`. This forces counsel turnaround.
- The `requireLenderMarketplaceAccess` helper logs every gate check to `marketplace_audit_log` with `event_type='lma_gate_checked'`. This gives ops a paper trail of attempted accesses by lenders without active LMAs.
- Add `marketplace_audit_log` event types: `lender_provisioned`, `lender_program_updated`, `lma_signed`, `lma_terminated`, `lma_version_superseded`. Ops UI in BRK-G8 surfaces these.

### 9.2 Lender provisioning runbook automation

Write `scripts/provision-lender.ts` (Node CLI invoked by ops):

```bash
$ pnpm tsx scripts/provision-lender.ts \
    --name "Live Oak Bank" \
    --code LIVE_OAK \
    --clerk-org-id org_abc123 \
    --first-user-id user_def456 \
    --min-dscr 1.25 \
    --max-ltv 0.85 \
    --asset-types real_estate,equipment,working_capital \
    --geography US \
    --sba-only true \
    --score-threshold 70 \
    --lma-signed-by-name "Jane Smith" \
    --lma-signed-by-title "VP, SBA Lending" \
    --lma-signed-pdf legal/lma-signed/live-oak-v1.0.0.pdf
```

Wraps the existing `POST /api/admin/brokerage/lenders` route. Exits 0 on success, prints the new `bank_id`.

### 9.3 Verification

Per Sprint 4 spec acceptance criteria (1–8) plus:

V-G6.1: Provision 3 test lender tenants via the CLI (Live Oak, Newtek, regional). All show in `/admin/brokerage/lenders` with active LMAs.

V-G6.2: Audit log immutability — `UPDATE marketplace_audit_log SET ...` returns RLS policy violation.

V-G6.3: Lender A logs in to `/lender/listings`; sees empty queue; cannot SELECT lender B's LMA via the API (403 or 404).

---

## 10. Phase BRK-G7 — Sprint 6 Build (Marketplace Mechanics)

Build per `specs/brokerage/sprint-06-marketplace-and-pick.md` exactly. That spec is canonical. Additions:

### 10.1 Rate card backfill (P0 launch blocker)

Before Sprint 6 is acceptance-tested, run the rate card seeder to fill the 100 missing rows. `scripts/seed-rate-card.ts`:

```typescript
// Generates all 4 bands × 3 programs × 4 amount tiers × 3 term tiers = 144 rows
// for version 1.0.0. Pulls current Prime from FRED, applies SOP-capped spreads
// + band adjustments per Sprint 6 spec.
```

After running:
```sql
SELECT COUNT(*) FROM marketplace_rate_card WHERE version='1.0.0';
-- Expect 144
```

### 10.2 Rate card miss → ops alert, not 500

Patch the seal route in `src/app/api/brokerage/deals/[dealId]/seal/route.ts`:
- On `rate_card_miss`, log to `ai_events` with `action='seal_rate_card_miss'`, return HTTP 503 (not 500) with body `{ ok: false, error: 'rate_card_miss', detail, opsNotified: true }`.
- The portal shows the borrower: "Buddy is finalizing your listing — we'll be in touch within 1 business day." instead of a generic 500.
- Ops gets paged via Slack webhook (configured via `OPS_SLACK_WEBHOOK_URL` env).

### 10.3 Atomic unlock idempotency

Per Sprint 6 spec note. Re-emphasize: at the start of `runAtomicUnlock`, check for an existing `marketplace_atomic_unlocks` row for `pick_id`. If present, return the existing manifest without re-firing trident-final or re-releasing the package. This is the difference between "ops retried because they thought it failed" and "ops accidentally double-released to the wrong lender."

### 10.4 Founding cohort cutover

Per master plan §2: 1.0% (founding) → 1.25% (post-founding) at first 10 signed lenders OR first 100 funded deals, whichever comes first.

```typescript
async function isFoundingCohort(sb: SupabaseClient): Promise<boolean> {
  const { count: priorFundedDeals } = await sb
    .from("marketplace_transactions")
    .select("*", { count: "exact", head: true })
    .eq("payer_type", "lender")
    .eq("stripe_status", "succeeded");

  const { count: signedLMACount } = await sb
    .from("lender_marketplace_agreements")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  // 'whichever comes first' — founding ends when EITHER threshold is hit
  return (priorFundedDeals ?? 0) < 100 && (signedLMACount ?? 0) < 10;
}
```

In-flight deals do not get grandfathered. The 11th signed lender's first claim that funds is at 1.25%, regardless of when they signed. Document this in the LMA so it's not surprising.

### 10.5 Re-list 60-day clock

Master plan §2: "One free re-list per borrower within 60 days." This spec resolves the ambiguity: **the clock starts at first seal**. If the deal seals on day 0 and the first listing expires on day 14, the borrower has 46 more days for one free re-list. After day 60, re-list always costs a new $1,000 packaging fee.

```typescript
const { data: firstSeal } = await sb
  .from("buddy_sealed_packages")
  .select("created_at")
  .eq("deal_id", dealId)
  .order("created_at", { ascending: true })
  .limit(1)
  .single();

const sixtyDaysAfterFirstSeal = new Date(
  new Date(firstSeal.created_at).getTime() + 60 * 24 * 60 * 60 * 1000,
);
const isWithinFreeWindow = new Date() < sixtyDaysAfterFirstSeal;
```

### 10.6 Verification

Per Sprint 6 spec acceptance criteria (1–11) plus:

V-G7.1: Concurrency test for 3-slot cap — 5 concurrent claims; exactly 3 succeed, 2 get `full`. Run 10×; consistent.

V-G7.2: Rate card has 144 rows; no `rate_card_miss` on 100 randomly-generated test deals (varying band, program, amount, term).

V-G7.3: Atomic unlock idempotency — call twice with same pick_id; second call returns existing manifest, no duplicate trident-final generation, no duplicate package release.

V-G7.4: Founding cohort cutover correctly switches from 100bps to 125bps at the 100-funded-deal mark.

V-G7.5: 60-day free re-list clock anchored to first seal, not first listing.

---

## 11. Phase BRK-G8 — Brokerage Ops Cockpit

The operations console for Matt + Sebrina + future CCO.

### 11.1 Routes

`/admin/brokerage` — landing dashboard with daily summary:
- Listings opening preview today
- Listings opening claim today
- Listings awaiting borrower pick (and time remaining in 48h window)
- Listings rolling for zero claims (and which roll iteration)
- Listings expiring today
- Funded deals MTD + revenue

`/admin/brokerage/listings` — paginated list of all listings with status filter, score band filter, deal_id search. Each row links to `/admin/brokerage/listings/[listingId]`.

`/admin/brokerage/listings/[listingId]` — per-listing drill-in:
- Full audit timeline (every `marketplace_audit_log` row for this listing)
- KFS preview as the lender sees it
- Active claims with lender names + claim form contents
- Borrower contact info (only post-pick or for ops review)
- Manual ops actions: force-roll, force-expire, override 48h pick deadline (with reason capture, audit-logged)

`/admin/brokerage/lenders` — provisioned lenders, LMA status, signed dates, programs, recent claim activity, "Provision new lender" button (calls the provisioning route).

`/admin/brokerage/lenders/[lenderBankId]` — per-lender drill-in: LMA history, all claims (won + lost + active), funded deals, total revenue contributed.

`/admin/brokerage/deals/[dealId]` — per-deal drill-in: full lifecycle from anonymous concierge through funding. Audit timeline, every state transition, ops can manually advance state with audit-logged reason.

`/admin/brokerage/transactions` — Stripe transaction list, status filter, deal/lender filter, manual reconciliation buttons.

### 11.2 Auth gate

All `/admin/brokerage/*` routes go through `requireBrokerageOpsAuth()` (per Sprint 4 spec). User must be a member of the Buddy Brokerage tenant with `role='owner'` or `role='admin'`.

### 11.3 Tests

- Per-route auth tests: non-brokerage user → 403; non-member → 401.
- Audit timeline rendering: 100-event audit log renders without performance degradation.
- Manual ops actions audit-logged: every override creates a `marketplace_audit_log` row with `event_type='ops_override'` and the reason.

### 11.4 Verification

V-G8.1: All 7 routes render with seeded test data.

V-G8.2: Manual force-roll action moves a listing's claim window and writes audit log.

V-G8.3: Lender drill-in shows correct LMA + claim history for the test lender provisioned in V-G6.1.

---

## 12. Cross-cutting hardening (applied alongside phases above)

### 12.1 Sealed snapshot redactor-gate-by-accident fix

`src/lib/brokerage/redactForMarketplace.ts` — keep the band-eligibility throw as a backstop, but add an explicit gate at the ONE upstream call site (`buildKFS.ts` and `seal/route.ts`):

```typescript
// In seal/route.ts, BEFORE buildKFS:
if (!ELIGIBLE_BANDS.includes(snapshot.forRedactor.score.band)) {
  return NextResponse.json(
    { ok: false, error: "deal_not_eligible_for_marketplace", band: snapshot.forRedactor.score.band },
    { status: 400 },
  );
}
```

The redactor's throw stays — but it's now defense-in-depth, not the primary gate. Add a comment:

```typescript
// Defense-in-depth: this throw is a backstop. The seal route is the
// primary eligibility gate. Do not rely on this throw as a security
// boundary in any new code path. See specs/brokerage/PHASE_BRK_GOD_TIER_SPEC.md §12.1.
```

Test: explicit upstream gate test in `seal/route.test.ts` — score band='not_eligible' → 400 before reaching the redactor.

### 12.2 Borrower-facing string audit

Lint rule (TypeScript ESLint custom rule) under `.eslintrc.js`:
- Files under `src/app/(borrower)/**` and `src/components/borrower/**` cannot read `.name` or `.borrower_name` on a typed `Deal` object.
- Allowed: `.display_name`, `.borrower_applicants[*].applicant_first_name + applicant_last_name`.

Add a one-time backfill: any existing brokerage deal with `name LIKE 'ChatGPT%'` or `borrower_name LIKE 'ChatGPT%'` gets cleaned: `name = display_name`, `borrower_name = NULL`. Test with the 6 existing brokerage deals.

### 12.3 Rate card backfill (covered in §10.1)

### 12.4 End-to-end Golden Brokerage Run

`scripts/golden-brokerage-run.ts` — synthetic deal that walks the full brokerage flow:

1. POST `/api/brokerage/concierge` with 8 turns of synthetic borrower facts (name, business, NAICS, revenue, COGS, loan amount, use of proceeds, FICO, etc.)
2. POST `/api/brokerage/discovery/start`, `/answer` × 10, `/confirm`
3. Upload synthetic 1120-S, personal 1040, bank statement, schedule of liabilities via `/api/portal/[token]/upload`
4. Wait for trident preview to succeed (poll `buddy_trident_bundles` for status)
5. Wait for score to lock (call `lockBuddySBAScore`)
6. POST `/api/brokerage/deals/[dealId]/seal` — assert listing row created
7. Force cron tick — assert listing transitions to `previewing`
8. Force cron tick — assert listing transitions to `claiming`
9. POST `/api/lender/listings/[listingId]/claim` from 2 different test lender tenants
10. Force cron tick — assert listing transitions to `awaiting_borrower_pick`
11. POST `/api/brokerage/deals/[dealId]/pick` with one of the claims
12. Assert atomic unlock fired: trident-final exists, package released, losing claim marked `lost`
13. POST `/api/admin/brokerage/deals/[dealId]/mark-funded` (ops simulation)
14. Assert Stripe intents created (test mode)

Exit 0 on success. Run nightly in CI. Failure pages ops.

---

## 13. Non-goals (explicit deferrals)

- **SBA 504 / Express borrower flows.** v1 is 7(a) only per master plan §14. 504 needs CDC integration (Buddy doesn't see CDC docs); Express has different doc set + different SBA process. Defer to a post-v1 sprint.
- **Self-serve lender signup.** Manual provisioning only for the first cohort. Defer per master plan §10.
- **Multi-language borrower flow.** English only for v1.
- **Mobile-first borrower portal.** Desktop-first; mobile responsive is acceptance-criteria-level acceptable but not optimized. Real native mobile app is post-v1.
- **Borrower-to-lender chat.** No chat at any stage. Borrower picks based on what's in the claim form. Negotiation happens post-pick outside Buddy.
- **Automated state SBA broker licensing detection per deal.** Counsel review per first-deal-in-state for v1. Future compliance sprint.
- **Real-time bidding.** Daily cadence + 3-slot cap is the locked model.
- **Lender analytics dashboards** (win rates, cohort reporting). Future.
- **Automated borrower fee collection at the closing table.** Manual ops + Form 159 for v1.
- **Self-service "mark-funded" by lender.** Ops-triggered only for v1. Lenders can request via portal but ops must confirm.

---

## 14. Risk register

| Risk | Mitigation | Owner |
|---|---|---|
| Concierge LLM extracts wrong facts (e.g. NAICS misclassification) | Borrower confirmation step before propagation persists; doc upload supersedes concierge | Claude Code (BRK-G1) |
| Document extraction quality varies by tax form vintage | Existing extraction pipeline has known limits; flag low-confidence extractions for ops review; borrower override path exists | existing |
| Discovery Interview voice path fails for poor audio | Fall back to text answer; never block the interview on voice quality | Claude Code (BRK-G3) |
| Lender provisions claim before LMA hash is updated to real PDF | CI check + production assertion; build fails if `content_hash LIKE 'PLACEHOLDER_%'` past cutover date | Claude Code (BRK-G6) |
| 3-slot cap concurrency bug allows 4th claim | RPC test with 5 concurrent posters, run 10× in CI; spec language explicit | Claude Code (BRK-G7) |
| Atomic unlock fails midway, ops retries, double-releases | Idempotency check at function entry; existing manifest returned without re-firing | Claude Code (BRK-G7) |
| Rate card miss on real deal sealing | Backfill all 144 rows BEFORE first real seal; ops alert on miss; HTTP 503 not 500 | Claude Code (BRK-G7 §10.2) |
| Borrower data leak via test fixture in `deals.name` | Lint rule + backfill; portal never reads `.name` | Claude Code (BRK-G5 §12.2) |
| Ops manually overrides state and breaks audit chain | Every override audit-logged with reason; immutable log | Claude Code (BRK-G8) |
| 60-day re-list window ambiguity disputed by borrower | Spec resolves: anchored to first seal; documented in borrower agreement | counsel + Claude Code |
| Founding cohort cutover dispute (lender expected 1.0%, gets 1.25%) | LMA documents the cutover rule; no grandfathering of in-flight deals | counsel |
| Anonymous session hijack via cookie theft | Existing token-hash schema mitigates DB breach; HTTPS-only cookies; SameSite=Lax | existing |
| Borrower abandons in concierge, returns later | Existing session token + claim-on-email flow; deal persists | existing |
| Score returns garbage because facts incomplete | Eligibility gate fails; band='not_eligible'; portal explains "Buddy needs more info from you" | Claude Code (BRK-G2 + portal copy) |

---

## 15. Acceptance criteria — the launch gate

The brokerage is god-tier launch-ready when ALL of:

1. ✅ Phase BRK-G1 through BRK-G8 shipped, each with their per-phase verifications passing.
2. ✅ Cross-cutting hardening §12.1, §12.2, §12.3 applied.
3. ✅ Golden Brokerage Run script (§12.4) passes nightly in CI for 7 consecutive days.
4. ✅ At least 3 lender tenants provisioned with active LMAs. Real PDFs (not placeholders). All `marketplace_rate_card` 144 rows seeded.
5. ✅ Counsel-finalized LMA v1.0.0 PDF uploaded; `content_hash` matches.
6. ✅ Stripe live-mode wired; both founding-cohort and standard fee paths tested with manual reconciliation.
7. ✅ State SBA broker licensing reviewed for at least the founding-state set (WI for Matt, GA for borrower trial).
8. ✅ Manual end-to-end run on staging: real (synthetic) borrower → real concierge → real Discovery Interview → real document upload → real seal → real preview → real claim by 2 test lenders → real pick → real Stripe test-mode fee fire. Wall-clock time captured; documented in launch runbook.
9. ✅ Monitoring in place: Vercel logs piped to Slack for cron failures, atomic unlock failures, rate-card misses, LMA gate denials.
10. ✅ Ops runbook documented: how to provision a lender, how to mark-funded a deal, how to handle a failed atomic unlock, how to handle a borrower dispute, how to handle a re-list request.
11. ✅ Zero borrower-facing surfaces read `deals.name` or `deals.borrower_name` (lint rule passes in CI).
12. ✅ Sample god-tier deliverable on a Samaritus-class synthetic deal: business plan PDF (20–40 pages), projections workbook (3-yr P&L + balance + cash + sensitivity + sources/uses), feasibility study (15–25 pages, BIE-grounded). Manual review by Matt — the bar is "indistinguishable from a $20K consulting deliverable."

---

## 16. Hand-off commit messages for Claude Code

One commit per phase. Format Claude Code expects:

### BRK-G1 hand-off

```
PHASE-BRK-G1: Concierge wire-through to canonical tables

Implements specs/brokerage/PHASE_BRK_GOD_TIER_SPEC.md §4.

Per spec §4.1–§4.4, every brokerage concierge turn now propagates extracted
facts to canonical tables (borrower_applications, deal_financial_facts,
deal_ownership_entities/interests, borrower_applicants/financials, deals)
via new helper src/lib/brokerage/factPropagation.ts.

Concierge extraction schema extended per §4.2 with FICO, liquid_assets,
net_worth, industry_experience_years, annual_revenue, annual_cogs, etc.
Each fact written to deal_financial_facts gets provenance.source='concierge';
document-extracted facts later supersede via existing reconciliation.

Schema migration 20260508_brk_g1_application_columns.sql per §4.5.

Verifications V-G1.1 through V-G1.4 passing (see spec §4.7).

Tests: src/lib/brokerage/__tests__/factPropagation.test.ts (7 unit tests
per §4.6) + src/app/api/brokerage/concierge/__tests__/wire-through.test.ts
(integration test #8 per §4.6).

Build principle #14 codified.
```

### BRK-G2 hand-off

```
PHASE-BRK-G2: Score loader column-name fix + schema contract guard

Implements specs/brokerage/PHASE_BRK_GOD_TIER_SPEC.md §5.

src/lib/score/inputs.ts now reads fact_value_num / fact_value_text from
deal_financial_facts (matching the actual columns). The internal mapping
preserves the value_numeric/value_text shape that buildSBARiskProfile()
expects.

Adds src/lib/__tests__/schemaContract.test.ts repo-wide grep guard per
§5.2 to prevent regression.

Adds src/lib/score/__tests__/inputs.contract.test.ts integration test
that inserts a real fact_value_num row and asserts the loader sees it.

Verifications V-G2.1 (Matthew Paller deal post-backfill produces non-zero
score) and V-G2.2 (schema contract test passes) per §5.4.

Build principle #16 codified.
```

### BRK-G3 hand-off

```
PHASE-BRK-G3: Brokerage-side Discovery Interview engine

Implements specs/brokerage/PHASE_BRK_GOD_TIER_SPEC.md §6.

Brokerage borrowers can now complete a 10-question Discovery Interview
via voice or text. Routes:
  POST /api/brokerage/discovery/start
  POST /api/brokerage/discovery/answer
  POST /api/brokerage/discovery/confirm

Writes flow into the existing deal_borrower_story table (one row per deal,
upsert on deal_id). loadBorrowerStory() consumes it; god-tier plan
generators (planThesis, milestoneTimeline, kpiDashboard, riskContingency)
already wired to consume.

Voice path uses existing pulse-voice-gateway on Fly.io.

The 10 questions per §6.2 map to specific deal_borrower_story columns.

Tests per §6.7. Verifications V-G3.1 through V-G3.3 per §6.8.

Borrower portal Discovery Interview card lands in BRK-G5; this phase
ships the API + extraction + persistence.
```

### BRK-G4 hand-off

```
PHASE-BRK-G4: Brokerage borrower document upload

Implements specs/brokerage/PHASE_BRK_GOD_TIER_SPEC.md §7.

Wires the borrower-side cookie-authed path into the existing /api/portal/
[token]/upload route. Documents flow through the existing extraction
pipeline (docTyping + extraction libs) and write to deal_financial_facts
with provenance.source='extraction', superseding concierge-source rows
per BRK-G1's reconciliation rule.

Upload checklist (SBA 7a) per §7.1. Borrower confirmation flow per §7.3:
after extraction, surface "Your 2024 revenue was $1.487M — looks right?"
with override path.

Tests per §7.4. Verifications V-G4.1 through V-G4.3 per §7.5.

Portal upload card lands in BRK-G5.
```

### BRK-G5 hand-off

```
PHASE-BRK-G5: Borrower portal shell

Implements specs/brokerage/PHASE_BRK_GOD_TIER_SPEC.md §8.

PortalClient renders 9 cards per §8.1. New endpoint
GET /api/portal/[token]/state returns full envelope per §8.2.

Seal flow per §8.3 surfaces canSeal() reasons as remediation checklist.

Lint rule per §8.4 + §12.2 blocks deals.name / deals.borrower_name reads
in borrower-portal-scoped components. One-time backfill cleans the 6
existing brokerage deals.

Tests per §8.5. Verifications V-G5.1 through V-G5.3 per §8.6.

Wires together BRK-G3's Discovery Interview UI and BRK-G4's upload
checklist into the portal shell.
```

### BRK-G6 hand-off

```
PHASE-BRK-G6: Sprint 4 build — LMA + lender portal + audit log

Implements specs/brokerage/PHASE_BRK_GOD_TIER_SPEC.md §9 in full per
specs/brokerage/sprint-04-lma-and-lender-portal.md.

Tables: legal_documents, lender_marketplace_agreements,
marketplace_audit_log (RLS append-only). LMA v1.0.0 placeholder seeded.

requireLenderMarketplaceAccess gate. Admin provisioning route
POST /api/admin/brokerage/lenders. Lender portal shell at /lender/listings,
/lender/claims, /lender/deals.

Hardening per §9.1: CI check on placeholder content_hash; LMA gate checks
audit-logged; expanded audit event types.

Provisioning CLI scripts/provision-lender.ts per §9.2.

Verifications V-G6.1 through V-G6.3 per §9.3 plus Sprint 4 spec criteria
1–8.
```

### BRK-G7 hand-off

```
PHASE-BRK-G7: Sprint 6 build — marketplace mechanics

Implements specs/brokerage/PHASE_BRK_GOD_TIER_SPEC.md §10 in full per
specs/brokerage/sprint-06-marketplace-and-pick.md.

Tables: marketplace_claims, marketplace_picks, marketplace_atomic_unlocks,
marketplace_relists, marketplace_transactions.

claim_marketplace_listing RPC enforces 3-slot cap atomically.

Daily cadence cron at /api/cron/brokerage/marketplace-tick (15-min schedule).

Atomic unlock module src/lib/brokerage/atomicUnlock.ts with idempotency
check at entry per §10.3.

Stripe two-sided fee fire at mark-funded route. Founding cohort cutover
per §10.4 (no grandfathering).

Re-list flow with 60-day clock anchored to first seal per §10.5.

Rate card nightly recompute. Backfill all 144 rows BEFORE acceptance
testing per §10.1.

Lender portal real content per Sprint 6 spec §lender-portal-ui.

Borrower portal claim review + pick UI per Sprint 6 spec §borrower-portal-ui.

Verifications V-G7.1 through V-G7.5 per §10.6 plus Sprint 6 spec criteria
1–11.
```

### BRK-G8 hand-off

```
PHASE-BRK-G8: Brokerage ops cockpit

Implements specs/brokerage/PHASE_BRK_GOD_TIER_SPEC.md §11.

7 routes under /admin/brokerage/* per §11.1. All gated by
requireBrokerageOpsAuth().

Dashboards: daily summary, listings activity, lender management,
per-deal drill-in, transaction reconciliation.

Manual ops actions audit-logged with reason capture.

Tests per §11.3. Verifications V-G8.1 through V-G8.3 per §11.4.

Wraps the brokerage in a working operations console for Matt + Sebrina +
future CCO.
```

---

## 17. Addendum — implementer notes for Claude Code

- **Phases are sequential by dependency, not by calendar.** BRK-G1 unblocks everything; BRK-G2 is small and parallelizable. BRK-G3, G4, G5 can be developed in parallel branches once G1 is on `main`. G6 can be developed in parallel with G3/G4/G5 since it has no dependency on them. G7 needs G5 + G6 merged. G8 needs G6 + G7.
- **Every Claude Code AAR for this spec must be GitHub-verified by Claude before roadmap update**, per the existing project anti-pattern principle. Phantom commits are a recurring pattern.
- **Files >38KB go through Claude Code CLI, not GitHub MCP** (per existing project rule). The portal page, atomic unlock module, and ops cockpit pages may approach this.
- **Schema migrations** all go through Supabase apply_migration. Never direct DDL via execute_sql.
- **Test the rate card backfill on staging branch first.** It's 100 INSERT rows; small, but a SOP-spread typo could mis-seed and contaminate live listings if applied in the wrong order.
- **Defense in depth, always.** When a phase ships a gate, ship its backstop too. Build principle #15.
- **Borrower wellbeing is not optional.** The portal copy when a deal fails eligibility ("Buddy needs to review your deal manually — we'll be in touch") must never feel like a reject letter. The borrower trusted Buddy with their financial situation; they get a hand on the shoulder, not a 404.
- **Compute cost is not a design constraint** (master plan §11). Don't optimize for cost in this phase. Optimize for borrower experience and lender trust. Compute cost is $2–6 per deal; revenue per funded deal is $4,500–$11,000+.

This spec is the canonical brokerage build path. When in doubt, escalate. When confident, ship.

— end of spec —
