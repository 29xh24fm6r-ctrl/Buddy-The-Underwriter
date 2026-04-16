# BUDDY BROKERAGE — LAUNCH PLAN
## Friday, April 25, 2026 — 10 Days to Live

**Status:** ACTIVE — this is the operating plan we live by until launch.
**Owners:** Matt (vision/strategy), Claude (spec reconciliation), ChatGPT (architecture/implementation).
**Created:** April 15, 2026
**Target Launch:** Friday, April 25, 2026 — first paid borrower deal submitted to a lender.

---

## 1. THE GOAL

Launch the Buddy SBA & Conventional Loan Brokerage by Friday, April 25, 2026.

**Definition of "launched":**
- buddytheunderwriter.com has a borrower-facing front door (built by Wife/CEO).
- A real prospective borrower can start a conversation with Buddy.
- Buddy collects their financial profile, runs SBA compliance checks, generates the complete loan package (business plan, projections, SBA forms, sources & uses, approval probability score).
- The CCO reviews and approves the package within 15-20 minutes.
- The package is submitted to one of our lender network banks via email.
- We charge $1,000 packaging fee (financed into loan) + 1-2% lender referral fee.

**Anti-goal:** Do NOT build the visual perfection. Do NOT build the participation engine. Do NOT build the white label product. Do NOT build the full conversational UI we described in strategy. Build the revenue-generating MVP.

---

## 2. WHAT WE ALREADY HAVE (THE GIFT)

After auditing the repo, we have FAR more than I initially scoped. The infrastructure is overwhelmingly already in place:

### Underwriting Engine — LIVE
- **Multi-Agent SBA System** (`src/lib/agents/`): SBA Policy Agent, Eligibility Agent, Cash Flow Agent (DSCR), Risk Synthesis Agent — all production-ready (`SBA_GOD_MODE_PHASE_1_SHIPPED.md`)
- **SBA God Mode Architecture** (`SBA_GOD_MODE_IMPLEMENTATION.md`): Triple-source retrieval (deal docs + SBA SOP + bank policies), JSON Logic rule engine, 4-persona committee, citation-grade outputs
- **Borrower Concierge API** (`/api/borrower/concierge`): Conversational intake that asks the minimum next question that changes the decision
- **Eligibility Check API** (`/api/deals/[dealId]/eligibility/check`): PASS/FAIL/UNKNOWN in <2 seconds with SOP citations
- **Auto-Document Request API** (`/api/deals/[dealId]/documents/auto-request`): AI-generated checklists with priority + SOP citations
- **Document Extraction**: Gemini 2.0 Flash via Vertex AI — production tested
- **Reconciliation Engine**: Active — caught real discrepancy on Samaritus deal
- **Credit Memo Generation**: Florida Armory standard, Phase 33
- **AI Risk Scoring**: BB+ live with grade + base rate + risk premium
- **Buddy Intelligence Engine (BIE)**: 9-section memo content via Gemini 3.1 Pro

### Borrower Portal — LIVE
- **Borrower Portal** (`src/app/(borrower)/portal`): Token-based access, progress tracking, pack suggestions, document requests (`BORROWER_PORTAL_QUICKSTART.md`)
- **Borrower Concierge Sessions**: DB table + API for conversational intake
- **Borrower Wizard**: Form-based intake fallback

### SBA-Specific
- **SBA Borrower Readiness Module** (Phase 57): 5-pass forward model, sensitivity analysis, break-even, narrative, PDFKit package
- **SBA Risk Profile Enhancement** (Phase 58A): 4-factor scorer, NAICS benchmarks, new business protocol per SOP 50 10 8
- **SBA SOP Compliance**: DSCR thresholds (1.25x new vs 1.10x established), deal_type='SBA', size standards
- **SBA Forms Library** (`src/lib/sbaForms`): Form generation infrastructure

### Voice & Conversational
- **Buddy Voice Gateway** (Phase 51): Gemini Live native audio, Fly.io, working
- **Voice Memory Breakthrough**: Just achieved — context persists across session

### Marketing Site — EXISTS
- `src/app/page.tsx` + `src/components/marketing/*`: HeroConvergence, ConvergenceTimeline, ProofBand, HowItWorks3Steps, OutcomesGrid, FAQ, FinalCTA
- Currently positioned as bank-facing ("Loan Operations System")
- **Needs:** Reposition for borrower-facing brokerage

### Lender Infrastructure
- `src/app/lender/` directory exists
- `src/lib/lender/` and `src/lib/lenders/` exist
- Bank routing logic already built (`test-bank-routing.sh`)

