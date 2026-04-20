# Phase 84 T-10A + T-09 — Repo Hygiene + Roadmap/Env Reconcile (spec)

**Status:** Ready for Claude Code execution
**Authored:** 2026-04-20
**Supersedes:** T-09 and T-10 sections in `specs/phase-84-audit-remediation.md` (v2)
**Execution order:** T-10A FIRST (moves files), THEN T-09 (references new paths)

---

## Why these two tickets are bundled

T-10A archives 100+ root-level markdown files into `docs/archive/phase-pre-84/` and `docs/archive/operational-pre-84/`. T-09 reconciles `.env.example` and `BUDDY_PROJECT_ROADMAP.md` against current repo state — and the roadmap references many of those AAR files. Doing T-10A first means T-09 writes references at the new paths once, rather than reconciling twice.

Both tickets are largely mechanical and close Phase 84. After these two, Phase 84 is 10 of 10 done.

---

## Shared pre-work (both tickets)

```bash
git pull
# Confirm working tree clean
git status
# Confirm origin/main tip matches most recent T-08 commit (f84dc184 or later)
git log --oneline -5
```

---

# Part A — T-10A: Repo hygiene

## Pre-work

### Step A1 — Inventory root-level state
Run these and capture the counts for the AAR:

```bash
# Total .md files at root
ls -1 *.md 2>/dev/null | wc -l

# Phase-specific files (will move to docs/archive/phase-pre-84/)
ls -1 AAR_PHASE_*.md AAR_PHASES_*.md PHASE_*_SPEC.md PHASE_*_TICKETS.md \
      PHASE_*_LAUNCHER.md PHASE_*_PART2.md PHASE_4_FILES.txt 2>/dev/null | sort

# Remaining operational .md files (will move to docs/archive/operational-pre-84/)
KEEP="README.md|BUDDY_PROJECT_ROADMAP.md|BUDDY_BUILD_RULES.md|DEPLOYMENT.md|HOTFIX_LOG.md"
ls -1 *.md 2>/dev/null \
  | grep -vE "^AAR_PHASE" | grep -vE "^AAR_PHASES" | grep -vE "^PHASE_" \
  | grep -vE "^($KEEP)$" | sort

# Zero-byte artifacts confirmed at root
ls -la funnel node "buddy-the-underwriter@0.1.0" 2>/dev/null
```

Expected (per Opus pre-work):
- Root `*.md` count: ~113
- Phase-specific files: ~26 (AARs, specs, tickets, launchers)
- Operational `*.md` files: ~82
- Zero-byte artifacts: 3 confirmed (`funnel`, `node`, `buddy-the-underwriter@0.1.0`)

If counts are dramatically different, STOP and post — something changed.

### Step A2 — Keep-list confirmation
These 5 files STAY at root:
```
README.md
BUDDY_PROJECT_ROADMAP.md
BUDDY_BUILD_RULES.md
DEPLOYMENT.md
HOTFIX_LOG.md
```
Everything else gets archived.

### Step A3 — Verify no in-flight references to moved files
Before moving anything, quick grep for hard references to root-level markdowns from non-archive code:

```bash
# Are any src/ files importing or reading root-level .md files?
grep -rln "AAR_PHASE\|PHASE_.*_SPEC\|PHASE_.*_TICKETS" src/ 2>/dev/null | head -10

# Are any scripts pointing at root .md paths?
grep -rln "AAR_PHASE\|PHASE_.*_SPEC" scripts/ 2>/dev/null | head -10
```

Expected: 0 hits (these are documentation files, not imported). If any hit, note it in AAR and either update the reference or skip that file's archival.

## Implementation

### Step A4 — Create archive subdirectories
```bash
mkdir -p docs/archive/phase-pre-84/
mkdir -p docs/archive/operational-pre-84/
```

### Step A5 — Move phase-specific files
Use `git mv` to preserve history. Run each separately so failures are isolated:

```bash
git mv AAR_PHASE_*.md docs/archive/phase-pre-84/ 2>/dev/null || true
git mv AAR_PHASES_*.md docs/archive/phase-pre-84/ 2>/dev/null || true
git mv PHASE_*_SPEC.md docs/archive/phase-pre-84/ 2>/dev/null || true
git mv PHASE_*_PART2.md docs/archive/phase-pre-84/ 2>/dev/null || true
git mv PHASE_*_TICKETS.md docs/archive/phase-pre-84/ 2>/dev/null || true
git mv PHASE_*_LAUNCHER.md docs/archive/phase-pre-84/ 2>/dev/null || true
git mv PHASE_4_FILES.txt docs/archive/phase-pre-84/ 2>/dev/null || true
# Catch-all for any PHASE_*.md I may have missed
git mv PHASE_*.md docs/archive/phase-pre-84/ 2>/dev/null || true
```

