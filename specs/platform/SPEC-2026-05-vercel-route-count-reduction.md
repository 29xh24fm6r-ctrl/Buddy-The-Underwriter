# SPEC — Vercel Route Count Reduction & Deployment Headroom

**Path when committed:** `specs/platform/SPEC-2026-05-vercel-route-count-reduction.md`
**Status:** Ready for implementation planning
**Owner:** Matt — architecture / Claude Code — implementation
**Primary objective:** Restore and preserve Vercel deployability by reducing Next.js App Router route-manifest pressure and adding durable headroom under the Vercel 2048 route cap.

---

## 1. Executive summary

Buddy hit Vercel’s deploy-time route limit:

```text
errorCode: too_many_routes
errorMessage: Maximum number of routes (rewrites, redirects, etc) exceeded.
Max is 2048, received 2065. Please reduce the number of routes.
```

The immediate regression was caused by route expansion from the memo-input completeness layer. PR #400 consolidated six memo-input API sub-routes into the existing umbrella route and produced a successful Vercel preview deployment, confirming the immediate blocker is resolved.

However, the successful deployment likely lands very close to the 2048 cap. The system has effectively zero route headroom. Any new `route.ts` or `page.tsx` file may push Buddy back into `too_many_routes`.

This spec defines:

1. Immediate sequencing to restore green main.
2. A safe buffer plan to create near-term headroom.
3. A longer-term route consolidation strategy.
4. Guardrails to prevent route bloat from recurring.

---

## 2. Confirmed facts

### 2.1 Deploy failure root cause

The failure is not TypeScript, build, env vars, Next config, Vercel runtime smoke, or PR1 intake changes.

The build completes successfully, then Vercel fails during deploy output validation because the generated deployment route manifest exceeds the platform cap.

Confirmed error:

```text
errorCode: too_many_routes
errorMessage: Maximum number of routes (rewrites, redirects, etc) exceeded.
Max is 2048, received 2065. Please reduce the number of routes.
readyState: ERROR
```

### 2.2 Regression window

The first red deploy was introduced by the memo-input completeness layer commit:

```text
9b9c83b7 — add memo input completeness layer
```

That merge reached main via:

```text
834912da — merge banker analysis alerts into main
```

All later main deploys stayed red because main was already over the route cap.

### 2.3 Immediate fix already validated

PR #400:

```text
https://github.com/29xh24fm6r-ctrl/Buddy-The-Underwriter/pull/400
```

Branch:

```text
fix/memo-inputs-route-consolidation
```

Commit:

```text
d8307755
```

Vercel deployment:

```text
dpl_GYoFNwUeKPdMGjSBfmjimV7JrVqD
```

Result:

```text
readyState: READY
errorCode: none
errorMessage: none
```

### 2.4 Estimated route count after PR #400

Before PR #400:

```text
2065 deploy routes
17 over cap
```

PR #400 removed six route leaf files.

Empirical multiplier:

```text
~2.83 deploy routes per leaf file
```

Estimated savings:

```text
6 leaf files × 2.83 ≈ 17 deploy routes
```

Estimated post-patch deployment route count:

```text
~2040–2048
```

Confirmed:

```text
<= 2048 because deploy succeeded
```

Important caveat:

Vercel exposes the exact route count in the failure error, but not in successful deployment metadata. The successful PR #400 deployment confirms Buddy is now under the cap, but does not expose exact headroom.

### 2.5 Current headroom is effectively zero

Even after PR #400, Buddy likely has between zero and eight deploy routes of headroom.

A single new `route.ts` can cost roughly two to four deploy routes. A single new `page.tsx` can cost roughly three to five deploy routes.

Therefore:

> Do not merge additional feature PRs that add routes until we create buffer.

---

## 3. Inputs synthesized

This spec incorporates three sources:

1. Claude.ai route-cap research:

   * Large route surface.
   * `/api/deals/[dealId]/*` is the dominant route family.
   * Many single-method endpoints and verb-style routes exist.
   * Static zero-reference routes exist but must not be blindly deleted.

2. Claude Code verified deployment findings:

   * PR #400 deploys successfully.
   * Immediate memo-input consolidation fixes the route-cap blocker.
   * Post-fix headroom remains near zero.
   * Option B survey of `/api/deals/[dealId]/*` is the recommended next step.