### What This Means
**~85% of the technical work is done.** This is not a build — it's a wire-up and reposition.

---

## 3. THE GAP (10-DAY SPRINT)

What stands between us and a paying borrower on Friday, April 25:

### Gap 1 — Borrower-Facing Marketing Site
The current homepage is bank-positioned. Wife/CEO needs to rebuild for borrower-facing brokerage.

### Gap 2 — Franchise Directory Module
SBA Franchise Directory ingestion + lookup API. Per Matt's vision: a god-tier franchise module is differentiator. MVP version for launch: directory loaded, eligibility verification working, surfaced in borrower conversation.

### Gap 3 — End-to-End Borrower Flow
The pieces exist (concierge, eligibility check, document request, package generation) but need to be stitched into a single coherent borrower journey: landing → conversation → package → review → submission.

### Gap 4 — Lender Submission Workflow
Manual email-based submission to launch. Three banks confirmed. Email template + PDF package + tracking sheet.

### Gap 5 — Pricing & Disclosure
SBA Form 159 generation. $1,000 packaging fee disclosure. Borrower agreement.

### Gap 6 — First Borrower Pipeline
Wife/CEO needs to start conversations in franchise buyer communities NOW so we have a real prospect ready to test the system on Day 8.

---

## 4. THE THREE-TIER OPERATING SYSTEM

### Matt — Vision, Architecture, Bank Relationships
- Locks in 3 lender bank relationships by Day 3
- Reviews specs from Claude before passing to ChatGPT
- Final architectural decisions
- Verifies all GitHub commits land on main

### Claude — Spec Reconciliation, Compliance, Quality Gate
- Inspects every spec against live codebase before implementation
- Writes build-ready specs reconciled with actual schema and types
- Reviews PRs for compliance with BUDDY_BUILD_RULES.md
- Catches phantom commits, schema mismatches, fact key drift
- Maintains this launch plan

### ChatGPT / Antigravity — Implementation
- Builds against Claude-reconciled specs only
- Never receives raw vision specs
- Posts AAR after each phase
- Verifies via GitHub API that commits landed

### The Spec Workflow (Permanent Rule)
```
Matt vision → Claude inspects schema/types → Claude writes spec →
ChatGPT implements → Matt verifies via GitHub → Claude updates roadmap
```

---

## 5. THE 10-DAY SPRINT PLAN

### DAY 1 — TUESDAY, APRIL 16 (TODAY)

**Matt:**
- [ ] Identify 5 target lender banks for initial network. Reach out to top 3 today.
- [ ] Confirm wife/CEO is starting on website tomorrow morning.
- [ ] Approve this launch plan.

**Wife/CEO:**
- [ ] Sketch the borrower-facing site — homepage hero, value prop, $1k vs $10k message.
- [ ] Choose tool: Webflow, Squarespace, or directly into Next.js.
- [ ] Begin identifying franchise buyer communities for prospect outreach.

**Claude:**
- [ ] Spec the SBA Franchise Directory ingestion module (PHASE_FRANCHISE_DIR_INGEST_SPEC.md).
- [ ] Spec the borrower flow stitching (PHASE_BORROWER_BROKERAGE_FLOW_SPEC.md).
- [ ] Audit existing borrower concierge route for production readiness.

**ChatGPT:**
- [ ] Standby for spec delivery. Begin reviewing existing `src/lib/agents/` and `src/lib/sba/` codebase.

### DAY 2 — WEDNESDAY, APRIL 17

**Matt:**
- [ ] Follow up on lender outreach. Goal: 1 verbal yes from a lender bank.
- [ ] Review Claude's specs from Day 1.

**Wife/CEO:**
- [ ] Build homepage. Hero + value prop + CTA. Live on staging URL.
- [ ] Begin About/Team page with three founder bios.
- [ ] Make first 5 outreach contacts in franchise buyer communities.

**Claude:**
- [ ] Reconcile Day 1 specs against schema. Hand off to ChatGPT.
- [ ] Spec the SBA Form 159 generation + $1,000 packaging fee disclosure module.
- [ ] Spec the lender submission workflow (email-based MVP).

**ChatGPT:**
- [ ] Implement SBA Franchise Directory ingestion: download xlsx from sba.gov, parse, load into Supabase, build `/api/sba/franchise/verify` endpoint.
- [ ] Test against real franchise lookups.
- [ ] Commit + post AAR.

