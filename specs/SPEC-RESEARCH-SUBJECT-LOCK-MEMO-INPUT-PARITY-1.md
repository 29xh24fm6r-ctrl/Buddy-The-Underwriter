# SPEC-RESEARCH-SUBJECT-LOCK-MEMO-INPUT-PARITY-1 — Research subject builder reads the borrower-representation / memo-input contract

**Status:** Draft (rev 1 — researched against live code + dc52c626 DB state on 2026-06-02).
**Priority:** P0 — research quality gate correctness.
**Branch:** `fix/research-subject-lock-memo-input-parity-1` off `main`.
**Workstream:** Research quality gate / subject lock (continues #470/#471 borrower-representation parity work).
**Estimate:** ~2–3h (new builder + type extension + 2 call-site rewrites + tests). **No schema migration.**

**Sibling contract this extends:** `SPEC-UNDERWRITE-GUARD-BORROWER-REPRESENTATION-PARITY-1` (commit `6104ef8f`, PR #471) created `src/lib/borrower/borrowerRepresentation.ts` so lifecycle + underwrite agree on "is a borrower attached?" Research never adopted that contract. This spec brings the research subject + subject lock into the same source-of-truth.

---

## PIV (Problem, Invariant, Verification)

### Problem

The research mission runs for deal `dc52c626-fa42-40d3-9b74-7d197ce36bac` (OmniCare Deal Review), but the pre-research **subject lock** fails with all four reasons:

- "Borrower legal name is missing or too short"
- "Industry not identified — NAICS is missing or placeholder (999999)"
- "Business description is missing — required for meaningful research"
- "No identifying anchor — provide website, DBA, or banker summary"

This is a **source-of-truth / population bug, not a validation-logic bug.** The validator at
[src/lib/research/subjectLock.ts:39-93](src/lib/research/subjectLock.ts#L39-L93) is already correct — it accepts `naics_description`, `business_description`, and `banker_summary` as valid satisfiers. It fails only because every input it receives is empty.

**Verified DB state for dc52c626 (queried 2026-06-02):**

| Source | Field | Value |
|---|---|---|
| `deals.borrower_id` | — | **null** |
| `deals.borrower_name` | — | `"OmniCare Deal Review"` |
| `deals.name` | — | `"OmniCare Deal Review"` |
| `deals.display_name` / `state` | — | null / null |
| `deal_borrower_story.business_description` | — | `"A Business Process Outsourcing (BPO) (Call Center) firm founded by Matt Hunt that operates call centers across the US and internationally…"` |
| `deal_borrower_story.products_services` | — | `"Call center and customer support services…"` |
| `deal_borrower_story.customers` | — | `"…Aetna, Home Depot, …"` |
| `deal_borrower_story.banker_notes` | — | `"A $1.5M tiered revolving line of credit is proposed…"` |
| `deal_management_profiles` | — | **Matt Hunt, President, 100%** (+ industry_experience narrative) |
| `ownership_entities` | — | **0 rows** |

**Root cause — two independent code paths both read only legacy `borrowers` linkage:**

1. **`POST /api/deals/[dealId]/research/run`** at
   [run.ts:70-140](src/app/api/deals/[dealId]/research/[action]/_handlers/run.ts#L70-L140)
   builds the `MissionSubject` from exactly two sources:
   - `borrowers` (`legal_name`, `naics_code`, `naics_description`, `city`, `state`) — **gated on `deal.borrower_id`**, which is null, so `legalName=""`, `naicsCode="999999"`, `naicsDescription=undefined`, geography defaults to `"US"`.
   - `ownership_entities.display_name` for principals — **empty for this deal** (Matt Hunt lives in `deal_management_profiles`, which is never read), so `principals=[]`.

   It never reads `deals.borrower_name`/`name`, `deal_borrower_story`, or `deal_management_profiles`. It also never sets `business_description`, `website`, `dba`, `banker_summary`, or `banker_override`.

2. **The `MissionSubject` type** at [types.ts:26-40](src/lib/research/types.ts#L26-L40) has **no** `business_description` / `website` / `dba` / `banker_summary` / `banker_override` fields. `runMission` reads them via `(subject as any).business_description` at
   [runMission.ts:406-418](src/lib/research/runMission.ts#L406-L418) — so even if `run.ts` wanted to pass them, the type wouldn't carry them, and it doesn't. All four arrive `undefined`.

3. **`GET /api/deals/[dealId]/research/flight-deck`** at
   [flight-deck.ts:49-94](src/app/api/deals/[dealId]/research/[action]/_handlers/flight-deck.ts#L49-L94)
   independently re-derives the subject lock from `borrowers` **only**, gated on `borrower_id` (null → `borrower=null` → `hasName=false`, `hasNaics=false`, `hasGeo=false`). It emits "Borrower legal name missing", "Industry classification missing or placeholder (999999)", "Geography (city/state) missing" and sets `subjectLocked: false` — contradicting lifecycle/underwrite, which already treat dc52c626 as borrower-represented via the #471 contract.

**Net effect:** Buddy has complete, banker-certified memo-input context for this deal (story + management profile + deal name), but research throws it all away because `borrower_id` is null. Subject lock fails with garbage-in reasons that are factually wrong.

This is the **same bug class** memory flags as `feedback_classification_not_ai_problem` — the data exists and is stamped elsewhere; the consuming path reads a stale/legacy source and a missing resolver, not an AI failure.

### Invariant

| Surface | Behavior after fix |
|---|---|
| `buildResearchSubject(sb, dealId, bankId)` (**new**, `src/lib/research/buildResearchSubject.ts`) | Single source of truth for the research subject. Resolves name, business description, industry/NAICS, principals, geography, and identifying anchor from the borrower-representation / memo-input sources — exactly the sources `hasBorrowerRepresentation` already trusts. Returns the enriched `MissionSubject` plus `{ represented: boolean, naics_provisional: boolean }`. |
| `assembleResearchSubject(raw)` (**new**, pure) | Pure resolution logic split out of the async loader (mirrors `borrowerIsRepresented` / `hasBorrowerRepresentation` split in [borrowerRepresentation.ts:24-67](src/lib/borrower/borrowerRepresentation.ts#L24-L67)). Unit-testable with no DB. |
| `MissionSubject` ([types.ts:26-40](src/lib/research/types.ts#L26-L40)) | Extended with first-class optional fields: `business_description`, `website`, `dba`, `banker_summary`, `banker_override`, `naics_provisional`. The `(subject as any)` casts in `runMission` are removed. |
| `POST …/research/run` | Replaces the inline `borrowers` + `ownership_entities` loading (run.ts:70-140) with `buildResearchSubject(...)`. Passes the full enriched subject to `runMission`. `annual_revenue` / `loan_amount` / `loan_purpose` continue to be resolved (moved into the builder). Existing-mission short-circuit and `bankId` resolution unchanged. |
| `runMission` subject-lock call ([runMission.ts:404-418](src/lib/research/runMission.ts#L404-L418)) | Reads the now-typed fields directly. No logic change to `validateSubjectLock`. |
| `GET …/research/flight-deck` | Replaces the inline `borrowers`-only check with `buildResearchSubject(...)` + `validateSubjectLock(...)`. `subjectLocked` = `validateSubjectLock(...).ok`. Blockers come from the validator's reasons, not a re-implemented check. |
| Industry / NAICS handling | NAICS `999999` no longer erases all context. When `borrowers.naics_code` is absent/placeholder, the builder derives a **provisional `naics_description`** from `business_description` / `products_services` (banker-certified text) and sets `naics_provisional: true`. This satisfies the validator's `hasNaicsDesc` branch (description > 5 chars) **without fabricating a NAICS number.** No new NAICS digits are invented. |
| Flight-deck NAICS blocker | When industry is resolved only provisionally, NAICS is **downgraded from a `critical` subject-lock blocker to a `high`-priority advisory action** with precise copy "Set industry classification / NAICS" and a deep link to the industry field. It does NOT force `subjectLocked: false`. Only a genuinely empty industry context (no NAICS *and* no derivable description) remains a hard blocker. |
| Identifying anchor | The builder composes a `banker_summary` from `banker_notes` → `competitive_position` → (`principal name` + `company_name` + `business_description`) so the anchor check passes whenever a banker-certified story or management profile exists. |
| No borrower at all | When `hasBorrowerRepresentation` is false (no `borrower_id`, no story, no management profile), the builder returns `represented: false` with an empty subject; `validateSubjectLock` correctly fails. The gate is preserved for genuinely empty deals. |
| Lifecycle / underwrite / JourneyRail / Memo Inputs | **Unchanged.** This spec only adds a reader. The `borrowerRepresentation` contract is consumed, not modified. |
| Schema | **No migration.** All source columns (`deals.borrower_name`/`name`/`display_name`, `deal_borrower_story.*`, `deal_management_profiles.*`) already exist. |

#### Resolution rules (the builder)

1. **company name** — `borrowers.legal_name` (when `borrower_id` set) → `deals.borrower_name` → `deals.display_name` → `deals.name`. *(dc52c626 → "OmniCare Deal Review".)*
2. **business_description** — `deal_borrower_story.business_description` → `products_services` → `revenue_model` → `banker_notes`.
3. **naics_code** — `borrowers.naics_code` when present and ≠ `999999`; else `"999999"` (sentinel preserved).
4. **naics_description** — `borrowers.naics_description` when present; else derive a provisional industry phrase from `business_description` / `products_services` and set `naics_provisional: true`. *(dc52c626 → e.g. "Business Process Outsourcing (BPO) / call center / customer support services".)*
5. **principals** — `ownership_entities.display_name` (+title) when rows exist; else `deal_management_profiles.person_name` (+title, +ownership_pct). *(dc52c626 → Matt Hunt, President, 100%.)*
6. **banker_summary (anchor)** — `deal_borrower_story.banker_notes` → `competitive_position` → composed (`"{principal} — {company}: {business_description}"`).
7. **geography / city / state** — `borrowers.city`/`state` → `deals.state` → default `"US"` (preserves current run.ts behavior).
8. **annual_revenue / loan_amount / loan_purpose** — unchanged: `deal_financial_facts.TOTAL_REVENUE` + latest `deal_loan_requests`.

#### Expected outcome for dc52c626 after fix

`validateSubjectLock` receives: `company_name="OmniCare Deal Review"` (≥3 ✓), `naics_description="…BPO / call center…"` (>5 ✓ — clears the industry hard-gate), `business_description` populated (≥10 ✓), `geography="US"` (✓), `banker_summary` from `banker_notes` (>10 ✓). **All five clear; subject lock passes.** `naics_provisional=true`, so flight-deck shows an advisory (not critical) "Set industry classification / NAICS" action. Principals include Matt Hunt.

### Verification (V-N)

- **V-1** — Unit `assembleResearchSubject`: `borrower_id` null + story present → `company_name` from `deals.borrower_name`, `business_description` from story; `validateSubjectLock(subject)` returns `{ ok: true }`. *(Acceptance a.)*
- **V-2** — Unit `assembleResearchSubject`: `borrower_id` null + management profile present (no `ownership_entities`) → `principals` contains the profile person (name + title). *(Acceptance b.)*
- **V-3** — Unit `assembleResearchSubject`: no `borrower_id`, no story, no profile → `represented: false`, empty subject, `validateSubjectLock` returns `{ ok: false }` with name + industry reasons. *(Acceptance c — gate preserved.)*
- **V-4** — Unit `assembleResearchSubject`: `naics_code` missing/`999999` but `business_description` present → `naics_description` derived, `naics_provisional: true`, `validateSubjectLock` does **not** report "Industry not identified". *(Acceptance d — missing NAICS does not suppress story context.)*
- **V-5** — Unit: `borrower_id` present with `borrowers.legal_name` + real `naics_code` → builder prefers the borrowers row (legacy parity preserved, `naics_provisional: false`).
- **V-6** — Unit: anchor composition — story with `business_description` + principal but no `banker_notes` → `banker_summary` composed and non-empty; anchor check passes.
- **V-7** — Integration (run.ts): mock the builder, assert `runMission` is called with the enriched subject; the four reported failure reasons no longer appear in the persisted `buddy_research_quality_gates.gate_failures` for the dc52c626 fixture.
- **V-8** — Integration (flight-deck.ts): for a fixture matching dc52c626, response `subjectLocked: true`, `blockers` excludes "Borrower legal name missing" / "Business description missing" / "No identifying anchor", and NAICS appears only as a `high`-priority advisory action with copy "Set industry classification / NAICS".
- **V-9** — Production smoke: re-run research on dc52c626; confirm subject lock no longer writes a `subject_lock` `manual_review_required` gate event, and flight-deck `subjectLocked` is true.

---

## §0 — Findings that shaped this spec (read before implementing)

1. **`validateSubjectLock` is already correct — do not touch its logic.** It accepts `naics_description` and `banker_summary`. The only change in `subjectLock.ts` (if any) is dropping `(subject as any)` once the type carries the fields. The failure is 100% empty inputs.
2. **`MissionSubject` must be extended**, or the new fields stay invisible to the validator (they're read via `as any` today). This is the smallest change that makes the new context first-class.
3. **`ownership_entities` is empty for dc52c626; management lives in `deal_management_profiles`.** The principal anchor gap is real and separate from the name/industry gap — the builder must read management profiles as the fallback (Acceptance b depends on this).
4. **Geography already defaults to `"US"`** in run.ts, so it is NOT among the live failure reasons for dc52c626. Preserve that default; do not add a new geography hard-gate.
5. **No `banker_override` hack needed for dc52c626** — every check clears on real data. Reserve `banker_override` for explicit banker attestation, do not auto-set it.

## Non-goals (do NOT touch)

GCF, OD, pricing, memo generation, extraction, DB schema/migrations, and borrower-profile *persistence* (the Attach Borrower write path). The `borrowerRepresentation` contract is read-only here. No changes to `validateSubjectLock` thresholds or the completion-gate trust grading.

## Open items to confirm during implementation

- **Exact deep-link target** for the "Set industry classification / NAICS" advisory action in flight-deck. Candidates: the Attach Borrower / Memo Inputs industry field, or the cockpit anchor pattern used elsewhere (`/deals/${dealId}/cockpit?anchor=borrower-attach`). Confirm the real field/anchor before hardcoding.
- Whether `buildResearchSubject` should be `"server-only"` (it does DB I/O) while keeping `assembleResearchSubject` pure and importable by tests — follow the `borrowerRepresentation.ts` precedent (pure core, no `server-only`; async accessor takes `sb` as a param).