3. Matt/OpenAI review corrections:

   * Do not start with broad dead-route deletion.
   * Do not remove the memo-inputs page yet.
   * Merge PR #400 first to restore deployability.
   * Then create a measured buffer by pruning/consolidating a small number of safe routes.
   * Require access-log proof before deleting externally callable routes.

---

## 4. Non-negotiable constraints

### 4.1 Do not revert the memo-input layer

The immediate route cap issue has a targeted fix in PR #400. Do not perform a broad rollback of the memo-input completeness work unless PR #400 unexpectedly fails after merge.

### 4.2 Do not merge PR #399 until main is green

PR #399 — Intake V2 operational safety — is clean, but must be rebased onto deployable main after PR #400 lands.

### 4.3 Do not delete routes based only on grep

Static zero references do not prove a route is unused.

Routes may be called by:

* Vercel cron
* external integrations
* webhooks
* borrower links
* bank integrations
* manual scripts
* curl/admin ops
* browser bookmarks
* old emails
* third-party systems

Deletion requires stronger proof.

### 4.4 Do not remove the memo-inputs page as the first buffer move

Removing:

```text
src/app/(app)/deals/[dealId]/memo-inputs/page.tsx
```

would save only about three to five deploy routes and requires URL churn across multiple UI callers.

That is too little buffer for the product cost.

### 4.5 No new route files without review

Until route count has at least 25 deploy routes of buffer, no feature PR should add new `route.ts` or `page.tsx` files unless explicitly approved.

---

## 5. Immediate sequencing

### Step 1 — Merge PR #400

Merge:

```text
PR #400 — memo-input route consolidation
```

Goal:

```text
Restore main deployability.
```

Verification after merge:

* Main Vercel deployment reaches `READY`.
* No `too_many_routes` error.
* TypeScript clean.
* Memo-input flows smoke tested.

### Step 2 — Rebase PR #399 on green main

After PR #400 is merged and main is green:

```bash
git checkout spec-intake-v2/pr1-operational-safety
git fetch origin
git rebase origin/main
```

Then rerun:

```bash
pnpm tsc --noEmit
pnpm test
```

Open/update PR #399 checks.

### Step 3 — Do not merge PR #399 until buffer decision is complete

PR #399 itself does not appear to add route pressure, but the repo is still too close to the limit. Before merging additional operational work, complete the Option B buffer survey and decide whether to apply a small route-pruning/consolidation patch.

---

## 6. Buffer objective

Create near-term headroom of at least:

```text
15 deploy routes minimum
25 deploy routes preferred
```

Estimated source route reduction needed:

```text
15 deploy routes ≈ 5 route leaf files
25 deploy routes ≈ 8–10 route leaf files
```

Do not aim for a massive cleanup in the first buffer PR. The goal is to safely prevent the next deploy failure while preserving product behavior.

---

# PART A — Option B survey: targeted `/api/deals/[dealId]/*` cleanup

## A1. Goal

Identify five to ten safe route leaf files in the `/api/deals/[dealId]/*` family that can be deleted or consolidated with minimal risk.

Do not edit code during the survey phase.

## A2. Survey target

Primary family:

```text
src/app/api/deals/[dealId]/**/route.ts
```

Reason:

Claude.ai research found this family to be the dominant source of route bloat. It also contains many thin, single-purpose, verb-style endpoints that are more likely to be safely consolidated than borrower, webhook, or cron endpoints.

## A3. Candidate types, ordered by preference

### Type 1 — Obvious duplicate or legacy route

Examples:

```text
foo-v1 next to foo-v2
legacy-* next to canonical replacement
old route with newer route serving same function
```

Required proof:

* Replacement endpoint exists.
* No current callers.
* No cron/webhook/external indication.
* Route name or comments indicate legacy/deprecated.

### Type 2 — Verb-style route foldable into parent

Examples:

```text
/checklist/list
/checklist/seed
/intake/run
/intake/process
/conditions/list
/borrower/create
/borrower/update
```

Preferred conversion:

```text
GET    /api/deals/[dealId]/checklist
POST   /api/deals/[dealId]/checklist { action: "seed" }
PATCH  /api/deals/[dealId]/borrower
POST   /api/deals/[dealId]/intake { action: "run" }
```