### DAY 3 — THURSDAY, APRIL 18

**Matt:**
- [ ] Lock first lender relationship in writing (referral fee terms, deal flow agreement).
- [ ] Identify second and third lender banks for sign-up Days 4-5.
- [ ] Verify Day 2 commits via GitHub API.

**Wife/CEO:**
- [ ] Complete homepage + About page. Site is live on production domain.
- [ ] Build "How It Works" page (3-4 steps, dead simple).
- [ ] Build dedicated franchise buyers landing page.
- [ ] 10+ outreach contacts logged.

**Claude:**
- [ ] Reconcile Day 2 specs. Hand off to ChatGPT.
- [ ] Spec the package quality review workflow for CCO.
- [ ] Spec the approval probability scoring tuning for franchise deals.

**ChatGPT:**
- [ ] Implement borrower flow stitching: landing page CTA → concierge conversation → eligibility check → document collection → package generation. Single coherent journey.
- [ ] Wire franchise directory verification into concierge flow.
- [ ] Commit + post AAR.

### DAY 4 — FRIDAY, APRIL 19

**Matt:**
- [ ] Lock second lender relationship.
- [ ] First end-to-end manual run-through with a synthetic borrower (Matt acts as borrower, walks through entire flow).
- [ ] Document everything that breaks or feels wrong.

**Wife/CEO:**
- [ ] Lender-facing landing page ("Join the Buddy Lender Network").
- [ ] Contact form + conversion paths complete.
- [ ] 20+ outreach contacts logged. Identify 1-2 warm prospects for Day 8 test.

**Claude:**
- [ ] Reconcile package quality review spec.
- [ ] Spec the production hardening punch list based on Matt's Day 4 walkthrough.

**ChatGPT:**
- [ ] Implement SBA Form 159 generation + packaging fee disclosure.
- [ ] Implement lender submission workflow: package PDF + email template + Supabase tracking table.
- [ ] Commit + post AAR.

### DAY 5 — SATURDAY, APRIL 20

**Matt:**
- [ ] Lock third lender relationship.
- [ ] Second end-to-end walkthrough — this time with the CCO acting as borrower (banker eyes catching issues).
- [ ] Punch list of remaining issues.

**Wife/CEO:**
- [ ] Site polish day. Mobile responsive verification. Copy refinement.
- [ ] Begin scheduling Day 8 conversations with warm prospects.

**Claude:**
- [ ] Reconcile production hardening spec.
- [ ] Final SBA SOP 50 10 8 compliance audit on the eligibility/DSCR/equity injection logic.

**ChatGPT:**
- [ ] Production hardening: fix everything Matt flagged Day 4. Add error handling, edge cases, missing field handling.
- [ ] Wire approval probability scoring into final package output.
- [ ] Commit + post AAR.

### DAY 6 — SUNDAY, APRIL 21

**Matt:**
- [ ] CCO walkthrough findings → punch list complete.
- [ ] Run a Samaritus-like deal end-to-end through the new flow.

**Wife/CEO:**
- [ ] Final site review. Test forms, CTAs, all conversion paths.
- [ ] Day 8 first prospect confirmed.

**Claude:**
- [ ] Spec any last-mile fixes from Day 5/6 issues.
- [ ] Begin drafting borrower-facing onboarding email templates.

**ChatGPT:**
- [ ] Implement final fixes from CCO walkthrough.
- [ ] End-to-end test: synthetic borrower → submission → bank email confirmation.
- [ ] Commit + post AAR.

### DAY 7 — MONDAY, APRIL 22

**Matt:**
- [ ] Internal launch readiness review. All three founders together. Walk the entire flow as if Matt's wife is the first borrower.
- [ ] Pricing & terms final sign-off.
- [ ] Bank email templates approved.

**Wife/CEO:**
- [ ] Begin scheduling first 3 real borrower conversations (Day 8-10).
- [ ] Refine outreach messaging based on what's resonating.

**Claude:**
- [ ] Final compliance review: SBA Form 159, two-master rule disclosure, packaging fee structure.
- [ ] Verify all error paths, all timeouts, all edge cases addressed.

**ChatGPT:**
- [ ] Bug fix day. No new features. Polish, polish, polish.
- [ ] Performance check: deal package generation must complete in <90 seconds.

### DAY 8 — TUESDAY, APRIL 23 — FIRST REAL BORROWER

**Matt:**
- [ ] First real prospective borrower walks through the system. Wife/CEO leads the conversation. Matt observes.
- [ ] Real-time issue tracking. Anything that breaks gets fixed same day.

