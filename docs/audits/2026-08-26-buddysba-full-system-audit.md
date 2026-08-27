# buddysba.com — Full System Audit

**Date:** 2026-08-26
**Scope:** Every subsystem of the Buddy SBA (brokerage) product, front door to funded loan.
**Method:** Static trace of the whole `src/` tree plus **live production database inspection** via
the Supabase MCP connection (schema, RLS, policies, row counts, telemetry, worker error streams).
Every claim below cites either a file:line or a production query result. No writes were made to
production; no code was changed by this audit.

---

## 1. What buddysba.com is

Two products ship from one Next.js app and one Vercel deployment, split by hostname:

| Host | Product | Root behavior |
|---|---|---|
| `buddysba.com` | **Buddy SBA** — borrower-facing SBA brokerage | `/` renders `BrokerageLandingPage` |
| `buddytheunderwriter.com` | **Buddy the Underwriter** — lender-side underwriting | `/` rewrites to `/underwriter` |
| `buddybrokerage.com` | legacy | 301 → `buddysba.com` |

`resolveProductFromHost()` (`src/lib/brokerage/domainRouting.ts:12-19`) and `src/proxy.ts:96-116`
implement the split. Metadata for the brokerage product is
*"Buddy SBA | SBA Loan Packaging & Lender Matching"* (`domainRouting.ts:45`).

### The borrower funnel

```
buddysba.com/  →  /apply  →  /start ("Buddy SBA concierge")
      │              (apply/page.tsx:16 redirects)
      ▼
POST /api/brokerage/concierge   ← anonymous, cookie-identified, rate-limited
      │  getOrCreateBorrowerSession() → claim_brokerage_session RPC
      ▼
deals row (deal_type='SBA', origin='brokerage_anonymous')
      │
      ├─ Gemini fact extraction → borrower_concierge_sessions.extracted_facts
      ├─ propagateBorrowerFacts → deal_financial_facts / borrower_applications / ownership_entities
      ├─ computeBuddySBAScore (turn 5, on email claim)
      ├─ email claim → verification code → borrower_session_tokens
      ├─ document upload → deal_documents → OCR/classify/extract
      ├─ SBA assumptions interview → buddy_sba_assumptions
      ├─ Golden Trident bundle (business plan + projections + feasibility)
      ├─ identity (IAL2) + disclosures + Form 159 + fee ledger
      ├─ canSeal() gate → marketplace listing (blind)
      ├─ lender claims → borrower picks → package release
      └─ closing conditions → funded
```

### Scale of the codebase

| Metric | Count |
|---|---|
| TypeScript/TSX files | 5,510 |
| Lines of code (`src/`) | 865,019 |
| API route handlers | 810 |
| Migrations in repo | 512 |
| Production tables (`public`) | 633 |
| RLS policies | 880 |
| DB functions | 299 |
| Test files | 1,193 |
| Architectural CI guards | ~50 |
| Vercel cron jobs | 27 |

---

## 2. Verdict

**The architecture is strong; the operations are not, and the perimeter has holes.**

This is a genuinely sophisticated system — deterministic scoring, an SR 11-7 AI audit ledger,
outbox queues with advisory locking and dead-lettering, real SBA compliance gating (Form 159,
two-masters consent), 100% RLS coverage, and one of the more serious CI guard suites I've seen.
The engineering intent is institutional-grade.

What undermines it is threefold: **(a)** the API perimeter is enforced route-by-route with no
blanket middleware and a guard that covers only one subtree, and several routes have no gate at
all; **(b)** the production system is quietly burning — every worker tick logs errors, 56% of the
database is error telemetry, and a scoring endpoint has written 12,605 rows for 38 deals; and
**(c)** the entire back half of the funnel (disclosures → sealing → marketplace → close) has never
executed once in production.

| Subsystem | State | Notes |
|---|---|---|
| Domain routing / marketing | ✅ Sound | Clean host split, metadata correct |
| Anonymous session & identity | ✅ Sound | HTTP-only cookie, SHA-256 hash as DB key, advisory-locked creation |
| Rate limiting (concierge) | ✅ Sound | Multi-tier IP + session, fails open by design |
| Conversational intake | 🟡 Works, ungoverned | Bypasses the AI gateway (§5.7) |
| Buddy SBA Score | 🔴 Runaway | 12,605 rows / 38 deals; 1 locked ever (§5.4) |
| Document intake → engine | 🔴 Disconnected | SBA policy never activates (§5.3) |
| OCR / classify / extract | 🔴 Erroring every tick | (§5.5) |
| Outbox / workers | 🟡 Mixed | Good design; one unclaimed kind, high dead-letter rates (§5.6) |
| SBA forms & 10-tab package | 🟡 Isolated | No `deal_documents` link at all (§5.3) |
| Golden Trident | ✅ Well-gated | Release gate + CAS stage machine |
| Compliance / fees | ✅ Sound, unexercised | 0 rows in production |
| Marketplace / lender match | ⚪ Not live | 1 lender program exists |
| Comms (email/SMS) | 🟡 Split-brain | Two SMS providers, one ungated (§5.2) |
| Database / RLS | ✅ Strong | 633/633 RLS on, no open policies |
| API authorization | 🔴 Gaps | (§5.1, §5.2) |
| CI / testing | ✅ Strong | 1,193 tests, ~50 guards, E2E, drift detection |
| Cost / data hygiene | 🔴 Poor | 63% of DB is two pathologies (§5.5, §5.4) |

