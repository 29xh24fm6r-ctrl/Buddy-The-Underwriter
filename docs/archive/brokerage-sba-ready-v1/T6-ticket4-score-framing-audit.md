# Ticket 4 — SBA Score / Readiness borrower-facing framing audit

**Date:** 2026-07-15
**Scope:** audit only, per the ticket's own framing — the actual product
decision on how the Buddy SBA Score / readiness score should be worded and
positioned to a borrower is reserved for Matt. This document is the audit
input to that decision, not the decision itself.

**Method:** four parallel sweeps covering (1) borrower-facing UI components,
(2) scoring/narrative computation logic, (3) PDF renderers + narrative/safe-
copy modules, (4) concierge/chat copy + marketing landing pages. ~90 files
read directly; repo-wide grep for probability/odds/guarantee language across
`/src` and `/specs`.

## Headline finding

**No borrower-facing string anywhere in the codebase states or implies a
specific probability, percentage chance, or odds of loan approval.** No hits
for patterns like "% chance", "likely to be approved", "approval odds",
"probability of approval", "guaranteed approval" in any runtime-generated
copy, marketing page, or concierge/chat prompt.

The codebase has real, deliberate, and *tested* guardrails against this
exact failure mode:

- `src/lib/portal/borrowerSafeCopy.ts` — `FORBIDDEN_BORROWER_TERMS` blocks
  `"readiness score"`, `"credit score"`, `"underwriting prediction"`,
  `"underwriting_score"` from borrower-facing portal copy at the code level.
- ~15+ `__tests__` files (`buildBorrowerReadinessViewModel.test.ts`,
  `buildBorrowerGuidanceViewModel.test.ts`, `buildBorrowerDealHealthViewModel.test.ts`,
  etc.) assert `"approval odds"`, `"probability of approval"`, `"guaranteed
  funding"`, `"pre-approved"`, `"you qualify"` **must not appear** in
  rendered output — a CI-enforced regression net, not just a design
  intention.