### Step A6 — Move operational files
One-shot move of everything else except the 5 keeps. Build the list dynamically so we don't hard-code filenames (more robust than a static list):

```bash
KEEP_PATTERN="^(README\.md|BUDDY_PROJECT_ROADMAP\.md|BUDDY_BUILD_RULES\.md|DEPLOYMENT\.md|HOTFIX_LOG\.md)$"

for f in *.md; do
  if [[ ! "$f" =~ $KEEP_PATTERN ]]; then
    git mv "$f" docs/archive/operational-pre-84/ 2>/dev/null || true
  fi
done
```

### Step A7 — Remove zero-byte artifacts
```bash
git rm funnel node "buddy-the-underwriter@0.1.0" 2>/dev/null || true
```

### Step A8 — Verify final state
```bash
# Should be exactly 5
ls -1 *.md | wc -l
ls -1 *.md

# Count the archive contents
ls -1 docs/archive/phase-pre-84/ | wc -l
ls -1 docs/archive/operational-pre-84/ | wc -l

# Zero-byte artifacts gone
ls funnel node "buddy-the-underwriter@0.1.0" 2>/dev/null
# Expected: no such file or directory (all three)
```

Record exact counts in the AAR.

### Step A9 — Commit T-10A

Single commit message:
```
Phase 84 T-10A — archive 100+ root markdown files, remove zero-byte artifacts
```

### Step A10 — Write T-10A AAR
`docs/archive/phase-84/AAR_PHASE_84_T10A.md`. Structure:

```markdown
# AAR — Phase 84 T-10A — Root hygiene + file archival

**Date:** 2026-04-20
**Ticket:** T-10A (Wave 4 housekeeping)
**Commit:** <SHA>
**Completion event:** buddy_system_events id <id>

## 1. Scope
Archive 100+ root-level markdown files into two purpose-named subdirectories;
remove 3 zero-byte artifacts; keep only the 5 canonical operational docs at root.

## 2. Before / after counts (verbatim)
<paste Step A1 counts before, Step A8 counts after>

## 3. Keep-list (unchanged at root)
- README.md
- BUDDY_PROJECT_ROADMAP.md
- BUDDY_BUILD_RULES.md
- DEPLOYMENT.md
- HOTFIX_LOG.md

## 4. Archive structure created
- docs/archive/phase-pre-84/          — phase AARs, specs, tickets, launchers
- docs/archive/operational-pre-84/    — operational runbooks, audits, quickstarts

## 5. Zero-byte artifacts removed
- funnel
- node
- buddy-the-underwriter@0.1.0

## 6. References preserved
git mv was used throughout — file history is preserved at new paths.

## 7. Follow-up
T-09 will update BUDDY_PROJECT_ROADMAP.md to cite moved files at their new
paths where needed. No other in-flight references to moved files were found
during pre-work grep.
```

### Step A11 — Completion event
```sql
INSERT INTO buddy_system_events (event_type, severity, source_system, resolution_status, payload)
VALUES ('deploy', 'info', 'phase_84', 'resolved',
  jsonb_build_object(
    'kind', 'phase.84.t10a.completed',
    'root_md_before', <from Step A1>,
    'root_md_after', <from Step A8>,
    'phase_aars_archived', <from Step A8>,
    'operational_docs_archived', <from Step A8>,
    'zero_byte_removed', 3
  ))
RETURNING id;
```

### Step A12 — Verify on origin/main + post back (T-10A)
- Commit SHA
- AAR blob SHA
- Completion event id
- Before/after root-md count

---

# Part B — T-09: Roadmap + Env reconciliation

**Only start Part B after Part A completion event is written.** T-09 reconciles the roadmap — which references files that Part A moved. Sequencing matters.

## Pre-work

### Step B1 — Vercel env audit
Open Vercel dashboard for project `prj_cJ5hZ4lRRoVq5MqDTyP2fXVkbXlt` (team `team_OxRhkUfwTxqKBjnly5rddLg1`) → Settings → Environment Variables. Or via CLI:

```bash
# If Vercel CLI is installed
vercel env ls production
```

**Record (names only, no values) which of these are SET in production:**

```
# Required (voice, extraction, OCR)
GOOGLE_CLOUD_PROJECT           [ ? ]
GOOGLE_CLOUD_LOCATION          [ ? ]
GOOGLE_APPLICATION_CREDENTIALS [ ? ]
GCP_WIF_PROVIDER               [ ? ]
GCP_SERVICE_ACCOUNT_EMAIL      [ ? ]
GEMINI_API_KEY                 [ ? ]
GEMINI_MODEL                   [ ? ]
USE_GEMINI_OCR                 [ ? ] (value too — is it 'true' or 'false'?)
GEMINI_OCR_MODEL               [ ? ] (value too — what's the current model string?)

# Auth
CLERK_SECRET_KEY               [ ? ]
CLERK_JWT_KEY                  [ ? ]
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY [ ? ]

# Supabase
NEXT_PUBLIC_SUPABASE_URL       [ ? ]
NEXT_PUBLIC_SUPABASE_ANON_KEY  [ ? ]
SUPABASE_SERVICE_ROLE_KEY      [ ? ]

# Pulse / Omega (naming resolution — critical)
PULSE_MCP_ENABLED              [ ? ]
PULSE_MCP_URL                  [ ? ]
PULSE_MCP_API_KEY              [ ? ]
PULSE_MCP_TIMEOUT_MS           [ ? ]
PULSE_MCP_STRICT               [ ? ]
PULSE_BUDDY_INGEST_URL         [ ? ]
PULSE_BUDDY_INGEST_SECRET      [ ? ]
OMEGA_MCP_ENABLED              [ ? ]
OMEGA_MCP_URL                  [ ? ]
OMEGA_MCP_API_KEY              [ ? ]
OMEGA_MCP_TIMEOUT_MS           [ ? ]
OMEGA_MCP_KILL_SWITCH          [ ? ]

# OpenAI (chatAboutDeal only)
OPENAI_API_KEY                 [ ? ]

# Legacy (expected REMOVED — flag if present)
OPENAI_REALTIME_MODEL          [ ? ]
OPENAI_REALTIME_VOICE          [ ? ]
OPENAI_REALTIME_TRANSCRIBE_MODEL [ ? ]

# Twilio
TWILIO_ACCOUNT_SID             [ ? ]
TWILIO_AUTH_TOKEN              [ ? ]
TWILIO_FROM_NUMBER             [ ? ]

# Infra / obs
CRON_SECRET                    [ ? ]
SENTRY_DSN                     [ ? ]
NEXT_PUBLIC_SENTRY_DSN         [ ? ]
HONEYCOMB_API_KEY              [ ? ]
HONEYCOMB_DATASET              [ ? ]

# App-level
NEXT_PUBLIC_APP_URL            [ ? ]
PUBLIC_BASE_URL                [ ? ]
BUDDY_MCP_API_KEY              [ ? ]

# Buddy Voice Gateway (Fly.io — not Vercel, but document in .env.example)
BUDDY_GATEWAY_SECRET           [ ? ]
GOOGLE_SERVICE_ACCOUNT_KEY     [ ? ]
```

**Critical question this audit answers:** is the MCP env `PULSE_MCP_*` or `OMEGA_MCP_*`? The v2 spec assumed `OMEGA_MCP_*`; the current `.env.example` uses `PULSE_MCP_*`. Vercel is the source of truth — go with whatever it actually uses.

Post the full Vercel env presence/absence report back before touching `.env.example`.

### Step B2 — Post-T-10A AAR path inventory
```bash
ls -1 docs/archive/phase-pre-84/AAR_PHASE_*.md 2>/dev/null | sort
ls -1 docs/archive/phase-84/AAR_PHASE_*.md 2>/dev/null | sort
```

This generates the authoritative "shipped phases since last roadmap update" list. Post back for roadmap reconciliation.