---

## 3. Production reality check

The live database says this system is **pre-launch**, and that context matters for severity.

| Table | Rows | Reading |
|---|---|---|
| `banks` | 5 | |
| `deals` | 38 | 11 with `origin='brokerage_anonymous'` |
| `brokerage_leads` | 7 | |
| `borrower_concierge_sessions` | 18 | |
| `borrower_session_tokens` | 45 | |
| `deal_documents` | 364 | only **6** from borrower/public sources |
| `deal_financial_facts` | 2,218 | extraction is working |
| `ai_gateway_calls` | 1,214 | gateway ledger is live |
| **`buddy_sba_scores`** | **12,605** | **331 rows per deal** — see §5.4 |
| **`deal_intake_scenario`** | **0** | **the SBA slot policy has never run** — see §5.3 |
| `borrower_invites` | 0 | invite portal unused |
| `borrower_portal_links` | 0 | magic links unused |
| `brokerage_disclosures` | 0 | never presented |
| `sba_form_159_records` | 0 | never generated |
| `signed_documents` | 0 | e-sign never used |
| `brokerage_fee_ledger` | 0 | no fee ever recorded |
| `lender_programs` | 1 | marketplace has one program |
| `sba_package_runs` | 1 | package built once |
| **`buddy_system_events`** | **540,185** | **56% of the database** — see §5.5 |

**Everything from "present disclosures" onward has executed zero times in production.**
`canSeal()` requires a locked score (1 exists platform-wide), acknowledged disclosures (0),
a fee ledger row (0), and a Form 159 (0). No deal can currently be sealed, so no deal can reach
the marketplace, lender selection, or closing. Those subsystems are written but unproven.

---

## 4. What is genuinely strong

Stating this plainly, because the problem list below is long and the quality here is real.

- **Database security.** 633 of 633 public tables have RLS enabled; zero `rls_disabled_in_public`
  advisories. No policy grants unrestricted access — every `{public}`-role policy gates on
  `get_current_bank_id()`, `can_access_deal()`, or `is_deal_banker()`, and all three fail closed
  for anonymous callers (`auth.uid()` null → false; missing `bank_id` claim → NULL → not true).
  Anon-facing policies on the franchise tables are explicit `USING (false)` denies.
- **Outbox design.** `claim_intake_outbox_batch` uses `pg_try_advisory_xact_lock`, TTL-based claim
  reclamation, attempt counting, exponential backoff, and dead-lettering. The Pulse forwarder was
  converted from a denylist to an **allowlist** after a real 2026-05-14 incident where it silently
  ate `doc.extract` events — the postmortem is in the code
  (`src/lib/workers/processPulseOutbox.ts:15-36`). That is good engineering discipline.
- **AI governance.** `src/lib/ai/gateway.ts` enforces per-provider NPI vendor approval before the
  network call, a hard per-role daily token budget, and ledgers every attempt — including refused
  ones — for an SR 11-7 audit trail.
- **PII discipline.** `emitPipelineEvent` filters payloads through an explicit key allowlist and
  drops any string over 200 chars. `redactSsnPatterns`, `piiScanner`, `redactForMarketplace`,
  and `redactCommsSecrets` all exist and are used.
- **SBA compliance modelling.** `assertCanSealBrokeragePackage` checks engagement-letter ack, fee
  disclosure ack, Form 159, and — correctly — **two-masters consent** when both a borrower
  packaging fee and a lender referral fee exist. That is the actual SBA broker conflict rule,
  implemented properly.
- **Comms safety.** `BROKERAGE_COMMS_MODE` defaults to `stub`, and an unrecognized value throws
  rather than silently picking a mode (`commsMode.ts:19-25`). Correct fail-loud design.
- **CI.** Typecheck, lint, ~50 architectural guards, safety invariants, 1,193 unit test files,
  golden-set evals, schema-select gate, schema drift detection, a "never-500" API invariant, a
  cockpit-polling guardrail, gitleaks secret scanning, and Playwright E2E smoke (public + authed).

---

## 5. Findings

### P0 — Security

#### 5.1 Two unauthenticated endpoints mint borrower portal links, and one sends SMS

`POST /api/portal/create-link` (`src/app/api/portal/create-link/route.ts`) has **no authentication
of any kind**. It accepts a `deal_id`, inserts a row into `borrower_portal_links` with a fresh
token via `supabaseAdmin()` (service role, bypasses RLS), and returns a working
`/upload/<token>` URL for that deal.

`POST /api/portal/send-link` (`src/app/api/portal/send-link/route.ts`) is worse. Also
unauthenticated, it:
1. mints the same portal link for a caller-supplied `deal_id`,
2. accepts a **fully caller-controlled `message` body** (`route.ts:99-102`),
3. sends it to a **caller-supplied `to_phone`** through the platform's Twilio account
   (`route.ts:104-113`).

Both are documented in-file as "Banker creates…" / "Banker sends…" — the intent was an
authenticated banker action; the check was never written.

