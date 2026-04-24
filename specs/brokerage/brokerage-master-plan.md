# Buddy Brokerage — Master Plan

**Status:** Canonical architecture. Every brokerage sprint spec references this doc.
**Last updated:** 2026-04-24 (v1.1 — added §3a Session Security & Rate Limiting; §17 Authoritative Spec Index; updated §13 sequencing)
**Owner:** Matt (product), Claude (architecture), Claude Code (implementation)

---

## Purpose

This document captures every locked architectural and product decision for the Buddy Brokerage business line. It exists to prevent drift between sprints and to serve as the canonical source of truth when implementation questions arise. Sprint specs reference this doc; this doc references nothing upstream.

**If a sprint spec conflicts with this master plan, the master plan wins.** Implementers reconcile the sprint spec up before building.

---

## 1. What the brokerage is

Buddy Brokerage is a neutral SBA loan marketplace operated by Buddy. Borrowers discover Buddy through a public funnel, complete a conversational concierge intake, have a full institutional-grade underwriting package produced on their behalf, and are listed on a daily marketplace where up to 3 matched lenders can claim the deal. The borrower reviews whichever claims arrived (0, 1, 2, or 3), picks one, and at pick the system atomically unlocks the full borrower deliverables (the trident: business plan, projections, feasibility study) and releases the full E-Tran-ready package to the winning lender.

The brokerage is the second product line on the Buddy platform. The first is the bank-tenant SaaS (existing, unchanged) in which commercial banks license Buddy to underwrite their own deals. Both products share the underwriting engine, the trident generators, the SBA package orchestrator, the research engine (BIE), and the voice layer. They diverge at tenant identity, customer acquisition, marketplace mechanics, and compliance posture.

---

## 2. Business model

### Revenue

Single revenue event: **deal close** (loan funded). Not pick, not claim, not concierge-completion. Close.

- **1.0% of funded loan amount** from the winning lender — founding cohort rate (first 10 signed lenders or first 100 funded deals cohort-wide, whichever comes first).
- **1.25% of funded loan amount** from the winning lender — post-founding rate.
- **$1,000 flat packaging fee** from the borrower at closing, paid out of loan proceeds. Never out of pocket.
- Both fees disclosed on SBA Form 159.

Expected gross margin per funded deal: >99% given measured compute cost of ~$2–3 per deal. Unit economics are not a business constraint.

### Re-list policy

**One free re-list per borrower within 60 days**, no fault adjudication. If the picked lender does not close for any reason within 60 days of pick, the borrower can re-list once at no additional packaging fee. The package is refreshed with any new facts and placed back on the daily marketplace. Second re-list requires a new $1,000 packaging fee.

### Refund policy

The $1,000 borrower fee is only charged on funded loans. If no loan closes, no fee is charged. The 1% lender fee is only charged on funded loans. No bid fees, no listing fees, no review fees, ever.

---

## 3. Tenant model

**Discriminator on the existing `banks` table.** Not a parallel entity tree.

- `banks.bank_kind` is a new text column with check constraint: `bank_kind IN ('commercial_bank', 'brokerage')`.
- Default is `'commercial_bank'` — preserves all existing bank-tenant behavior.
- The singleton **Buddy Brokerage** tenant is inserted once with `bank_kind = 'brokerage'` and is the owning tenant for every brokerage-funnel deal from anonymous concierge entry through pick, close, and funding.
- Lender tenants on the marketplace are separate `banks` rows with `bank_kind = 'commercial_bank'`. Each signed-LMA lender gets their own `banks` row, Clerk org, and user memberships.

**Why a discriminator, not a separate table:** All existing RLS and code paths route through `banks.id`. A parallel `brokerages` table would require rewriting hundreds of code paths and migrating every RLS policy for identical security semantics (tenant isolation by id). A discriminator gives branch points where behavior actually differs (marketplace mechanics, compliance posture, E-Tran submission) without forking the spine.

**Forward compatibility:** `bank_kind` can accept additional values as the platform expands (`cdfi`, `credit_union`, `fintech_lender`, etc.) without further schema changes.

**Helper:** `src/lib/tenant/brokerage.ts` exports `getBrokerageBankId()`, `isBrokerageTenant(bankId)`, and `isBrokerageKind(bankId)`. Call sites branch on these at every fork point.

---