### Step B3 — Migration ledger (already captured by Opus, recite)
```
Most recent migrations as of 2026-04-20:
  20260604  phase_66c_live_outcome_dominance
  20260603  phase_66b_experience_layer
  20260602  phase_66a_multi_agent_control_plane
  20260601  underwriting_launch_control_reconciliation_group
  20260531  autonomous_assist_deal_control_portfolio_group
  20260530  relationship_crypto_extension
  20260516  borrower_health_reports
  20260515  covenant_packages
  20260514  validation_and_eval
  20260513  watchlist_workout
  20260512  annual_review_renewal_engine
  20260511  post_close_monitoring
  20260510  command_center
  20260509  memo_decision_closeout
  20260508  distribution_layer
  20260507  structure_governance
  20260506  structuring_recommendation_snapshots
  20260505  committee_exception_workflow
  20260504  policy_ingestion_decision_memory
  20260503  memory_spine_activation
  ...
  Phase 84 migrations:
    20260417210930  phase_84_rls_tenant_wall_batch_a         (T-01)
    20260420133630  phase_84_t02b_gatekeeper_doc_type_add_pfs (T-02b)
    20260420143540  phase_84_t06_idempotency_guard_schema     (T-06)
    20260420143702  phase_84_t06_idempotency_guard_rpc        (T-06)
    20260420150707  phase_84_t05_deprecate_legacy_checklist   (T-05)
```

No re-query needed. Cite these in the AAR.

## Reconciliation — DO NOT APPLY YET, PROPOSE FIRST

After B1 + B2 complete, **propose diffs to Opus before committing.** The spec said "reconcile, not rewrite blind." These two files are load-bearing documentation; Opus ratifies the framing before it lands on main.

### Proposed `.env.example` diff (adjust per B1 findings)

**Remove** (OpenAI Realtime voice is dead — Phase 51 made voice fully Gemini):
```
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VOICE=marin
OPENAI_REALTIME_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
```

**Change defaults:**
```
- USE_GEMINI_OCR=false
+ USE_GEMINI_OCR=true
```

**Replace stale model strings with pointer comments** (Gemini model strings evolve — hardcoding is worse than the comment):
```
- GEMINI_OCR_MODEL=gemini-2.0-flash-exp
+ # GEMINI_OCR_MODEL is auto-selected by the gatekeeper (see src/lib/gatekeeper/geminiClassifier.ts).
+ # Override only for experiments — the default tracks the current Gemini Flash production model.
+ # GEMINI_OCR_MODEL=

- GEMINI_MODEL=gemini-1.5-flash
+ # GEMINI_MODEL tracks current Flash model; see src/lib/ai/models.ts for canonical strings.
+ GEMINI_MODEL=gemini-3-flash-preview
```

**Dedupe TWILIO** (currently appears at lines 49-51 and 79-82 of `.env.example`). Keep the first block with commented fallback noting it's used for borrower portal links + nudges.

**Add `CLERK_JWT_KEY`** block:
```
+ # Clerk JWT public key for zero-network-call server-side verification.
+ # Required on Vercel — enables clerkMiddleware to verify session tokens without
+ # round-tripping to Clerk's API on every request. Format: RSA public key PEM.
+ CLERK_JWT_KEY=
```

**Decide OMEGA_MCP_* vs PULSE_MCP_* based on B1 findings:**
- If Vercel has `PULSE_MCP_*` set → keep current `.env.example` block, remove references to `OMEGA_MCP_*` from v2 spec
- If Vercel has `OMEGA_MCP_*` set → replace `PULSE_MCP_*` block with `OMEGA_MCP_*` naming
- If Vercel has BOTH set (likely transitional) → document both, mark which is canonical with a comment, file Phase 84.1 follow-up to consolidate

**Keep unchanged** (confirmed still used):
- `OPENAI_API_KEY` (chatAboutDeal, per roadmap "OpenAI is now used for one workload only: chatAboutDeal")
- All Supabase, Clerk, Google Cloud, Twilio, Sentry, Honeycomb vars
- `BUDDY_GATEWAY_SECRET`, voice gateway config

### Proposed `BUDDY_PROJECT_ROADMAP.md` diff

The doc is internally inconsistent (header says Phase 57C, body mentions Phase 66/67). DO NOT rewrite wholesale. Apply these surgical edits:

**1. Update the header block:**
```
- **Last Updated: March 30, 2026**
- **Status: Phase 57C complete + underwriting platform through Phase 57B / 56R.1 + Phase 54 (cockpit truth) + Phase 66 (document foundation) + Phase 67 (UI wiring)**
+ **Last Updated: April 20, 2026**
+ **Status: Phase 84 closing (9 of 10 tickets complete) — see docs/archive/phase-84/ for active ticket AARs**
+ **Most recent architectural work: Phases 68-83 (ignite wizard, joint-filer intelligence, proof-of-truth, classification supremacy, lease/credit-memo). See docs/archive/phase-pre-84/ for historical phase AARs and specs.**
```