**Impact.** An arbitrary-content SMS relay operating from Buddy's own Twilio number: phishing with
a legitimate-looking `buddysba.com` link, toll fraud, and TCPA exposure. Separately, anyone with a
deal UUID gets document-portal access to that deal. Borrowers learn their own `dealId` from the
borrower app's own URLs (`/portal/deals/[dealId]/guided` and siblings), so the bar is low.
There is **no rate limit** on either route — `checkConciergeRateLimit` covers only the concierge.

**Mitigating today:** `borrower_portal_links` has 0 rows, so neither has been used in production.

#### 5.2 Four routes accept any valid invite token for any deal (IDOR)

`requireValidInvite(token)` (`src/lib/portal/auth.ts:15`) validates that a token exists, is
unrevoked, and is unexpired — then returns the invite, which carries its own `deal_id`. Ten routes
correctly compare `invite.deal_id !== dealId` and reject the mismatch. **Four do not**, and then
use the **URL** `dealId` with `supabaseAdmin()`:

| Route | Effect of the mismatch |
|---|---|
| `portal/deals/[dealId]/ownership/findings` | Read another deal's ownership analysis |
| `portal/deals/[dealId]/ownership/refresh` | Force ownership re-extraction on another deal |
| `portal/deals/[dealId]/ownership/confirm` | **Write** owners on another deal — provisions owner portals and queues outreach email to those people |
| `portal/deals/[dealId]/share-links` | **Mint a 7-day share token** for another deal's checklist items |

`share-links` is the sharpest: `requireValidInvite(req.headers.get("x-invite"))` is called and its
result is **discarded entirely** (`share-links/route.ts:15-17`), then `createShareLink({ dealId })`
runs on the URL parameter. Banks are separate tenants here, so this crosses a tenant boundary.

**Mitigating today:** `borrower_invites` has 0 rows — there are no live invite tokens. This is a
latent P0 that arms itself the moment the invite flow is used.

#### 5.3 The API perimeter has no blanket enforcement, and the guard covers one subtree

`src/proxy.ts:7-11` states the rule explicitly: *"Never protect /api/** in middleware."* Every one
of the 810 route handlers must therefore authorize itself.

A guard exists for exactly this — `scripts/guards/guard-deal-route-access.mjs` — but its scan root
is hardcoded to `src/app/api/deals/[dealId]` (`guard-deal-route-access.mjs:25-27`), and it still
carries a **56-entry allowlist** of known-unenforced routes. It does not look at
`/api/portal/**`, `/api/brokerage/**`, `/api/borrower/**`, `/api/banks/**`, or `/api/storage/**` —
which is precisely where the buddysba.com borrower surface lives and where §5.1 and §5.2 sit.

Scanning all 810 routes for any known auth helper leaves **211 with no match**. That number is a
heuristic upper bound — spot-checking dissolved many (e.g. `banks/select` uses `clerkAuth()`,
`portal/messages/send` correctly uses `invite.deal_id`). Narrowing to *routes that call
`supabaseAdmin()` and match no auth helper* gives **52**, and manual review of the borrower-facing
subset produced the confirmed findings above. The remainder deserves the same review.

**Because RLS is bypassed by the service role on every one of these routes, the DB provides no
backstop.** The application layer is the entire security boundary.

#### 5.4 Cron/worker secrets are compared non-constant-time and accepted in query strings

`hasValidWorkerSecret` (`src/lib/auth/hasValidWorkerSecret.ts`) — the gate on all 27 cron
endpoints — compares with `===` (four call sites), and accepts the secret as a **`?token=` query
parameter**, which lands in access logs, proxy logs, and referrer headers.

The repo already contains the fix: `src/lib/brokerage/secretEquals.ts` is a `timingSafeEqual`
wrapper written for "audit L6" and documented as being for exactly this
(`CRON_SECRET`, gateway secret). It simply isn't used here.

---

### P0 — Correctness & cost

#### 5.5 The Buddy SBA Score endpoint has written 12,605 rows for 38 deals

```
deal 16e135e8…  9,038 rows   2026-08-12 → 2026-08-22   (≈1 every 96 seconds for 10 days)
deal 1d74eed8…  3,263 rows   2026-08-19 → 2026-08-21   (≈1 every 53 seconds)
```

99% (12,476) carry `computation_context='package_seal'`. **`"package_seal"` appears nowhere in the
repo as a value passed to `computeBuddySBAScore`** — only in the type union (`src/lib/score/types.ts:23`).
The three production callers pass `concierge_fact_change`, `assumption_confirm`, and `manual`. So
the writes came from an external authenticated caller POSTing
`/api/deals/[dealId]/buddy-sba-score/compute` with that context in the body
(`compute/route.ts:56`, which takes `body.context` verbatim).

Whoever called it, the endpoint permitted it: **no idempotency, no dedupe, no rate limit, no cap on
score history.** Each call runs the full scoring pipeline — `loadScoreInputs` reads across many
tables — and inserts a row via `supersede_and_insert_buddy_sba_score`.

The table is now **46 MB (7% of the database)**. And across all 12,605 rows there is exactly
**one** with `score_status='locked'` — meaning the lock step that `canSeal()` depends on is
effectively never reached.

#### 5.6 Every worker tick logs an error because "idle" is modelled as failure

Four processors return `{ ok: false, error: "No jobs available" }` when the queue is **empty**:

- `src/lib/jobs/processors/ocrProcessor.ts:254`
- `src/lib/jobs/processors/classifyProcessor.ts:493`
- `src/lib/jobs/processors/extractProcessor.ts:205`
- `src/lib/jobs/processors/spreadsProcessor.ts:1488`

`withBuddyGuard` treats any `ok:false` as an error and writes a `buddy_system_events` row
(`src/lib/aegis/withBuddyGuard.ts:69-90`). The `/api/jobs/worker/tick` cron runs every 2 minutes.

Production, last 3 days:

```
classify_processor  UNKNOWN  "No jobs available"   2,161   latest 2026-08-26 02:46
ocr_processor       UNKNOWN  "No jobs available"   2,161   latest 2026-08-26 02:46
extract_processor   UNKNOWN  "No jobs available"   2,161   latest 2026-08-26 02:46
```

~2,160 false error rows per day, ~31,914 per processor lifetime. This is not just noise — it
**destroys error-rate alerting** for the document pipeline, because the steady state is "everything
is failing."

The correct pattern already exists in this codebase: `PulseOutboxResult` has an `idle?: boolean`
field (`src/lib/workers/processPulseOutbox.ts:50-57`).

#### 5.7 `buddy_system_events` is 360 MB — 56% of the entire database

| Table | Size | Share of 643 MB DB |
|---|---|---|
| `buddy_system_events` | **360 MB** | 56% |
| `buddy_sba_scores` | 46 MB | 7% |
| `deal_pipeline_ledger` | 27 MB | 4% |
| everything else | ~210 MB | 33% |

540,185 event rows for 38 deals. Composition:

```
observer  error     critical    230,295   (2026-02-10 → 2026-05-16)
observer  error     error       114,730   (2026-07-12 → 2026-08-26, ongoing)
observer  stuck_job warning      59,538
observer  heartbeat info         39,181
ocr/classify/extract error       95,743   (§5.6, all false)
```

The dominant live error is `observer / DATA_ERROR / "Attachment not found"` — **7,776 occurrences
in the last 3 days alone**, still firing. The observer loop re-reports the same orphaned
attachment references indefinitely; nothing dead-letters them.

There is no retention policy on this table. `buddy_workers` is similarly unbounded at 58,216 rows.
**Two pathologies (§5.5 and this) account for 63% of the production database.**

---

### P1 — Functional

#### 5.8 Buddy SBA deals never activate the SBA intake policy — confirmed in production

Covered in full in `docs/audits/2026-08-25-buddy-sba-document-intake-connectivity.md`. Live data
now confirms the static analysis:

**`deal_intake_scenario` has 0 rows.** That table is the *only* input to
`loadIntakeScenario()` (`ensureDeterministicSlots.ts:21-41`), which is the only thing that can
select `SBA_7A_POLICY` (`policies/index.ts:39`). With no row, every deal falls back to
`CONVENTIONAL_FALLBACK`.

So the `SBA_1919`, `SBA_413`, and `SBA_DEBT_SCHEDULE` slots — and the STARTUP/ACQUISITION
branches — have **never been generated for any deal in the history of this system.** The 66 rows in
`deal_document_slots` are all conventional.

The root cause is vocabulary fragmentation across five fields:

| Field | Value on a live buddysba.com deal | Written by |
|---|---|---|
| `deals.deal_type` | `'SBA'` | `claim_brokerage_session` RPC |
| `deals.product_type` | `NULL` | *no production writer* |
| `deals.loan_type` | `'7a'` | `borrower/intake/progress:389` |
| `deal_intake.loan_type` | `'CRE'` (default) | `initializeIntake:15,76` |
| `deal_intake_scenario.product_type` | *absent* | banker routes only |

Consequences: `isSBA(deal)` returns **false** for every production deal (it requires an explicit
`product_type` — `dealProductType.ts:71-75`); the borrower is shown a **CRE** document checklist;
and `normalizeLoanTypeForChecklist('7a')` returns `'CRE'` because `'7A'` isn't in its alias list
(`seedPortalChecklist.ts:73-79`).

#### 5.9 `document_uploaded` outbox events have no consumer

`ingestDocument` emits `kind: "document_uploaded"` on every upload
(`src/lib/documents/ingestDocument.ts:163-168`). The Pulse forwarder's allowlist contains only
`checklist_reconciled`, `readiness_recomputed`, `artifact_processed`, `manual_override`
(`processPulseOutbox.ts:37-42`), and no dedicated worker claims this kind.

```
kind='document_uploaded'   16 events   0 delivered   0 dead   attempts=0
                           pending since 2026-08-14, newest 2026-08-24
```

This is exactly the failure mode the allowlist's own doc comment anticipates: *"A future Aegis
watchdog will surface unclaimed outbox kinds."* That watchdog does not exist yet, so the queue
grows silently.

Historic dead-letter rates on the kinds that *do* have consumers are also poor:
`artifact_processed` **204 of 257 dead (79%)**, `manual_override` **97 of 116 dead (84%)**,
`readiness_recomputed` 31 dead. All stopped being produced around 2026-07-10.

#### 5.10 The franchise data pipeline has 5,748 orphaned runs and stale authoritative data

`franchise_sync_runs`: 25,151 rows since 2026-04-21, still running today (~200/day).