## 3a. Session security & rate limiting (architecture-level invariants)

These are architecture-level rules that apply across every brokerage surface. Sprint specs inherit them.

### Anonymous session tokens — hash at rest, raw in cookie only

Every anonymous brokerage session (pre-account borrower on `/start` and portal) is identified by a 32-byte random token. The raw token lives **only** in the HTTP-only, Secure, SameSite=Lax cookie named `buddy_borrower_session`. The database stores **only the SHA-256 hash** of the token.

Every table that holds a session identifier uses `token_hash` as the primary key, not `token`. Lookups hash the incoming cookie before comparing.

**Rationale:** A database breach (backup theft, read-replica leak, log exfiltration) must not give attackers live session tokens they can replay. This follows Rails / Django / Devise convention and is the standard pattern for every mature session library. Storing raw tokens is a Sev-1 security finding and cannot be rationalized.

**Applies to:** `borrower_session_tokens` (Sprint 1), any future borrower magic-link tokens (Sprint 2+ portal return flow), any future lender invitation tokens (if added).

### Rate limits on anonymous endpoints

Every anonymous-accessible write endpoint enforces multi-tier rate limits before doing any expensive work (database writes, Gemini calls, external API calls). Default limits:

| Scope | Window | Limit |
|---|---|---|
| Per IP | 60 seconds | 5 requests |
| Per IP | 1 hour | 30 requests |
| Per IP | 24 hours | 100 requests |
| Per session token | 60 seconds | 10 requests |
| Per session token | 1 hour | 100 requests |

**Rate limits fail open.** If the counter infrastructure errors, requests proceed rather than fail. This is a deliberate tradeoff — outage of the counter should never take down the product. A determined attacker can pound a known-broken counter, so ops monitors for sustained counter failures.

**Over-limit responses** return HTTP 429 with a `Retry-After` header in seconds. Clients display a friendly error and disable input for the retry window.

**Applies to:** `/api/brokerage/concierge` (Sprint 1), `/api/brokerage/voice/gemini-token` (Sprint 2), any future anonymous-accessible brokerage endpoint.

### Payload caps

Every anonymous endpoint that accepts user-supplied text caps the input size before any LLM call. Concierge message max = 4,000 characters. Voice transcripts relayed into concierge inherit the same cap.

### Master plan precedence

If a sprint spec omits any of 3a's invariants, the sprint spec is wrong. Implementer applies 3a regardless.

---

## 4. The deal lifecycle

```
1.  Borrower lands on /start (public, no auth).
2.  Anonymous concierge → draft deal under Buddy Brokerage tenant.
3.  Borrower provides email → draft becomes claimed.
4.  Concierge + document uploads + extraction → facts populate the deal.
5.  Trident analytical work runs (BIE, forward model, feasibility analysis).
6.  Preview PDFs generated (watermarked, truncated) — borrower sees quality but
    cannot use the deliverable outside Buddy.
7.  Buddy SBA Score computed (see §7).
8.  Borrower seals the package → queued for next marketplace preview window.
9.  Daily 9am CT — all packages sealed since yesterday's 9am enter PREVIEW state.
    Key Facts Summary + Buddy SBA Score visible to matched lenders (5–10 per deal
    by `lender_programs` criteria). No claiming yet.
10. 24 hours later (next day 9am CT) — CLAIM state opens. First 3 matched lenders
    to click "Claim" win slots. Once 3 claims land, listing marks full.
11. Same-day close (5pm CT) — claim window closes. Whatever claims stand are final
    (0, 1, 2, or 3 lenders). Borrower notified via email + portal.
12. Borrower has 48 hours to pick one of the claimants, or veto all (re-list).
13. Borrower pick → atomic unlock:
      a. Full trident PDFs generated on-demand, delivered to borrower portal + email.
      b. Full E-Tran package released to the picked lender via signed URLs.
      c. Losing claims marked status='lost', no further access granted.
      d. No fee charged yet — fee fires at close.
14. Picked lender downloads package, submits to E-Tran on their own SBA credentials,
    runs their credit committee, issues commitment, proceeds to closing.
15. Loan funds → Stripe fires: 1% lender fee + $1,000 borrower fee (from proceeds).
    OR loan fails to close within 60 days → borrower may re-list once at no charge.
```

### Cadence in calendar terms