**2. Add a "Phase 84 — System Audit Remediation" entry to the Completed Phases list** (between Phase 67 and the ... Progress Tracker):

```markdown
### Phase 84 ✅ — System Audit Remediation (closing)

10-ticket phase closing 37 audit findings. RLS batch A, document classifier
fix, observer dedup audit, runRecord wiring, checklist taxonomy audit,
idempotency guard, narrow Omega fallback, governance writers audit,
env/roadmap reconciliation, repo hygiene.

See docs/archive/phase-84/ for per-ticket AARs and audit docs.

**Meta-finding:** zero non-test deals in production database — flagged as
T-08-G (top of Phase 84.1 backlog) for product/sales clarification before
prioritizing further governance build work.
```

**3. Update the Progress Tracker table.** Append rows for phases shipped after Phase 58A:

```markdown
| Phase 65A | Omega Advisory Panel — Pulse state view, ai_risk_runs fallback, compliance wall | ✅ Complete | <AAR sha> |
| Phases 68-70 | Reference AARs in docs/archive/phase-pre-84/ | ✅ Complete | — |
| Phases 71-75 | Agent group, governance foundation (writers queued in Phase 84.1) | ✅ Complete | — |
| Phases 78-83 | Memo evidence, joint filer, proof-of-truth, classification, ignite wizard | ✅ Complete | — |
| Phase 84 | System audit remediation (9/10 closed) | 🟡 In progress | see docs/archive/phase-84/ |
```

**4. Update the "Next Phases" priority list.** Current list at bottom of file mentions Canonical Credit Memo Facts, Observability, Model Engine V2, Borrower Intake, Corpus Expansion. Add at top:

```markdown
1. **Phase 84.1 backlog** — see docs/archive/phase-84/ for generated tickets, including the gating T-08-G (production activity baseline). Until T-08-G is answered, other priorities are provisional.
```

**5. DO NOT touch:**
- The Vision + Accuracy Philosophy sections (still accurate)
- The Intelligence Stack diagram (still the right architecture)
- The Build Principles list (all still hold)
- The Technical Stack table
- The AI Provider Inventory (pending product-level changes)
- The "Current State — Active Deals" section, EXCEPT note that Samaritus deal was deleted from prod (see userMemories / earlier Phase 84 notes) — add a one-line struck-through note

**6. Update the Samaritus line:**
```
- **Deal ffcc9733** — Samaritus Management LLC (primary active test deal)
+ **Deal ffcc9733** — Samaritus Management LLC — *DELETED from prod during pre-Phase-84 cleanup. New canonical test deal TBD. See Phase 84.1 backlog.*
```

## Implementation — after Opus ratifies proposed diffs

### Step B4 — Apply diffs
Edit both files per ratified proposal. Do NOT regenerate from scratch.

### Step B5 — Commit T-09
```
Phase 84 T-09 — reconcile .env.example + roadmap against current repo state
```

### Step B6 — T-09 AAR
`docs/archive/phase-84/AAR_PHASE_84_T09.md`. Structure:

```markdown
# AAR — Phase 84 T-09 — Env + Roadmap reconciliation

**Date:** 2026-04-20
**Ticket:** T-09 (Wave 4 housekeeping)
**Commit:** <SHA>
**Completion event:** buddy_system_events id <id>

## 1. Scope
Reconcile .env.example + BUDDY_PROJECT_ROADMAP.md against current Vercel
env state and post-T-10A repo structure. "Reconcile, not rewrite" — surgical
edits preserving all still-accurate content.

## 2. Vercel env audit (names only, presence/absence)
<paste B1 findings, redacted to names + presence>

## 3. .env.example changes applied
<per-line summary of what was added, removed, modified, kept>

## 4. Roadmap changes applied
<per-section summary: header updated, Phase 84 entry added, tracker rows
appended, Next Phases reprioritized, Samaritus line struck through>

## 5. Open questions surfaced
- PULSE_MCP_* vs OMEGA_MCP_* naming (per B1 decision)
- Samaritus replacement as canonical test deal
- T-08-G answer shapes all Phase 84.1 priorities

## 6. Spec deviations
<any deviations from the proposed diffs Opus ratified>
```