```
fdd_extraction  complete  8,379 runs    52 errors     latest 2026-08-26
state_mn        complete  5,496 runs  1,428 errors    latest 2026-08-26
nasaa_efd       complete  5,400 runs  4,816 errors    latest 2026-08-26   ← 89% error rate
nasaa_efd       running   2,987 runs      —           latest 2026-06-13   ← orphaned
state_mn        running   2,761 runs      —           latest 2026-06-13   ← orphaned
state_wi        complete    121 runs                  latest 2026-04-28   ← stopped 4 months ago
sba_directory   complete      3 runs                  latest 2026-04-21   ← stopped 4 months ago
```

Three distinct problems: **5,748 runs stuck in `running`** with no janitor to finalize them;
`nasaa_efd` carrying a **4,816-error** count while still reporting `status='complete'`; and
`state_wi` + `sba_directory` having silently stopped in April with no alert.

`sba_directory` is the SBA's own franchise directory — the authoritative source for franchise
eligibility. It is **4 months stale**, and `franchise_sba_directory_snapshots` (32,433 rows) all
carry a single date of 2026-04-21. `scoreFranchiseQuality` is a scoring component that reads this
data.

#### 5.11 The borrower-facing LLM path bypasses the AI gateway

`/api/brokerage/concierge` — the primary borrower conversation, which handles names, financials,
and ownership — calls Gemini directly rather than through `runRole()`. The flag
`AI_GATEWAY_CONCIERGE_ENABLED` defaults to `false` (`concierge/route.ts:69`).

The in-code justification is stale. It says the flag is *"Left OFF until Matt approves a provider…
turning this on while every provider is still PENDING would make the gateway's NPI gate refuse
every single borrower turn."* But `VENDOR_NPI_APPROVAL` now marks **google, anthropic, and openai
all `APPROVED`** as of 2026-08-17 (`vendorApproval.ts:19-23`). The blocking condition no longer
exists; the flag was never flipped.

**26 other non-test modules** also call Gemini/OpenAI directly, outside the gateway — including
`sbaPackageNarrative`, `sbaAssumptionDrafter`, `buildKFS`, `committee`, and the memo/risk routes.
Each one is invisible to the NPI vendor gate, the per-role token budget, and the SR 11-7 ledger.
`ai_gateway_calls` shows 1,214 logged calls; the true LLM call volume is higher by an unknown
factor. A `guard:ai-gateway-only` script exists with an allowlist — the allowlist is doing heavy
lifting.

#### 5.12 SMS has two providers, and the Twilio path ignores the comms safety switch

Brokerage comms send through **Telnyx** with the full safety apparatus: `BROKERAGE_COMMS_MODE`
(stub by default), ledger, PII scan, retry queue, release gate.

`src/lib/sms/send.ts` sends through **Twilio** and consults **none of it**. It checks consent
(`assertSmsAllowed`) but has no mode gate — it sends live whenever `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` are set. With `BROKERAGE_COMMS_MODE=stub`, brokerage
email/SMS stubs out while `/api/portal/send-link` still sends real messages.

This is what makes §5.1 dangerous rather than theoretical: the unauthenticated relay is on the
provider that has no kill switch.

---

### P2 — Structural

#### 5.13 Three parallel document-processing queues

| Queue | Producer | Consumer |
|---|---|---|
| `document_artifacts` | `queueArtifact()` | cron `/api/artifacts/process` (5 min) |
| `document_jobs` | `tryEnqueueJobs()` | cron `/api/jobs/worker/tick` — marked **legacy** at `worker/tick/route.ts:131` |
| `buddy_outbox_events` `doc.extract` | `processConfirmedIntake` | cron `/api/workers/doc-extraction` (2 min) |

Which one a document lands in depends on which URL the borrower's upload hit. In production,
**216 of 364 documents have no `document_artifacts` row** — but only **2** are unclassified,
because the other queues picked them up. The system self-heals by accident; classification
provenance is inconsistent, and the three paths have different retry, janitor, and observability
semantics.

#### 5.14 Three parallel document checklists

`deal_checklist_items` (canonical), `deal_document_slots` (intake engine), and
`deal_portal_checklist_items` (what the borrower sees). The borrower-facing one is marked
"received" by **filename substring matching** against `match_hints`
(`src/lib/portal/checklist.ts:67-76`), independent of the classifier's `canonical_type`. The
portal route calls this out as *"intentionally separate from canonical checklist reconciliation."*
A file named `SBA-413.pdf` reads as received even if classification rejected it; a correctly
classified `scan_0043.pdf` reads as missing.

#### 5.15 Security headers are not in version control

`next.config.mjs:56-60` sets only `Permissions-Policy: microphone=(self)`, with a comment that
headers were *"mostly removed in Phase 6b in favor of Vercel Project Routes."* CSP, HSTS,
X-Frame-Options, and Referrer-Policy therefore live in the Vercel dashboard. I cannot verify them
from the repository, and neither can a reviewer, a future engineer, or CI. This is an
auditability gap, not a confirmed missing-header finding.

#### 5.16 Schema drift