| Event | Day | Time |
|---|---|---|
| Borrower seals package | any day | any time |
| Preview opens | next business day | 9am CT |
| Claim opens | day after preview | 9am CT |
| Claim closes | same day as claim open | 5pm CT |
| Borrower pick deadline | 48 hours after claim close | 5pm CT |

**Weekend handling.** Business days are Monday through Friday. A deal sealed Friday after 9am or any time Saturday–Sunday previews Monday 9am CT. Monday preview opens Tuesday 9am claim → Tuesday 5pm claim close → borrower picks by Thursday 5pm.

**Fastest cycle:** seal Tuesday morning → preview Wednesday 9am → claim Thursday 9am/5pm → borrower picks Thursday evening → ~36 hours seal-to-pick.

**Zero-claim handling.** If no lender claims during the window, the listing rolls to the next day's claim window (not preview — the preview already happened). Up to 3 consecutive roll days. After 3 rolls with zero claims, listing expires and borrower is offered re-list.

**Borrower no-pick handling.** If borrower does not pick within 48 hours, all claims expire (notify claimants). Deal auto-rolls to next preview cycle. Uses a re-list allowance slot if this happens more than once.

---

## 5. Tenant-facing surfaces

### Borrower

- **`/start`** — public marketing + anonymous concierge entry. Replaces the current bank-tenant marketing homepage.
- **`/for-banks`** — the existing bank-tenant SaaS marketing, moved from `/`.
- **`/portal/[token]`** — borrower's deal portal. Shows concierge progress, document uploads, watermarked trident previews, Buddy SBA Score preview, marketplace listing status (including preview-phase matched-lender count), claim notifications, pick button, post-pick deliverables. Magic-link authentication via emailed claim token.

### Lender

- **`/lender/listings`** — the matched listings queue, split into PREVIEW (reviewing, cannot yet claim) and CLAIM (claim window open, first 3 wins).
- **`/lender/listings/[listingId]`** — detailed listing view with full Key Facts Summary, score breakdown, and during CLAIM state, the claim button + three-field claim form.
- **`/lender/claims`** — the lender's own claim history (their claims only; never any other lender's).
- **`/lender/deals/[dealId]`** — post-pick deal view for won deals. Signed-URL downloads for full E-Tran package, borrower contact info, closing timeline commitment reminder.
- Lender authentication: Clerk, scoped to the lender's `bank_id`. Access gated by signed LMA (see §10).

### Brokerage operations

- The existing banker cockpit at `/cockpit`. Used by Buddy Brokerage tenant members (Matt, CCO) to review in-flight brokerage deals. Brokerage deals surface through the existing cockpit because they share the data model.
- **`/admin/brokerage/lenders`** — onboarding new lenders: create their `banks` row, create their Clerk org, mark their LMA signed, assign their initial user.
- **`/admin/brokerage/listings`** — marketplace activity dashboard. Previews open today, claims open today, claim counts per listing, borrower pick SLA, deals rolling due to zero claims.

---

## 6. The marketplace

### Matching

When a borrower seals their package, a **curated pool of 5–10 lenders** is matched from the full lender roster based on existing `lender_programs` criteria: `min_dscr`, `max_ltv`, `asset_types`, `geography`, `sba_only`, `score_threshold`. Additional criteria can be added without schema change (criteria table is sufficiently expressive).

Matching is deterministic, auditable, and explainable. Every listing records its matched lender set at preview time; lenders can trust that every listing they see fits the criteria they defined.

Lenders never see the full matched pool. A lender's view of their matched listings is their own; they have no visibility into who else is matched, who is previewing, who is claiming, or who claimed.

### Rate model — fixed rate card, lenders compete on non-rate dimensions

**Buddy publishes a rate card** keyed on (SBA program × Buddy SBA Score band × loan amount tier × term). Lenders commit to this rate card as part of the LMA. A lender's claim includes a mandatory rate-commitment field auto-populated with the rate-card rate for the deal; the lender cannot set their own rate per deal.