- Explicit anti-probability doc comments baked directly into the scoring
  code: `buildBorrowerReadinessViewModel.ts:9-14` ("Readiness = operational
  completeness, NOT credit approval. No fake precision or implied approval
  odds."), `readiness-score.ts:5` ("NOT a promise of approval, but a
  progress proxy."), `calculateBorrowerReadiness.ts:5`, `borrower-progress`
  API route comments, `confidenceLabel.ts:24-26`.
- `sbaPackageNarrative.ts` bakes the guardrail into every Gemini prompt that
  generates borrower plan narrative text (8 separate prompts): *"Do NOT
  mention loan approval, denial, creditworthiness, or risk grade."*
- Public marketing disclaimer, `conversionFunnel.ts:13`: *"Buddy does not
  guarantee loan approval. SBA loan approval is subject to lender
  underwriting, SBA guidelines, and borrower eligibility."* — with a
  self-test (`validatePublicContent`) that fails the build if "guaranteed"
  appears in the public headline.
- Product-framing decision already on record for the score itself,
  `specs/brokerage/sprint-00-buddy-sba-score.md:14`: *"The score is not a
  credit decision. It is a compliance-and-strength summary... Lenders still
  apply their own credit box."* Score bands are lender-fit/pricing tiers
  (institutional prime / strong fit / selective fit / specialty lender /
  not marketplace-eligible), never phrased as approval percentages. Line
  460 explicitly forbids letting an LLM touch the score narrative, to keep
  it deterministic and non-freelancing.

## Best-practice example (for Matt's reference — closest thing to a "right
answer" already shipped)

`src/components/borrower/ReadinessScoreCard.tsx:140-141` — *"This score
shows your application progress, not approval likelihood. Final credit
decisions are made by human underwriters."* Paired with
`buildBorrowerDealHealthOverviewCards.tsx:90` ("Readiness reflects package
completeness, not loan approval"), `BorrowerSubmissionEducationCard.tsx:23`
("Submission readiness reflects package preparation status, not a lending
decision"), and `BorrowerTrustCaveatCard.tsx:26-28` ("it isn't a lending
decision and doesn't change how a lender will review the request") — four
independent components landed on essentially the same hedge language
without being told to. That's the de facto house style; worth Matt
formalizing it as the canonical disclaimer wording.

## Real finding requiring attention (not a framing question — a genuine gap)

**`src/lib/sba/difficulty.ts`** — a legacy/parallel "SBA Difficulty Index"
scorer, separate from the real Buddy SBA Score pipeline (`src/lib/score/`).
Its own module doc comment (lines 3-8) uses exactly the framing this audit
was checking for: *"Gamified scoring system that shows borrowers their SBA
readiness: 'You're 87% SBA-ready. Two small fixes unlock approval.'"* — the
phrase **"unlock approval"** frames the percentage as a gate to getting
approved. `calculateReadinessPercentage()` (lines 210-224) deliberately
applies a non-linear transform "to feel more achievable" per its own
comment — i.e., the displayed percentage is intentionally distorted UX, not
a real probability, yet is presented to the borrower as "SBA-ready %."

This is live: `formatDifficultyScore()`/`calculateDifficultyScore()` are
wired into `/api/deals/[dealId]/sba` (`evaluate-difficulty` action,
route.ts:856-880) and return `readiness_percentage` in the JSON response.
No frontend caller was found in a repo-wide search, so it does not appear
to currently reach a real borrower screen — but it is a shippable,
un-gated endpoint whose *design intent* directly contradicts the
`FORBIDDEN_BORROWER_TERMS`/anti-probability convention enforced everywhere
else in the codebase. Recommend either retiring this module or bringing it
in line with `readiness-score.ts`'s disclaimer convention. Left untouched
in this pass — a fix here is a framing/product call (delete vs. rewrite vs.
repurpose), not something to make unilaterally.

## Secondary finding, banker-internal (flagged, not borrower-facing)

`src/lib/narrative/generateNarrative.ts:195` — `generateRecommendation()`,
an internal credit-memo narrative generator, contains: *"The loan is ready
for SBA submission with high confidence of approval."* This function
appears banker-internal (feeds credit-memo drafts, not borrower portal
copy), so it falls outside Ticket 4's borrower-facing scope strictly read —
but the phrasing itself is a liability risk regardless of audience, and
there is no scrubber preventing this text from being reused in a
borrower-facing context later. Flagged for awareness; not fixed in this
pass since it's outside a strict "borrower-facing" audit scope.

## Borderline / inconsistency findings (missing the disclaimer other
components carry — not wrong, just inconsistent)

None of these state a probability of approval. They are flagged because
sibling components elsewhere in the same product carry an explicit
"not approval likelihood" hedge and these don't:

- `src/components/sba/SbaScoreCard.tsx` — "SBA Readiness Score" + "Ready
  for submission," no disclaimer. Unclear if borrower-facing or
  banker/internal (renders on `/deals/[dealId]/sba`, which reads as an
  internal console).
- `src/components/borrower/BorrowerEtranCard.tsx` — bare readiness score
  with "Ready for E-Tran" status, no disclaimer.
- `src/components/borrower/BorrowerGuidancePanel.tsx` (the non-`guidance/`
  variant — a second, apparently-duplicate readiness display) — score
  bands like "Almost underwriter-ready" with no disclaimer, unlike its
  sibling in `guidance/BorrowerGuidancePanel.tsx`.
- `src/components/borrower/EligibilityStatusCard.tsx` — binary
  "Eligible"/"Not eligible" for SBA 7(a) program eligibility (an objective,
  rules-based determination) with no language distinguishing "eligible for
  the program" from "will be approved."
- `src/app/(app)/deals/[dealId]/readiness/page.tsx` — page titled "Deal
  Readiness / SBA Certification," shows a bare "Readiness Score," no
  disclaimer anywhere on the page. The word "Certification" here is itself
  worth a second look — it's a stronger claim than "readiness."
- `src/app/(app)/deals/[dealId]/borrower-progress/page.tsx` — no
  disclaimer despite showing score deltas ("Total Lift," "Starting/Current
  Score") and encouraging copy ("You are nearly there").
- `src/lib/agents/borrowerComms.ts:55-73` — `draftReadyForReviewEmail()`,
  an **auto-sent** (`requires_approval: false`) borrower email: "Great
  news! Your SBA loan application has passed all automated checks...
  Application Readiness Score: X/100." No hedge, unlike the UI card that
  shows the same underlying number.
- `src/components/marketing/FranchiseLandingPage.tsx` — heavily emphasizes
  "SBA Score"/"Franchise Quality Score" and reuses the "Smarter Analysis.
  Stronger Approvals." tagline, but — unlike `BrokerageLandingPage.tsx` —
  carries **no** "Buddy does not guarantee loan approval" disclaimer
  anywhere on the page. Documentation-consistency gap, not a violation on
  its own.
- `src/components/marketing/BrokerageLandingPage.tsx:177-181` — hero stat
  "92% / Avg. confidence score" with no definition given on the page for
  what "confidence" measures (most likely AI-extraction confidence, not
  approval likelihood — but undefined on the page itself). Closest thing to
  a genuinely ambiguous public-facing number in the whole audit.
- `src/lib/sba/sbaRiskProfile.ts:162` — cites a real historical SBA default
  rate by NAICS code as a population-level statistic, explicitly caveated
  as "individual loan outcomes depend on borrower-specific factors." Not an
  approval-odds claim (it's a default-rate disclosure, a legitimate
  underwriting benchmark), but it's the closest thing to statistical/
  probability language in the pipeline and worth a compliance eyeball.
- `src/lib/flagEngine/flagFromRatios.ts:51` — banker/credit-memo-facing (not
  borrower portal): "Approval will likely require mitigants such as
  additional collateral..." — discusses likely *conditions*, not odds.
  Outside strict borrower-facing scope; noted for completeness.

## Recommendation for Matt (not a decision — options for consideration)

1. Formalize the `ReadinessScoreCard.tsx`/`buildBorrowerDealHealthOverviewCards.tsx`
   hedge language as the canonical disclaimer and add it to the
   inconsistent surfaces listed above (`SbaScoreCard.tsx`, `BorrowerEtranCard.tsx`,
   the duplicate `BorrowerGuidancePanel.tsx`, `readiness/page.tsx`,
   `borrower-progress/page.tsx`, `borrowerComms.ts`'s auto-sent email).
2. Decide the fate of `src/lib/sba/difficulty.ts` — retire it, or rewrite
   its copy/design intent to match the rest of the codebase's convention.
   This is the one item in this audit that reads as a real gap rather than
   an inconsistency.
3. Add the `BrokerageLandingPage.tsx` disclaimer block to
   `FranchiseLandingPage.tsx` for consistency, and consider defining what
   "confidence score" means next to the 92% stat.
4. Decide whether `EligibilityStatusCard.tsx`'s "Eligible"/"Not eligible"
   language needs a program-eligibility-vs-approval-likelihood clarifier.

No code was changed as part of this ticket's audit portion, per the
ticket's own scope.