633 production tables against 512 migrations. Core tables including `borrower_applications` have
**no `CREATE TABLE` anywhere in `supabase/migrations/`**. The team is aware — there is a
`gate:schema-drift` CI step, a `.drift-allowlist.json` (currently empty), and
`docs/audit/schema-inventory-2026-07.md`, which documents a prior incident where a broken FK-detection
query nearly authorized dropping 50 tables that had live foreign keys. The RESTRICT-not-CASCADE
design caught it. Good instincts, incomplete coverage.

#### 5.17 Minor database advisories

From the live security advisor: `vector` and `pg_trgm` extensions installed in the `public` schema
(should be moved); `can_access_deal(uuid)` and `is_deal_banker(uuid)` are `SECURITY DEFINER` and
executable by the `authenticated` role via `/rest/v1/rpc/…` — intentional for RLS, but worth an
explicit `REVOKE EXECUTE` if direct RPC invocation isn't wanted. 131 tables have RLS enabled with
no policy (deny-all — safe, given service-role access, but worth confirming each is deliberate).

---

## 6. Remediation plan

### Immediately (hours)

1. **Add auth to `/api/portal/create-link` and `/api/portal/send-link`**, or delete them if the
   banker flow no longer uses them (`borrower_portal_links` has 0 rows, so deletion is cheap).
   Rate-limit whatever survives. — §5.1
2. **Bind the four IDOR routes to `invite.deal_id`.** Three are a one-line comparison; `share-links`
   should use `invite.deal_id` and ignore the URL parameter entirely. — §5.2
3. **Return `{ ok: true, idle: true }` from the four processors' empty-queue branch** and teach
   `withBuddyGuard` not to log it. Four one-line changes; removes ~2,160 false error rows/day and
   restores error-rate alerting. — §5.6
4. **Swap `hasValidWorkerSecret` to `secretEquals`** (already in the repo) and drop `?token=`
   query-param auth. — §5.4

### This week

5. **Extend `guard-deal-route-access.mjs` to the whole `/api` tree.** Set `ROUTES_ROOT` to
   `src/app/api`, generate a fresh remove-only allowlist, and burn it down starting with the 52
   service-role-plus-no-auth routes. This is the single highest-leverage change in this document —
   it converts an unbounded manual-review problem into a CI-enforced, shrinking list. — §5.3
6. **Add idempotency to `/buddy-sba-score/compute`** (dedupe on unchanged inputs, or a per-deal
   cooldown) and prune the 12,605 existing rows to the latest N per deal. — §5.5
7. **Add retention to `buddy_system_events` and `buddy_workers`.** A 30-day window on
   info/warning and 90 days on error reclaims ~300 MB immediately. — §5.7
8. **Fix the observer's "Attachment not found" loop** — dead-letter after N attempts instead of
   re-reporting forever. — §5.7
9. **Gate `lib/sms/send.ts` on `BROKERAGE_COMMS_MODE`** so one switch stops all outbound. — §5.12

### This month

10. **Collapse the loan-type vocabulary to `deals.product_type`.** Populate it at deal creation
    (in `getOrCreateBorrowerSession`, right after the RPC returns), backfill the 38 existing rows,
    derive `deal_intake.loan_type` and `deal_intake_scenario.product_type` from it, and add `'7A'`
    to `normalizeLoanTypeForChecklist`. This single change fixes §5.8 end to end and makes
    `isSBA()` work. — §5.8
11. **Claim or stop emitting `document_uploaded`,** and build the unclaimed-kind watchdog the
    allowlist comment already promises. — §5.9
12. **Fix the franchise pipeline:** finalize the 5,748 orphaned `running` rows, alert on
    `error_count > 0` instead of reporting `complete`, and re-enable `sba_directory` and
    `state_wi`. — §5.10
13. **Flip `AI_GATEWAY_CONCIERGE_ENABLED=true`** (its stated blocker is resolved) and start
    reducing the `guard:ai-gateway-only` allowlist. — §5.11
14. **Move `queueArtifact` into `ingestDocument`** so no upload path can skip processing, and
    retire the legacy `document_jobs` queue. — §5.13
15. **Move security headers into `next.config.mjs`** so they are reviewable and diffable. — §5.15

### Before launch

16. **Exercise the back half of the funnel once, end to end** — disclosures → Form 159 → fee
    ledger → IAL2 → lock score → seal → list → lender claim → borrower pick → close. Every one of
    those subsystems currently has 0 production rows. `goldenRun.ts` and `goldenTridentQaFixture.ts`
    exist for this; they should run against a staging tenant on a schedule, not ad hoc. — §3
17. **Provision lender programs.** `matchLendersToDeal` is correct but has one row to match
    against; the marketplace cannot function. — §3

---

## 7. Coverage and limits of this audit

**Reviewed in depth:** domain routing and the public surface; anonymous session and token
handling; the concierge intake path; rate limiting; the Buddy SBA Score pipeline; document intake,
classification, and extraction; all three processing queues; the outbox and worker layer; SBA forms
and the ten-tab package; the Golden Trident factory and release gate; sealing, compliance, and fee
gating; lender matching; comms (email and both SMS providers); identity/IAL2 gating; the AI
gateway and its bypasses; database schema, RLS, policies, and gate functions; production telemetry
and error streams; the franchise data pipeline; CI, guards, and the test suite; deployment and
cron configuration; secret handling.