### Step B7 — Completion event
```sql
INSERT INTO buddy_system_events (event_type, severity, source_system, resolution_status, payload)
VALUES ('deploy', 'info', 'phase_84', 'resolved',
  jsonb_build_object(
    'kind', 'phase.84.t09.completed',
    'env_example_lines_added', <fill>,
    'env_example_lines_removed', <fill>,
    'roadmap_sections_updated', <fill>,
    'mcp_env_canonical_naming', '<PULSE_MCP|OMEGA_MCP|BOTH>',
    'samaritus_status', 'deleted_from_prod_flagged_for_replacement'
  ))
RETURNING id;
```

### Step B8 — Verify + post back (T-09)
- Commit SHA
- AAR blob SHA
- Completion event id
- Summary of what changed in each file

---

# Phase 84 closure

After T-09 commits, Phase 84 is **10 of 10 tickets closed**.

Final closure checklist Claude Code runs after T-09:

```bash
# Verify all 10 tickets have AARs
ls -1 docs/archive/phase-84/AAR_PHASE_84_*.md | sort

# Expected list (10 files):
#   AAR_PHASE_84_T01.md
#   AAR_PHASE_84_T02.md
#   AAR_PHASE_84_T03.md
#   AAR_PHASE_84_T04.md
#   AAR_PHASE_84_T05.md
#   AAR_PHASE_84_T06.md
#   AAR_PHASE_84_T07.md
#   AAR_PHASE_84_T08.md
#   AAR_PHASE_84_T09.md
#   AAR_PHASE_84_T10A.md
#   AAR_PHASE_84_T10B.md
# (T-10A and T-10B both present — T-10 was split across the ticket)
```

```sql
-- Confirm 10 completion events (one per ticket)
SELECT payload->>'kind' as kind, id, created_at
FROM buddy_system_events
WHERE payload->>'kind' LIKE 'phase.84.%'
  AND payload->>'kind' NOT LIKE 'phase.84.1.%'
ORDER BY created_at;
-- Expected rows, in order:
--   phase.84.t01a.completed
--   phase.84.t02.completed
--   phase.84.t10b.completed
--   phase.84.t06.completed
--   phase.84.t05.completed
--   phase.84.t04.completed
--   phase.84.t03.completed
--   phase.84.t07.completed
--   phase.84.t08.completed
--   phase.84.t10a.completed  <-- new
--   phase.84.t09.completed   <-- new
-- = 11 rows total (T-10 split A+B)
```

Write a one-paragraph Phase 84 closure note in Pulse memory:

```
Phase 84 closed 2026-04-20. 10 tickets, 4 converted to audit-only (T-03, T-05,
T-08, plus T-10 split A/B), 1 substantially rewritten (T-07 shape-translation
fallback), 6 shipped implementation (T-01, T-02, T-04, T-06, T-09, T-10A/B).
Meta-lesson: Wave 1 "stop the bleeding" tickets have structural risk of being
already-fixed by execution time (T-02, T-03, T-06 all hit this pattern) — pre-work
earns its keep. Phase 84.1 backlog includes 7 T-08 generated tickets (T-08-A
through T-08-G), RLS Batch B, extraction writer coverage, bank_id JWT minting,
fact re-parenting, .update()/.insert() silent-error audit, and production
activity baseline (T-08-G) gating the rest.
```

---

## Execution boundary

Do not:
- Rewrite BUDDY_PROJECT_ROADMAP.md from scratch
- Remove root-level AARs of work that hasn't completed (check carefully)
- Touch files in docs/archive/phase-84/ (ship as-is)
- Delete or archive files that currently appear in the KEEP list (README, ROADMAP, BUILD_RULES, DEPLOYMENT, HOTFIX_LOG)
- Modify .env.example entries beyond the ratified diff
- Add or remove Vercel env vars (reconciliation is documentation-only)

Do:
- Run pre-work greps for in-flight references before archival
- Use `git mv` for all file moves to preserve history
- Propose diffs to Opus before committing T-09
- Cite real migration versions + real file paths in the roadmap
- Include a Samaritus-deleted note in the roadmap (per userMemories context)
- Commit each ticket separately — T-10A first, T-09 second
- Record verbatim before/after counts in AARs

If pre-work surfaces anything that contradicts the spec (e.g., a root .md that IS imported by src/, or a Vercel env var that's canonical but absent from .env.example), STOP and post before proceeding.