This preserves rate neutrality. Buddy does not set rates at the margin — the rate card is pegged to published SBA parameters (Prime + SOP-capped spread for the deal's tier). Buddy does not pick winners on rate — the rate card means all claimants on a deal are offering the same rate.

**Lenders compete on non-rate dimensions via the claim form:**

1. **Rate commitment** (required, fixed) — the published rate-card rate for the deal's score band.
2. **Closing timeline commitment** (required) — integer days from borrower pick to funding. Typical range 30–60 days.
3. **Relationship terms** (optional) — free text. Examples: "We'll waive our $1,500 origination fee if you move your operating account to us," "Preferred Lender status means we can issue SBA authorization in-house without SBA Sacramento review."

The borrower's pick decision is based on lender identity, closing timeline, and relationship terms — not rate.

**Rate card maintenance:** formula-driven, not judgment-driven. Stored in a `marketplace_rate_card` table keyed on score band × program × loan tier × term, recomputed nightly from current Prime + SOP-capped spread table. No human adjustment needed for day-to-day operation.

### Claim state machine

```
[listing]
    sealed_at → pending_preview
    preview_window_opens → previewing         (at 9am CT next business day)
    claim_window_opens → claiming             (at 9am CT following day)
    third_claim_lands | claim_window_closes → awaiting_borrower_pick
    borrower_picks → picked (pick moves deal to closing track)
    borrower_vetoes_all | no_pick_in_48h → relisted OR expired
    zero_claims_after_3_rolls → expired (borrower offered re-list)
```

```
[claim]
    lender_clicks_claim → active
    borrower_picks_this_claim → won
    borrower_picks_other_claim → lost
    borrower_vetoes_all | no_pick_in_48h → expired
```

**Concurrency control on the 3-slot cap.** Enforced by database-level advisory lock (or equivalent UPSERT-with-count-guard) at claim insert time. A fourth attempted claim on a listing with 3 active claims returns a clear "listing full" response; never creates a ghost row.

### Redaction — one-directional

Borrower identity is hidden from lenders during preview and claim. Lender identity is fully visible to the borrower at all times (after claims land).

**Lenders see in the Key Facts Summary (during preview and claim):**

- Loan amount, requested term, equity injection (amount + %)
- Use of proceeds breakdown (categories + dollar amounts; no vendor names)
- SBA program (7a / 504 / Express)
- **Buddy SBA Score + sub-component breakdown**
- Buddy risk grade (low / medium / high / very_high)
- DSCR historical + projected (base + stress scenarios)
- Industry NAICS + description
- Years in business bucket (startup / <2yr / 2–5yr / 5–10yr / 10+yr)
- State only (no city, no ZIP, no street)
- Franchise: brand name only if the brand has 50+ open units nationally; otherwise "Franchise (brand withheld)" + category
- Owner profile: FICO bucket (680–720 / 720–760 / 760+), liquidity bucket, net worth bucket, industry experience years
- Feasibility score + four dimension scores (market demand, location suitability, financial viability, operational readiness)
- SOP 50 10 7.1 eligibility confirmation (pass on each requirement)
- Anonymized borrower story — Gemini-paraphrased narrative with identifiers stripped: no borrower name, no business name, no specific prior employers, no specific schools, no specific locations beyond state

**Lenders never see during preview or claim (only after winning):**

- Borrower name, business legal name, DBAs, EIN
- Street address, city, ZIP
- Specific franchise location
- Phone, email, URLs
- Owner names, SSNs, DOBs
- Source documents (tax returns, bank statements)
- Credit memo, full SBA package, Forms 1919 / 413 / 159

**Borrowers see at all stages:**

- During concierge + sealing: their own data + watermarked trident previews + Buddy SBA Score + matched-lender count (opaque identities during preview).
- After claim close: full identity of each claimant, their rate, closing timeline, relationship terms, lender size / AUM (from public filings), Buddy trust metadata (total deals funded on platform, avg close timeline, any marketplace disputes).
- After pick: unlocked trident + direct lender contact info for the picked lender.

### Preview-phase borrower visibility — count only

During preview and claim, the borrower portal shows: "Your deal is being reviewed by N matched lenders." No identities, no per-lender indicators (reviewing / claiming / passed). Reveals at claim close.

---

## 7. Buddy SBA Score — the defining artifact

The **Buddy SBA Score** is a 0–100 composite score anchored in SOP 50 10 7.1 underwriting standards. It is computed deterministically, is fully explainable (SR 11-7 compliant), is published on every marketplace listing, and drives the rate-card rate for the deal. Without it, the marketplace has no language. Sprint 0 builds it.

### Foundation — what's already in place

The existing `sbaRiskProfile.ts` (`buddy_sba_risk_profiles` table) provides four weighted factors on a 1–5 scale: industry default rate (40%), business age (35%), loan term (15%), urban/rural (10%). This is ~60-70% of the score already. Sprint 0 extends rather than replaces.

### Target shape

```
Buddy SBA Score = 100 × weighted_sum(component_scores)

Components (proposed weights, confirmed in Sprint 0):
  1. SOP eligibility compliance      (pass/fail gate — score = 0 if fail)
  2. Borrower strength                ~25%
     (FICO, liquidity, net worth, industry experience, management depth)
  3. Business strength                ~20%
     (years in business or franchise system maturity for startups,
      industry risk grade, feasibility score)
  4. Deal structure                   ~15%
     (loan-to-project ratio, equity injection %, collateral coverage,
      guaranty coverage)
  5. Repayment capacity               ~30%
     (base DSCR, stress DSCR, projected-vs-historical variance,
      global cash flow including guarantor income)
  6. Franchise quality (when applicable)  ~10%
     (SBA directory status, FDD Item 19 unit economics,
      brand maturity, franchisor support strength)

Published bands:
  90–100 "institutional prime" — takes best rate-card tier
  80–89  "strong fit most lenders" — takes standard rate-card tier
  70–79  "selective fit" — takes widened-spread rate-card tier
  60–69  "specialty lender" — takes widest rate-card tier
  <60    "not marketplace-eligible" — borrower directed to manual review
```

### Requirements

- Deterministic. Same inputs must produce the same score. No LLM in the scoring path.
- Versioned. Score algorithm has a `version` field on the score record. When weights or components change, prior scores are not retroactively recomputed — new listings use the new version, existing listings keep their version until they re-list.
- Explainable. Every score comes with a component-by-component breakdown, source citations for each component, and a plain-English narrative summary.
- Validated. Score correlates with funding outcomes over time. Publish marketplace stats (average score, funding rate by score band) quarterly.
- SOP eligibility is a hard gate. Any deal that fails SOP 50 10 7.1 eligibility returns score = 0 and cannot list. Full spec in `sprint-00-buddy-sba-score.md`.

---

## 8. The trident as premium deliverable

The trident — business plan, projections, feasibility study — is the **value capture mechanism** for the borrower. Not a pre-listing prerequisite, not a free acquisition artifact. It is released at pick.

**Before pick, borrower sees:**
- Watermarked, truncated preview PDFs (every page visibly branded "PREVIEW — UNLOCKS WHEN YOU PICK A LENDER ON BUDDY")
- Executive summary paragraphs only; section headers and first-paragraph teasers for remaining content
- Numeric ranges, not specific figures (e.g., "Year 1 revenue projection: $450K–$550K" not "$487,250")
- Feasibility overall score + four dimension scores; one-sentence summary per dimension; locked full narrative

**At borrower pick, trident release is atomic with package release:**
- Full unredacted business plan PDF generated on-demand (20–40 pages, production quality).
- Full projections workbook (3-year P&L, balance sheet, cash flow, sensitivity scenarios, sources & uses).
- Full feasibility study PDF (BIE-grounded, 15–25 pages).
- All three delivered to borrower portal with download buttons and emailed to the claimed email address.

**Rationale.** The trident is professional-grade work that costs Buddy ~$2–3 in compute but is worth thousands to a borrower on the open market. Releasing it free would train borrowers to extract value without committing to a lender. Gating it on pick aligns the borrower's incentive to actually pick and protects the analytical IP. The anti-freeriding protection is the release-gating, not the compute cost (compute cost is immaterial).

---

## 9. Anti-circumvention — the neutrality moat

Buddy's neutrality is its primary trust asset. Every design choice and contract term compounds it.

### Design-level protections

- One-directional redaction (§6).
- Sealed claim mechanism — lenders cannot see other lenders' activity at any stage.
- Rate card — Buddy does not set rates per deal, does not favor lenders in rate-setting.
- Borrower pick — Buddy does not pick lenders. Borrower always has veto.
- Daily cadence, 3-slot cap — structural limits prevent any lender from dominating listings.
- White-glove fallback is **"present whatever bids come in"**, not "hand-place with a preferred lender." If only 1 lender claims, borrower sees 1 option. If 0 claim, listing rolls; after 3 rolls, borrower is offered re-list. Buddy never shops deals off-platform.

### Contractual protections — the Lender Marketplace Agreement

**LMA required for marketplace access.** Every lender signs before any claim can be submitted. The LMA includes:

1. Buddy-as-agent fee disclosure (1% of funded amount; borrower also pays $1,000 via Form 159).
2. Prohibition on direct borrower contact outside the Buddy platform until pick.
3. Prohibition on using marketplace data to identify or pursue borrowers who didn't pick them.
4. Data handling / GLBA pass-through obligations.
5. E&O insurance minimums.
6. SBA-eligibility certification (for SBA listings).
7. Anti-circumvention liquidated damages — cash penalty + platform termination for attempting to identify a borrower from a listing or contact a non-picking borrower outside Buddy.
8. LMA is versioned. Lenders re-sign on version bumps before their next claim.

### Audit trail

Append-only `marketplace_audit_log` records every action:
- Lender view of every listing (who, when, what listing_id)
- Every claim, confirm, release
- Every borrower pick and veto
- Every signed-URL download of a sealed package

Immutable, append-only, RLS: brokerage ops sees all; lender sees only their own actions; borrower sees their own deal's actions. This is the evidence trail if circumvention is ever disputed or litigated.

---

## 10. Lender onboarding

**Manual provisioning for the first cohort** (~10 lenders). You negotiate each relationship personally, send the LMA via DocuSign, track signing in `legal_documents`. On signed-LMA receipt:

1. Create the lender's `banks` row with `bank_kind = 'commercial_bank'`.
2. Create the lender's Clerk organization.
3. Create the first lender user via Clerk invite.
4. Insert `lender_programs` row with the lender's stated credit-box criteria (captured during onboarding conversation).
5. Insert `lender_marketplace_agreements` row with LMA version and signed date.
6. Send lender a welcome email with `/lender/listings` URL.

Self-serve lender signup is a future enhancement, deferred until the LMA is stable and the model is proven with ~5 funded deals. Manual onboarding is intentional — it lets you build the first lender relationships personally, learn what the LMA needs to say in production, and filter for lenders who fit the neutrality model.

---

## 11. Compute cost context

Measured cost per fully-packaged brokerage deal: **$2–$3 typical, $5–6 worst-case**. Detailed breakdown in conversation audit log.

Key observation: compute cost is not a design constraint for Buddy. Every design decision in this plan can be made on product and business-model grounds without factoring compute. Regenerating the trident three times during a borrower's session costs ~$1. Running BIE twice on a deal with entity-lock retries costs ~$0.54. Full lifecycle compute is immaterial compared to the $4,500–$11,000+ revenue per funded deal.

---

## 12. Concierge migration prerequisite

The existing `/api/borrower/concierge` route hardcodes `OPENAI_CHAT` and `OPENAI_MINI`. The model registry declares `MODEL_CONCIERGE = OPENAI_CHAT` as legacy with an explicit hard rule that no new call sites should use OpenAI.

**Before Sprint 1 begins**, concierge must migrate to the Gemini-native stack:
- `MODEL_CONCIERGE_REASONING = GEMINI_PRO` (response generation — warmth, judgment, next-question reasoning)
- `MODEL_CONCIERGE_EXTRACTION = GEMINI_FLASH` (structured JSON fact extraction from borrower messages)

Migration spec: `specs/brokerage/prereq-concierge-gemini-migration.md`. This is a prerequisite, not a sprint — cannot write Sprint 1 cleanly against the legacy OpenAI stack because the new `/api/brokerage/concierge` route has to be built Gemini-native from day one.

The legacy `/api/borrower/concierge` route is **deprecated with logging**, not deleted, in Sprint 1. It remains in place for 2 weeks post-ship so any unknown callers surface in logs before removal. See Sprint 1 canonical spec §9.

---

## 13. Sprint sequencing

| Sprint | Deliverable | Depends on | Canonical spec file |
|---|---|---|---|
| Prereq | Concierge Gemini migration + registry cleanup | — | `prereq-concierge-gemini-migration.md` |
| 0 | Buddy SBA Score (extending `sbaRiskProfile.ts`) | Prereq | `sprint-00-buddy-sba-score.md` |
| 1 | Tenant model + `/start` + anonymous brokerage concierge | Prereq, 0 | **`sprint-01-v2-canonical.md`** (supersedes `sprint-01-tenant-and-front-door.md` and `sprint-01-addendum.md`) |
| 2 | Borrower voice on portal (BorrowerVoicePanel, Gemini Live) | 1 | `sprint-02-borrower-voice.md` |
| 3 | Trident wired into borrower portal + preview generation | 1 | `sprint-03-trident-previews.md` |
| 4 | LMA infrastructure + manual lender provisioning + `/lender/*` shell | 0, 1 | `sprint-04-lma-and-lender-portal.md` |
| 5 | Package sealing + Key Facts Summary generator + borrower redaction | 3, 4 | `sprint-05-sealing-and-kfs.md` |
| 6 | Marketplace: preview → claim → pick → atomic unlock → $1,000 at close | 4, 5 | `sprint-06-marketplace-and-pick.md` |

Each sprint produces a shippable artifact. Sprints 4 and 5 can be built in parallel once 0/1/3 are done.

---

## 14. Non-goals

Explicitly out of scope for the brokerage build:

- Multi-brokerage support. There is exactly one Buddy Brokerage tenant.
- Self-serve lender onboarding. Manual provisioning only, for first cohort.
- Non-SBA loan products on the brokerage (conventional commercial, equipment finance, CRE). SBA 7(a) / 504 / Express only.
- Real-time bidding (rejected — daily cadence with 3-slot cap is the final model).
- Lender-to-lender communication on the platform (no chat, no co-lending discussions).
- Borrower-to-lender negotiation pre-pick (borrower picks based on what lenders put in the claim form; any negotiation happens post-pick outside Buddy).
- Mortgage escrow, treasury, ACH origination, or any capability that would turn Buddy into an execution layer. Buddy remains the analytical / presentation layer only.

---

## 15. Open questions tracked in one place

None blocking. All design decisions above are locked as of 2026-04-24. Items explicitly deferred to later sprint specs:

- Exact Buddy SBA Score weights and component scoring curves (Sprint 0).
- Rate card table structure and nightly recompute job (Sprint 6).
- Signed-URL TTL for winning-lender package downloads (Sprint 6).
- Stripe integration details for the two-sided close-time fee fire (Sprint 6 or Sprint 7).
- LMA legal document content (parallel workstream — SBA counsel engagement).

---

## 16. Glossary

- **Trident** — the three borrower-facing deliverables: business plan, projections, feasibility study.
- **Package** — the full E-Tran-ready SBA submission bundle: trident + credit memo + risk profile + SBA forms (1919, 413, 159) + source documents. Released to the winning lender at borrower pick.
- **Key Facts Summary (KFS)** — the one-page borrower-redacted listing view seen by matched lenders during preview and claim. Built from facts + Buddy SBA Score + eligibility confirmations.
- **Preview window** — 24-hour period during which matched lenders can read a listing's KFS but cannot yet claim.
- **Claim window** — the same-day window (9am–5pm CT) during which matched lenders can claim slots (first 3 win).
- **Atomic unlock** — the transactional event at borrower pick: trident generates and delivers to borrower, full package releases to picked lender, losing claims finalize, all as one operation.
- **LMA** — Lender Marketplace Agreement. Legal contract required for marketplace access.
- **Rate card** — deterministic table mapping (SBA program × score band × loan tier × term) → rate. Lenders commit to this rate when they claim; they do not set rates per deal.
- **Token hash** — the SHA-256 hash of an anonymous session token. Database stores the hash; the raw token lives only in the HTTP-only cookie. See §3a.

---

## 17. Authoritative spec index

The canonical sprint spec for each unit of work is listed in §13. The following historical/superseded files exist in the folder but are NOT authoritative and NOT implemented from:

- `sprint-01-tenant-and-front-door.md` — original Sprint 1 base spec. Pre-dates Gemini migration prereq, Sprint 0 dependency, and session-security hardening. **Superseded by `sprint-01-v2-canonical.md`.**
- `sprint-01-addendum.md` — temporary patch layer on the original base spec. **Superseded by `sprint-01-v2-canonical.md`.**

Both will be deleted in a cleanup PR after builders have fully migrated to the v2 canonical. Until then they remain as historical context only.

**Rule for builders:** if you're about to implement a sprint, open §13, find the row, and implement from the file named in the "Canonical spec file" column. Do not implement from any other file with a similar name.