**Reviewed at survey depth only:** the voice/realtime surface
(`/api/brokerage/voice/**`, `buddy-voice-gateway/`); Stripe/billing; the examiner portal; the
`stitch/` design system; the MCP server under `mcp-server/`; the special-assets and
workout-committee subsystems; the CRM automation crons. These are either peripheral to the
buddysba.com borrower funnel or lender-side. Each warrants its own pass.

**Not attempted:** dynamic testing of any kind. No exploit was executed against any endpoint —
§5.1 and §5.2 are established by code reading, and their production impact is bounded by the
0-row state of `borrower_portal_links` and `borrower_invites`. No load, penetration, or
dependency-vulnerability testing was run. No production data was modified.

---

## 8. Remediation log — 2026-08-26

Everything in §5 was worked. This section records what shipped, what was
deliberately *not* changed and why, and what still needs a human.

### Fixed in code

| Finding | Fix |
|---|---|
| §5.1 unauthenticated `create-link` / `send-link` | `ensureDealBankAccess` on both; `bank_id` derived from the deal rather than the request body; the SMS note is prepended and capped rather than substituted, so the message always carries the link the route just minted |
| §5.2 invite/deal IDOR (4 routes) | New `requireInviteForDeal()` binds the invite to the URL `dealId`; applied to ownership findings/refresh/confirm and share-links |
| §5.3 no perimeter enforcement | New `guard-api-route-auth.mjs` covers the whole `/api` tree, wired into `guard:all`, 9 fixture tests. It found 11 unprotected service-role routes — **all 11 fixed, so the guard ships with an empty allowlist** |
| §5.4 worker secret | Constant-time via the existing `secretEquals`; `?token=` query-param auth removed |
| §5.5 score runaway | `findUnchangedActiveScore` — recomputing with unchanged inputs reuses the active row instead of superseding it; locked rows are never reused |
| §5.6 idle logged as error | Processors report `idle: true`; `withBuddyGuard` treats it as a no-op. `ok` stays `false` so the worker tick's loop control flow is unchanged |
| §5.7 observer "Attachment not found" loop | Dedupe on `source_job_id` — a job already recorded dead is not re-reported every tick |
| §5.7 `buddy_system_events` at 360 MB | **The purge already existed and worked**; `/api/cron/nightly` was simply never in `vercel.json`. Scheduled. The route was also POST-only (Vercel cron sends GET) and skipped its secret check when `CRON_SECRET` was unset — both fixed |
| §5.8 SBA policy never activates | `normalizeProductType` / `resolveProductType`; `loadIntakeScenario` derives from the deal; `product_type` stamped at session creation; `'7a'` no longer maps to CRE. 13 regression tests |
| §5.9 unclaimed `document_uploaded` | Added to the Pulse allowlist, plus the unclaimed-kind watchdog that file's own comment promised, wired into the observer tick |
| §5.10 franchise pipeline | `runFranchiseSyncJanitor` in the nightly job: finalizes orphaned runs, warns on sources that report `complete` while carrying errors, warns on sources that have gone quiet. 4 tests |
| §5.11 stale gateway justification | Comment corrected — the blocker (all providers PENDING) was resolved 2026-08-17 |
| §5.12 SMS ignored the kill switch | `sendSmsWithConsent` honours `BROKERAGE_COMMS_MODE`; suppressed sends are ledgered under a distinct key so they don't pollute failure alerting |
| §5.13 uploads that skip processing | `queueArtifact` moved inside `ingestDocument` — idempotent and non-fatal, so no caller can forget it |
| §5.15 headers not in version control | HSTS, nosniff, Referrer-Policy, X-Frame-Options, X-DNS-Prefetch-Control and a **Report-Only** CSP moved into `next.config.mjs` |

Verification: `pnpm typecheck` clean, `pnpm guard:all` green (both access
guards pass), `pnpm test:invariants` 86/86, `pnpm test:unit` 12,944 passing.

### Deliberately not changed

**§5.17 `REVOKE EXECUTE` on `can_access_deal` / `is_deal_banker`.** Not done,
and it should not be done as written. Both functions are used *inside* RLS
policy expressions — 5 policies reference `can_access_deal`, 8 reference
`is_deal_banker` — and Postgres evaluates a policy expression with the
querying role's privileges. Revoking `EXECUTE` from `authenticated` would
break all 13 policies and lock signed-in users out of the tables the advisor
is trying to protect. The actual exposure is small: each function returns a
boolean about *the caller's own* access, which the caller can already
determine by querying the table. Accepted as-is.

**§5.17 extensions in the `public` schema.** `vector` and `pg_trgm` should
live in their own schema, but 13 columns are typed `vector` and carry indexes
built on the extension's operator classes. `ALTER EXTENSION … SET SCHEMA` on a
live database with dependent objects needs a maintenance window and a tested
rollback, not a drive-by migration. Deferred with the reasoning recorded.

**CSP is Report-Only, not enforcing.** This app loads Clerk, Sentry, PostHog,
Vercel analytics and Google Fonts. An enforcing policy written without
traffic data would break the borrower funnel on deploy. Promote it once the
violation reports are clean.

**`AI_GATEWAY_CONCIERGE_ENABLED` left off.** Its stated blocker is gone, but
flipping it changes the model path for every live borrower conversation and
wants a staged rollout, not a deploy-time surprise. The comment now says that
instead of citing a resolved blocker.