Required proof:

* Parent route exists or can absorb logic safely.
* Caller list is complete and easy to update.
* Response envelope remains identical.

### Type 3 — Orphan internal route with no callers

Required proof:

* No references in `src/`.
* No references in scripts/tests.
* Not listed in `vercel.json`.
* Not webhook-like.
* Not borrower/public/token based.
* Not known external integration.
* Ideally zero hits in recent Vercel access logs.

### Type 4 — Route cluster consolidation

Examples:

```text
/re-extract
/reextract-all
/reclassify-all
/reprocess-documents
```

Preferred conversion:

```text
POST /api/deals/[dealId]/reprocess { scope: "facts" | "docs" | "classification" | "all" }
```

Required proof:

* Shared auth pattern.
* Shared response envelope.
* Caller list known.
* Tests or smoke coverage possible.

## A4. Routes excluded from deletion without access-log proof

Do not delete or consolidate these in the first buffer PR unless explicitly approved:

* `/api/borrower/*`
* `/api/portal/*`
* public/token routes
* webhook routes
* Twilio/Clerk/Stripe/Mailgun-like routes
* Vercel cron routes
* worker routes
* bank integration routes
* upload routes
* externally shared links
* routes referenced in emails/SMS

## A5. Survey commands

Run from repo root:

```bash
find src/app/api/deals/[dealId] -name route.ts | sort > /tmp/deal-routes.txt
wc -l /tmp/deal-routes.txt
```

Find one-method routes:

```bash
while read -r f; do
  methods=$(grep -E "^export async function (GET|POST|PUT|PATCH|DELETE)" "$f" | sed -E 's/export async function ([A-Z]+).*/\1/' | tr '\n' ',' | sed 's/,$//')
  count=$(echo "$methods" | awk -F',' '{print NF}')
  if [ -n "$methods" ] && [ "$count" -eq 1 ]; then
    echo "$f $methods"
  fi
done < /tmp/deal-routes.txt > /tmp/deal-single-method-routes.txt
```

Find verb-style route segments:

```bash
grep -E '/(get|list|set|run|process|create|update|delete|seed|kick|sync|refresh|generate|submit|export|reprocess|reextract|re-extract|reclassify)[^/]*/route.ts$' /tmp/deal-routes.txt > /tmp/deal-verb-routes.txt
```

Find references for a candidate route:

```bash
route="/api/deals/\${dealId}/SOME_PATH"
grep -rn "SOME_PATH\|/api/deals/.*/SOME_PATH" src scripts tests || true
```

Also search literal segment:

```bash
grep -rn "SOME_PATH" src scripts tests || true
```

## A6. Required survey output

Before code edits, produce a table:

| Candidate | Type | Current method | Current callers | Proposed action | Estimated deploy-route savings | Risk | Proof |
| --------- | ---- | -------------: | --------------- | --------------- | -----------------------------: | ---- | ----- |

Minimum candidate set:

```text
5 leaf files
```

Preferred candidate set:

```text
8–10 leaf files
```

Target savings:

```text
15–25 deploy routes
```

---

# PART B — First buffer PR

## B1. Scope

Implement only the approved candidates from the Option B survey.

Allowed changes:

* Delete confirmed orphan route files.
* Consolidate approved verb routes into existing parent routes.
* Update internal callers.
* Add compatibility handling if needed.
* Add or update tests for changed callers.

Not allowed:

* Broad `/api/deals` redesign.
* Deleting borrower/public/webhook/cron routes.
* Changing business logic.
* Changing auth semantics.
* Changing response envelopes unless explicitly approved.

## B2. Compatibility rule

If consolidating a route, preserve response shape exactly.

For example, if old route returned:

```ts
{ ok: true, data }
```

new route must return the same envelope.

If old route used warning-shaped errors per Buddy convention, preserve warning shape.

## B3. Auth rule

Preserve the stricter auth check when consolidating.

If two routes are merged and one route has stricter auth, use the stricter auth for that action branch.

Do not accidentally make admin/banker-only operations callable by borrower/public actors.

## B4. Tests

At minimum:

```bash
pnpm tsc --noEmit
pnpm test
```

Add targeted tests if any route behavior changes.

For each changed route:

* old caller path updated
* new handler branch covered by smoke/unit test where practical
* error shape preserved

## B5. Verification

After PR opens:

* Vercel preview must be `READY`.
* No `too_many_routes` error.
* If Vercel exposes route count in error, paste it. If not, estimate based on leaf count reduction.
* Report leaf file delta.
* Report estimated deploy-route savings.

---

# PART C — Longer-term route count reduction plan

## C1. Track 1 — Cron dispatcher consolidation

Current `vercel.json` contains 11 cron entries.

Create:

```text
src/app/api/cron/dispatch/route.ts
```

Change `vercel.json` entries to call:

```text
/api/cron/dispatch?job=borrower-reminders
/api/cron/dispatch?job=jobs-worker-spreads&batch_size=3
/api/cron/dispatch?job=artifacts-process&max=20
/api/cron/dispatch?job=pulse-forward-ledger&max=25
/api/cron/dispatch?job=ops-observer-tick
/api/cron/dispatch?job=intake-outbox&max=10
/api/cron/dispatch?job=intake-recovery
/api/cron/dispatch?job=doc-extraction&max=5
/api/cron/dispatch?job=pulse-outbox&max=10
/api/cron/dispatch?job=brokerage-cleanup-expired
/api/cron/dispatch?job=banker-analysis-alerts
```

Important:

Vercel may still count each cron path in `vercel.json`, even if the path is same with different query strings. Verify this with a preview deployment before assuming savings.

Do not delete original cron route handlers until dispatcher is proven and cron behavior is covered.

Recommended implementation:

* Dispatcher imports or calls shared handler functions.
* Existing cron route files become thin wrappers or are removed only after verification.
* Include secret/header validation identical to existing routes.

Estimated savings:

```text
uncertain until tested
```

## C2. Track 2 — Verb-route consolidation rule

Add engineering rule:

```text
No new /api/.../<verb>/route.ts endpoints for get/list/set/run/process/create/update/delete/seed/kick/sync/refresh unless explicitly approved.
```

Preferred pattern:

```text
GET    /api/resource
POST   /api/resource { action: "..." }
PATCH  /api/resource { action: "..." }
```

Add a CI guard script:

```text
scripts/check-route-budget.ts
```

Guard should:

* count `src/app/**/route.ts`
* count `src/app/**/page.tsx`
* fail if total leaf count increases without an override label/file
* warn on verb-style route segments

## C3. Track 3 — `/api/deals/[dealId]` cluster consolidation

After buffer PR, plan a larger consolidation by resource cluster.

Candidate clusters:

* intake
* borrower actions
* reprocessing actions
* credit memo actions
* conditions
* checklist
* pricing
* builder
* decision
* documents

Each cluster should get its own mini-spec before implementation.

Do not consolidate all clusters in one PR.

## C4. Track 4 — Dead route deletion with access-log proof

For routes with no static references:

Required proof before delete:

1. No source references.
2. No script/test references.
3. No `vercel.json` reference.
4. No webhook/public/token semantics.
5. No access logs in last 30 days.
6. Owner signoff if admin/ops route.

Deletion batch size:

```text
<= 30 routes per PR
```

Each PR must include:

* route list
* proof table
* rollback note
* Vercel preview result

---

# PART D — Route budget guardrail

## D1. Route budget target

Short term:

```text
source leaves <= 950
```

After buffer PR:

```text
source leaves <= 945 preferred
```

Medium term:

```text
source leaves <= 850
```

Long term:

```text
source leaves <= 650
```

## D2. CI script

Add:

```text
scripts/check-route-budget.ts
```

Behavior:

```ts
count route.ts files
count page.tsx files
print totals by top-level family
print top 10 route families
warn on verb-style segments
fail if total exceeds configured budget
```

Initial mode:

```text
warning only
```

After two cleanup PRs:

```text
enforced mode
```

Suggested config:

```json
{
  "routeBudget": {
    "maxSourceLeaves": 950,
    "warnVerbSegments": true,
    "blockedVerbSegments": [
      "get",
      "list",
      "set",
      "run",
      "process",
      "create",
      "update",
      "delete",
      "seed",
      "kick",
      "sync",
      "refresh"
    ]
  }
}
```