**Wife/CEO:**
- [ ] Conduct the first real borrower conversation.
- [ ] Walk them through the package output.
- [ ] Get their reaction and feedback.

**CCO:**
- [ ] Review the first generated package. Approve for submission or flag issues.

**Claude:**
- [ ] Live monitoring. Spec emergency fixes if needed.

**ChatGPT:**
- [ ] Standby for emergency fixes. Same-day deployment if needed.

### DAY 9 — WEDNESDAY, APRIL 24

**Matt:**
- [ ] Borrower 2 walkthrough.
- [ ] First package submitted to a lender.
- [ ] Begin tracking lender response time.

**Wife/CEO:**
- [ ] Borrower 2 conversation.
- [ ] Onboarding refinement based on Borrower 1 feedback.

**Claude/ChatGPT:**
- [ ] Standby for fixes. Track lender response patterns.

### DAY 10 — THURSDAY, APRIL 24

**Matt:**
- [ ] Borrower 3 walkthrough.
- [ ] First lender response received and processed.

**Wife/CEO:**
- [ ] Public launch announcement. Borrower 3 conversation.
- [ ] Begin scaling outreach.

### DAY 11 — FRIDAY, APRIL 25 — LAUNCH DAY

- [ ] Public launch announcement live.
- [ ] At minimum 3 borrower packages submitted to lenders.
- [ ] Active conversations with 5+ prospective borrowers in pipeline.
- [ ] Buddy Brokerage is officially LIVE.

---

## 6. MUST-BUILD MODULES (PRIORITIZED)

### Module 1: SBA Franchise Directory Module — Day 1-2 (HIGH PRIORITY)
**Why first:** This is the differentiator. Franchise buyers are the highest-volume and highest-quality borrower segment.

**What it includes:**
- xlsx ingestion script (biweekly sync from sba.gov/document/support-sba-franchise-directory)
- `franchise_directory` Supabase table with brand, SBA Franchise Identifier Code, addendum requirements, certification status, notes
- `/api/sba/franchise/verify` endpoint
- Wire into borrower concierge: when borrower mentions a franchise, instantly verify eligibility

**Tables to create:**
- `franchise_directory` (brand_name, sba_identifier_code, addendum_type, certification_status, notes, last_synced_at)

### Module 2: Borrower Flow Stitching — Day 2-3 (HIGH PRIORITY)
**Why:** All the pieces exist but need to be a coherent journey.

**What it includes:**
- Marketing site CTA → "/start" route
- Borrower account creation (lightweight: email + phone only)
- Concierge conversation kicks off
- Eligibility checks fire as facts gather
- Document collection via existing borrower portal
- Package generation completion screen
- Approval probability display

### Module 3: SBA Form 159 + Disclosure — Day 4 (HIGH PRIORITY)
**Why:** Legal requirement. Cannot submit deals without it.

**What it includes:**
- Form 159 PDF generator with $1,000 packaging fee disclosure
- Two-master rule disclosure when both borrower fee and lender referral fee apply
- Borrower e-signature via simple click-to-acknowledge
- Storage in deal documents

### Module 4: Lender Submission — Day 4 (HIGH PRIORITY)
**Why:** This is how revenue happens.

**What it includes:**
- Email template for lender package submission
- Package compilation: business plan + projections + Form 1919 + Form 413 + sources & uses + underwriting analysis + approval probability
- `lender_submissions` tracking table (deal_id, lender_id, submitted_at, status, response_at, terms_offered, funded_at)
- Manual email send (no API integration needed for MVP)

### Module 5: Approval Probability Display — Day 5 (MEDIUM PRIORITY)
**Why:** This is the trust signal. Borrowers see it, banks rely on it.

**What it includes:**
- Probability calculation from existing agent system + SOP compliance state
- Display in package summary
- Per-lender adjustment based on bank credit appetite (basic version)

### Module 6: CCO Review Workflow — Day 5-6 (MEDIUM PRIORITY)
**Why:** Quality gate before lender submission.

**What it includes:**
- Review queue UI showing packages awaiting approval
- Approve / Flag / Reject actions
- One-click submission to lender after approval

---

## 7. WHAT WE ARE EXPLICITLY NOT BUILDING THIS SPRINT

To stay focused and ship Friday April 25:

- ❌ Visual real-time projection building on screen (Day 1 was conceptual; ship a clean text-based version)
- ❌ Voice-based borrower conversation (text-only for launch; voice gateway exists but stays internal)
- ❌ Codat/Plaid accounting integration (manual document upload only)
- ❌ Pulse for Business / decision ledger (Year 2)
- ❌ Participation loan engine (Year 1 Q3+)
- ❌ White label bank platform (Year 1 Q4+)
- ❌ Buddy-Certified Borrower credential (Year 2)
- ❌ Multi-lender simultaneous submission (one lender per deal at launch)
- ❌ Conventional loan brokerage (SBA only at launch; conventional Q3)
- ❌ Marketing automation, drip campaigns, paid ads

These are future. Not this sprint.

---

## 8. PRICING & TERMS — LOCKED FOR LAUNCH

### Borrower Fee
- $1,000 flat packaging fee
- Financed into SBA loan proceeds (borrower has zero out-of-pocket)
- Disclosed on SBA Form 159
- Charged only at loan close (no refund needed for non-funded deals)

### Lender Referral Fee
- 1-2% of funded loan amount, negotiated per lender
- Disclosed on SBA Form 159 per two-master rule
- Standard market practice

### Combined Per-Deal Revenue (target average loan size $500K)
- Borrower fee: $1,000
- Lender referral (1.5% avg): $7,500
- **Total: $8,500 per funded deal**

### Volume Targets
- Day 11 (Launch): 3 packages submitted
- Week 2: 5 packages submitted
- Month 1: 15-20 packages, target 5-8 funded
- Month 3: 50 packages/month, 20-30 funded
- Month 6: 100-150 packages/month, 50-75 funded

---

## 9. RISK REGISTER

| Risk | Mitigation |
|------|------------|
| No lender bank signs by Day 3 | Matt commits 3+ hours/day to relationship development. Backup: email lender directly with completed first package as proof of value. |
| First borrower experience is rough | Wife/CEO leads conversation in person/on phone, Buddy supports rather than autonomously running. Iterate fast. |
| SBA Form 159 disclosure issues | Claude's compliance audit Day 7. Have Buddy generate Form 159 automatically rather than manual. |
| Phantom commits / scope drift | Matt verifies via GitHub API every commit. Daily AAR. Roadmap updates daily. |
| ChatGPT speeds past spec | Claude reviews every PR before merge. No exceptions. |
| Borrower drops mid-conversation | Wife/CEO follows up personally within 24 hours. This is the human touch nobody else has. |
| Bank takes too long to respond | Set SLA expectation upfront with each lender (target: 5 business day response). Track and report. |

---

## 10. SUCCESS CRITERIA — END OF DAY FRIDAY, APRIL 25

To declare launch successful:

- [ ] buddytheunderwriter.com is borrower-facing and converting visitors
- [ ] Minimum 3 lender banks signed to network
- [ ] Minimum 3 borrower packages submitted to lenders
- [ ] At least 5 active borrower conversations in pipeline
- [ ] SBA Form 159 generation working and compliant
- [ ] First lender acknowledgment received (even just "we'll review")
- [ ] Public launch announcement made
- [ ] 0 phantom commits — every claimed feature verified live in main

---

## 11. THE DAILY RHYTHM

Every day, 8am ET:
- Matt posts "What I need today" in shared channel
- Claude posts overnight spec reconciliation status
- ChatGPT posts implementation progress

Every day, 6pm ET:
- ChatGPT posts AAR for the day
- Matt verifies commits via GitHub API
- Claude updates this launch plan with any deviations
- Tomorrow's tasks confirmed

---

## 12. POST-LAUNCH (WEEKS 2-4)

After launch fires Friday:
- Week 2: Iterate on borrower experience based on real conversations. Add features that genuinely make conversion better.
- Week 3: Onboard lender bank #4 and #5. Begin tracking lender approval rates and time-to-decision.
- Week 4: First funded deal. First $8,500+ in revenue. Public case study.

Then Phase 2 starts: voice-enabled conversation, accounting integrations (Codat), expanded franchise intelligence depth, conventional loan brokerage.

---

## SIGNATURES

This plan is the operating contract between Matt, Claude, and ChatGPT for the next 10 days.

**Matt:** _________________ (vision/strategy/bank relationships)
**Claude:** _________________ (spec reconciliation/compliance/quality gate)
**ChatGPT:** _________________ (implementation)

**Launch target: Friday, April 25, 2026.**
**No retreat. Only forward.**

---

*Document maintained by Claude. Last updated: April 15, 2026.*
*All commits referenced verified live on `main` branch via GitHub API.*