### Still needs a human

1. **Run `scripts/maintenance/2026-08-26-audit-cleanup.sql`** — the one-time
   prune of the 12,605 score rows and the 5,748 orphaned franchise runs. Every
   `DELETE` is preceded by its preview `SELECT`. It is not run automatically
   because it is irreversible; the code fixes stop the growth either way.
2. **Remove the duplicate Vercel Project Routes header rule** (`vercel routes
   list` → `vercel routes rm`) after deploying, or two header sets will race —
   the same failure that silently blocked the microphone on `/start`.
3. **The back half of the funnel still has zero production rows** (§3).
   Disclosures, Form 159, fee ledger, e-sign, sealing, marketplace. Nothing in
   this branch changes that; it needs one deliberate end-to-end run.
4. **Provision lender programs** — `matchLendersToDeal` is correct but has one
   row to match against.

---

## 9. Production remediation executed — 2026-08-27

The §8 "still needs a human" items were carried out against production with the
owner's explicit authority. Measurements are before → after, taken live.

### Database reclaimed: 648 MB → 204 MB (−69%)

| Table | Rows before | Rows after | Size before | Size after |
|---|---|---|---|---|
| `buddy_system_events` | 544,072 | **13,944** | 360 MB | **11 MB** |
| `buddy_sba_scores` | 12,605 | **129** | 46 MB | **528 kB** |
| `buddy_workers` | 58,216 | **9** | 15 MB | **48 kB** |
| `franchise_sync_runs` | 25,481 | **6,474** | 7.5 MB | **1.1 MB** |

Score pruning kept every row that matters: the **1 locked** row (a decision
record — never deletable), all **15 active** rows, and the 20 most recent
superseded rows per deal for history. Verified by dry run before executing.

`VACUUM` alone was not enough — it marks pages reusable but does not return
them to the OS, so the files stayed bloated after the deletes. `VACUUM FULL`
was required for the sizes above.

### The two fixed bugs are confirmed dead in production

Of the 228,026 events remaining after aged-row retention, **214,082 (94%)**
were artifacts of the two bugs this branch fixed:

| Signature | Rows | Last occurrence |
|---|---|---|
| `observer` / "Attachment not found" | 116,728 | 2026-08-26 21:20:20 |
| "No jobs available" × 3 processors | 97,354 | 2026-08-26 21:18:37 |

Both stop dead within minutes of the fix deploying, and **zero** occurrences
exist after it. Those rows were purged; the delete was scoped to those exact
signatures with a `created_at < 2026-08-26 22:00Z` bound, so any future
recurrence still surfaces as a real signal rather than being pre-deleted.

Error rows in `buddy_system_events` went from ~214,000 to **224**. The error
stream is now honest, which is what makes error-rate alerting possible at all.

### The franchise janitor worked on its first run

`franchise_sync_runs` had **0** rows left in `running`. All 5,748 orphans carry
the `ORPHANED_RUN` marker, stamped at **07:30:48 UTC** — the `30 7 * * *` cron
this branch scheduled, on its first firing. No manual intervention was needed.

### A new defect the first cron run exposed

That same run also proved §5.7's fix incomplete. From the Vercel runtime log at
07:30:38 UTC:

```
Telemetry retention purge failed: Error: telemetry retention purge RPC
"purge_buddy_system_events" failed (table: buddy_system_events):
canceling statement due to statement timeout
```

Scheduling the cron was necessary but not sufficient. The purge functions from
`20260729000010_telemetry_retention.sql` ran an **unbounded `LOOP` inside a
single statement** — 10,000 rows, `pg_sleep(0.1)`, repeat until clean — against
`authenticator`'s `statement_timeout=8s`. With 316,046 rows past retention that
is ~32 batches plus 3.2 s of sleep alone. It could never succeed, which is why
retention had never once completed despite correct-looking code on both sides.

`20260827160000_bounded_telemetry_purge.sql` replaces all three with bounded,
single-statement deletes that return a row count, leaving the batching loop to
the caller — where it belongs, on the client side of a statement timeout.

**Cross-layer contract:** the SQL `p_max_rows` default must equal
`RETENTION_BATCH_SIZE` in `telemetryRetention.ts` (5,000), because the caller
invokes `sb.rpc(name)` with no arguments — so the SQL default *is* the batch
size, and `parseDeletedRows()` throws above it while treating a short return as
"drained". Documented on both sides. (The TypeScript half of this had already
been rewritten correctly on `main` after the audit branch merged; only the
database half was missing, which is precisely why it failed silently.)

Verified post-migration: correct signatures and defaults, `EXECUTE` granted to
`service_role` and denied to `public`, and all three returning promptly under
the exact zero-argument call shape the application uses.

### Not done, and why

**The duplicate Vercel Project Routes header rule still needs removing.** No MCP
tool exposes Vercel's routes configuration, and this environment's network
policy denies outbound to `buddysba.com` (`connect_rejected: gateway answered
403 to CONNECT`), so neither the routes API nor live header verification is
reachable from here. It remains a human action:

```
vercel routes list      # find the global security rule
vercel routes rm <id>   # remove it; next.config.mjs is now the source of truth
```

Until then two header sets race — the same failure mode that silently blocked
the microphone on `/start`.