## D3. PR template addition

Add to PR checklist:

```text
- [ ] Does this PR add any new route.ts or page.tsx files?
- [ ] If yes, why could this not be added to an existing route?
- [ ] Route leaf delta: __
- [ ] Estimated deploy-route delta: __
```

---

# PART E — Implementation order

## Phase 0 — Already done / validate

* PR #400 open.
* Vercel preview READY.
* Memo-input route consolidation validated.

Action:

```text
Merge PR #400 first.
```

## Phase 1 — Option B survey

No code edits.

Run the candidate survey for `/api/deals/[dealId]/*`.

Deliver:

* candidate table
* estimated savings
* risk rating
* recommended first buffer PR scope

## Phase 2 — First buffer PR

Implement approved five to ten route-leaf reductions.

Target:

```text
15–25 deploy-route savings
```

Then verify preview deployment.

## Phase 3 — Rebase and merge PR #399

After main is green and buffer exists:

* rebase PR #399
* rerun tests
* ensure Vercel preview READY
* merge by squash

## Phase 4 — Route budget guard

Add route budget script and PR checklist.

Initial mode: warning-only.

## Phase 5 — Longer-term consolidation specs

Prepare mini-specs for:

1. cron dispatcher
2. verb-route consolidation
3. intake route cluster consolidation
4. borrower route cluster consolidation
5. credit memo route cluster consolidation

---

# PART F — Acceptance criteria

## F1. PR #400 acceptance

* [ ] PR #400 merged.
* [ ] main deploys READY.
* [ ] no `too_many_routes` error.
* [ ] memo-input page and flows smoke tested.

## F2. Buffer PR acceptance

* [ ] At least 5 source route leaves removed or consolidated.
* [ ] Estimated deploy-route savings >= 15.
* [ ] No borrower/public/webhook/cron routes deleted without proof.
* [ ] TypeScript clean.
* [ ] tests clean.
* [ ] Vercel preview READY.
* [ ] changed callers verified.

## F3. PR #399 acceptance after buffer

* [ ] rebased onto green main.
* [ ] TypeScript clean.
* [ ] tests clean.
* [ ] Vercel preview READY.
* [ ] no new route pressure.

## F4. Guardrail acceptance

* [ ] route budget script exists.
* [ ] script prints route family breakdown.
* [ ] script warns on verb-style route additions.
* [ ] PR template includes route leaf delta checklist.

---

# PART G — Handoff prompt for Claude Code

```text
Implement the Vercel Route Count Reduction spec.

Current state:
- PR #400 fixed the immediate memo-input route cap blocker and has a READY Vercel preview.
- Do not remove the memo-inputs page yet.
- Do not broadly delete routes based only on grep.
- PR #399 should remain unmerged until main is green and route buffer is addressed.

Step 1:
Merge PR #400 once approved, then confirm main deploys READY.

Step 2:
Run an Option B survey of src/app/api/deals/[dealId]/**/route.ts.
Do not edit code during the survey.
Produce a candidate table with 5–10 safe route leaf reductions, prioritizing:
- obvious legacy/duplicate endpoints
- verb-style routes foldable into parents
- internal orphan routes with proof
- small clusters with identical auth/response patterns

Exclude borrower/public/webhook/cron/bank-integration routes unless access-log proof exists.

Step 3:
Wait for approval of candidate list.

Step 4:
Implement the approved buffer PR only.
Target 15–25 deploy routes of savings.
Preserve auth and response envelopes exactly.
Run pnpm tsc --noEmit and pnpm test.
Open PR with leaf delta and estimated deploy-route savings.

Step 5:
After buffer PR deploys READY, rebase PR #399 onto main and proceed with merge review.
```

---

# Final decision

The correct path is:

1. Merge PR #400.
2. Survey Option B for safe `/api/deals/[dealId]/*` route reductions.
3. Implement a small buffer PR.
4. Rebase and merge PR #399.
5. Add route-budget guardrails.
6. Plan larger route consolidation work separately.

Do not revert the memo-input layer. Do not delete broad “unused” routes without access-log proof. Do not remove the memo-inputs page as the first buffer move.
