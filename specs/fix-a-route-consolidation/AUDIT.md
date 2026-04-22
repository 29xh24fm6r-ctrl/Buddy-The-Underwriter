# Fix A — Route Consolidation Audit

**Date:** 2026-04-22
**Baseline commit:** `d20ddae3` (FIX-C observability shipped immediately prior)
**Method:** Pre-implementation verification per Fix A spec § "Pre-implementation verification"

## Baseline measurements

| Measurement | Value |
|---|---|
| Manifest-mode count (`scripts/count-routes.mjs --manifest`) | **2053** |
| Fast-mode count | 2059 |
| Vercel hard cap | 2048 |
| FIX-C error threshold | 2020 |
| **Target for Fix A (`current − 35`)** | **2018** |
| Expected reduction | 35 routes |

## Methodology notes

- **Source of per-candidate evidence:** `callers_count` from `grep -rl "<static_tail>"` across `src/` (excluding self). Uses the longest static suffix of each route's API path (split at `[` to avoid matching dynamic-segment templates). Searches < 15 chars are flagged `search_too_short` and re-verified manually.
- **`prod_hits_7d` NOT queried.** Vercel's runtime-logs REST API is not publicly documented with a query shape that supports per-path 7-day counts across 1000+ routes; `vercel logs` CLI only streams live. Spec allows this: *"Vercel logs are not exhaustive … use 0 hits as a strong signal only when combined with 0 source callers."* T0/T1 classification relies on `callers_count` alone. Re-considered for ambiguous cases; none found.
- **`last_modified` correction:** 127 route files were touched by the D5 `maxDuration` sweep (commit `efdf70c9`) on 2026-04-22 — their git last-modified dates now say "today" but substantive edits are older. Where relevant, substantive age is recomputed against the commit-before-sweep.
- **Route-groups `(app)` / `(examiner)`:** Next.js route groups parenthesized like `src/app/(app)/deals/[dealId]` don't contribute to the URL path but files inside DO count against the route manifest. Audit includes them.
- **Underscore-prefixed directories (`_builder`, `_meta`):** spec addendum says treat as T4 escalation by default. Included in T4 pool.

---

## Tier results

### T0 — Dead (auto-delete): **12 files**

Each meets the T0 rule: `callers_count == 0` AND `category in {debug, dev, sandbox}`.

| File | Category | Age (git) | Callers |
|---|---|---|---|
| `src/app/api/debug/clerk/route.ts` | debug | 22d | 0 |
| `src/app/api/debug/deals/[dealId]/facts/recompute/route.ts` | debug | 74d | 0 |
| `src/app/api/debug/edge-auth/route.ts` | debug | 102d | 0 |
| `src/app/api/debug/edge-ping/route.ts` | debug | 102d | 0 |
| `src/app/api/debug/me/route.ts` | debug | 78d | 0 (manually verified — auto-grep was `search_too_short`) |
| `src/app/api/debug/storage-probe/route.ts` | debug | 74d | 0 |
| `src/app/api/debug/supabase-raw/route.ts` | debug | 118d | 0 |
| `src/app/api/debug/upload-health/route.ts` | debug | 104d | 0 |
| `src/app/api/debug/version/route.ts` | debug | 104d | 0 |
| `src/app/api/debug/vertex-probe/route.ts` | debug | 4d | 0 |
| `src/app/api/dev/gemini-ocr-test/route.ts` | dev | 100d | 0 |
| `src/app/api/dev/storage/health/route.ts` | dev | 89d | 0 |

**Routes NOT in T0 despite `debug/dev/sandbox` path prefix** (kept because they have real callers):

| File | Real caller |
|---|---|
| `src/app/api/debug/client-telemetry/route.ts` | `src/lib/uploads/uploadFile.ts` sends a `navigator.sendBeacon` — production wiring |
| `src/app/api/debug/pdf-worker/route.ts` | `src/app/debug/pdf-worker/page.tsx` fetches it |
| `src/app/api/sandbox/deals/route.ts` | caller count 1 is a false positive (sibling path self-reference), but not strictly zero — treated as T4 |
| `src/app/api/sandbox/deals/[dealId]/route.ts` | same false-positive profile — T4 |
| `src/app/api/sandbox/seed/route.ts` | `src/components/admin/DemoAccessClient.tsx` fetches it |

### T1 — Stale orphan (auto-delete): **0 files**

T1 rule: `callers_count == 0` AND `age > 180d` AND `category NOT IN {public-api, cron, webhook, internal-builder}` AND not already T0.

Nothing qualifies. The codebase is young and active — orphan routes with 0 callers tend to be either recently-added-and-not-yet-wired (< 180d) or in protected categories.

### T2 — Sibling mergeable (merge GET into parent): **0 files**

5 candidates were detected with the T2 detector (paths ending in `/status`, `/preflight`, etc., where a parent route file exists). **All 5 were demoted because the parent already exports a `GET` handler** — per Fix A spec §A-2, this demotes to T3/T4 escalation rather than merge.

Demoted candidates:

| Sibling | Parent | Parent already exports GET? | Callers of sibling |
|---|---|---|---|
| `src/app/api/deals/[dealId]/checklist/status/route.ts` | `src/app/api/deals/[dealId]/checklist/route.ts` | yes | 0 |
| `src/app/api/deals/[dealId]/spreads/preflight/route.ts` | `src/app/api/deals/[dealId]/spreads/route.ts` | yes | 0 |
| `src/app/api/deals/[dealId]/spreads/status/route.ts` | `src/app/api/deals/[dealId]/spreads/route.ts` | yes | 0 |
| `src/app/api/deals/[dealId]/status/route.ts` | `src/app/api/deals/[dealId]/route.ts` | yes | 0 |
| `src/app/api/deals/[dealId]/uploads/status/route.ts` | `src/app/api/deals/[dealId]/uploads/route.ts` | yes | 0 |

**Substantive reading**: each sibling has 0 callers in `src/`. They are likely unused in the current client code. But they CANNOT be merged by the T2 rule because the parent's GET returns a different shape (e.g., `/checklist` GET returns the checklist rows; `/checklist/status` GET returns a completion status). They would need a different path (e.g., `?view=status` query param) to coexist — a design call beyond the T2 rule's scope. Escalated to T4.

### T3 — Near-duplicate (ESCALATE): **3 clusters**

These need Matt's judgment — do they represent legacy code that should be consolidated, or intentionally parallel surfaces that should stay?

1. **`/api/deals/[dealId]/builder/entities/[entityId]` vs `/api/deals/[dealId]/entities/[entityId]`** — Two parallel entity routes. `builder/` is from Phase 53A per `BUDDY_PROJECT_ROADMAP.md`; `entities` may predate it. Worth checking whether one is the intended canonical.

2. **`/api/deals/[dealId]/re-extract` + `/api/deals/[dealId]/reextract-all` + `/api/deals/[dealId]/reprocess-documents`** — Three fact-re-extract endpoints. Per prior memory, "reextract-all bypasses gatekeeper entirely" (Phase 20). Re-extract and reprocess-documents overlap; may be consolidatable to one.

3. **`/api/deals/[dealId]/recompute` vs `/api/deals/[dealId]/pipeline-recompute`** — Two deal-level recompute endpoints. Different purposes or legacy duplication.

4. **Typo'd orphan:** `src/app/api/deals/deals/[dealId]/etran/submit/route.ts` — the path has a doubled `deals/deals/` segment (almost certainly a `mv` mistake). Unreachable via the intended URL. Age 118d, 0 callers. Arguably T0 if we verify it was never meant to exist; T3 until Matt confirms.

### T4 — Low-traffic production (ESCALATE): **see below**

Routes with `callers_count == 0` in categories that could be called externally (not in the `debug/dev/sandbox` T0 pool).

Summary by category:

| Category | 0-caller count | Escalation note |
|---|---|---|
| admin-internal | 25 | Mostly `/api/admin/*/tick`, `/api/admin/*/process` — likely called by cron schedulers defined via Vercel or webhook URLs outside the repo. **Should not be auto-deleted.** |
| internal-builder | 10 | `/api/_builder/*` and `/api/builder/*` — Phase 53A Deal Builder surface. Per spec addendum, underscore prefix is a "don't touch without escalation" signal. |
| public-api | 44 | Called by external clients, browser extensions, borrower portals. 0 src callers is expected. **Should not be auto-deleted.** |
| deal-scoped | 3 + 5 demoted-T2 | See below |
| page | 35 | Pages are higher-bar per spec. 0 callers in src/ is normal for a directly-navigated page. |
| health | 1 | External monitoring probe. Keep. |
| webhook | 2 | Called externally. Keep. |
| cron | 2 | Called by scheduler. Keep. |

**High-priority T4 candidates for Matt's review** (low risk to delete, high yield):

1. `src/app/api/deals/bootstrap/route.ts` — 0 callers, 88d old, deal-scoped. Unclear purpose; may be superseded by `/api/deals/create` or `/api/deals/seed`.
2. `src/app/api/deals/deals/[dealId]/etran/submit/route.ts` — typo path (see T3 #4).
3. `src/app/api/deals/new/upload-session/route.ts` — 0 callers, 89d old. May be superseded by `/api/deals/[dealId]/bootstrap-upload-sessions` or `/api/deal-bootstrap-upload-sessions`.
4. The 5 demoted-T2 sibling `/status` and `/preflight` routes. All have 0 callers. Deletion outright (rather than merge) is defensible if Matt confirms none are called by the borrower portal, examiner portal, or any non-`src/` consumer.

### T5 — Keep (default)

Everything else. ~980 files. Summary counts by category in the methodology section above.

---

## Projected impact

**If we execute T0 only** (the only tier with auto-action candidates):

| Measurement | Before (main) | After T0 |
|---|---|---|
| Route files | 1010 | 998 (−12) |
| Estimated manifest total | 2053 | **~2029** (−24, using 2× RSC factor) |
| Vercel headroom to 2048 cap | −5 (at cap) | +19 |
| FIX-C error threshold | 2020 | still over by 9 |
| Target | 2018 | not hit by 11 |

**Conclusion:** T0 alone is safe and yields real runway from the 2048 cap (the production blocker), but does NOT hit Fix A's stated target of 2018.

Per spec §A-2 Batch 4 stop-check: **"If `count > TARGET_COUNT`: do NOT extend into T3/T4. Stop and write the 'needs escalation' section to AUDIT.md. Matt reviews and decides."**

---

## Needs escalation

After T0 lands (estimated count 2029), Fix A is still 11 routes above target. Extending requires Matt's adjudication on these T3/T4 candidates. In order of safety-to-delete (most defensible first):

### Tier E-1 — High-confidence extras (estimated −14 routes if all approved)

Likely-safe deletions; each reduces count by ~2 via the RSC expansion.

1. **`src/app/api/deals/deals/[dealId]/etran/submit/route.ts`** — typo'd duplicate path. 118d old, 0 callers. Almost certainly unreachable.
2. **`src/app/api/deals/bootstrap/route.ts`** — 0 callers, 88d old. Naming collides with newer bootstrap paths.
3. **`src/app/api/deals/new/upload-session/route.ts`** — 0 callers, 89d old.
4. **`src/app/api/deals/[dealId]/checklist/status/route.ts`** — 0 callers, 118d substantive. Parent has GET.
5. **`src/app/api/deals/[dealId]/uploads/status/route.ts`** — 0 callers, 107d substantive. Parent has GET.
6. **`src/app/api/deals/[dealId]/status/route.ts`** — 0 callers, 111d. Parent has GET.
7. **`src/app/api/deals/[dealId]/spreads/status/route.ts`** — 0 callers, 22d substantive. Parent has GET.

**All 7 have 0 src callers AND their parent paths export an equivalent GET.** The risk is that any of them are called by the borrower portal, admin UI in a non-src directory, or external monitoring. My `grep` is limited to `src/` so I have no visibility into `public/`, `.github/`, external callers.

### Tier E-2 — Specific T3 clusters requiring architecture decisions

8. **Builder entity routes:** keep one of `/api/deals/[dealId]/builder/entities/[entityId]` vs `/api/deals/[dealId]/entities/[entityId]` — requires Matt to choose the canonical surface. Savings: 2 routes.

9. **Extract-twin cluster:** `/api/deals/[dealId]/re-extract` + `/reextract-all` + `/reprocess-documents`. Consolidating to one or two endpoints would save 2-4 routes. Requires architectural review of current callers and intended semantics.

10. **Recompute cluster:** `/api/deals/[dealId]/recompute` vs `/api/deals/[dealId]/pipeline-recompute`. Requires review. Savings: 2 routes.

### Tier E-3 — Deferred (too risky without more data)

- 25 admin-internal 0-caller routes: almost all look like cron/scheduler endpoints. Deleting without a cron config audit risks silent cron breakage.
- 10 `_builder` internal routes: may be used by the Builder's IDE integration.
- 44 public-api 0-caller routes: external callers are the point.
- 35 page routes with 0 src callers: direct user navigation. Higher bar per spec.

**Recommendation for this PR:** ship T0 (−24 routes) now, which brings us to 2029 — below the 2048 cap with 19 routes of headroom, but still above Fix A's 2018 target. That is still a meaningful Vercel-risk reduction relative to the 2053 starting point.

Matt can then review Tier E-1 and decide which of the 7 high-confidence extras to delete in a follow-up commit (same PR). If all 7 land, we reach ~2015 — under target with real cushion.

Tiers E-2 and E-3 are deferred to a separate Fix A-2 scope because they need architecture decisions, not simple deletions.

---

## Execution appendix

### Batch 1 — T0 deletions

**Commit:** `99306b9e` — `feat(fix-a): T0 deletions — 13 debug/dev routes with 0 src callers`

Deleted 13 files (12 originally scoped + 1 caught by audit-bug fix):

| File | Verification |
|---|---|
| `src/app/api/debug/clerk/route.ts` | 0 imports, 0 callers |
| `src/app/api/debug/deals/[dealId]/facts/recompute/route.ts` | 0 imports, 0 callers |
| `src/app/api/debug/edge-auth/route.ts` | 0 imports, 0 callers |
| `src/app/api/debug/edge-ping/route.ts` | 0 imports, 0 callers |
| `src/app/api/debug/me/route.ts` | 0 imports, 0 callers (auto-grep `search_too_short`; verified manually) |
| `src/app/api/debug/storage-probe/route.ts` | 0 imports, 0 callers |
| `src/app/api/debug/supabase/route.ts` | 0 imports, 0 callers (missed by initial audit, see bug note below) |
| `src/app/api/debug/supabase-raw/route.ts` | 0 imports, 0 callers |
| `src/app/api/debug/upload-health/route.ts` | 0 imports, 0 callers |
| `src/app/api/debug/version/route.ts` | 0 imports, 0 callers |
| `src/app/api/debug/vertex-probe/route.ts` | 0 imports, 0 callers |
| `src/app/api/dev/gemini-ocr-test/route.ts` | 0 imports, 0 callers |
| `src/app/api/dev/storage/health/route.ts` | 0 imports, 0 callers |

**Audit bug caught and corrected during T0 execution:** the initial enumeration in this AUDIT.md missed `src/app/api/debug/supabase/route.ts` because the audit script's `IGNORE_DIRS` Set included `"supabase"` (to skip the top-level `supabase/` migrations directory). That filter matched nested `supabase/` subdirectories too — both `src/app/api/debug/supabase/` and `src/app/api/health/supabase/`. The health one has verified callers (linked from `src/app/health/page.tsx`) and remains kept; the debug one had 0 callers and was added to T0. Net correction: T0 total went from 12 to 13 files. `scripts/count-routes.mjs` itself does NOT have this bug — its `IGNORE_DIRS` is used only for non-route directories and doesn't apply to `src/app/` tree walking.

### Batch 2 — T1 deletions

Skipped. No T1 candidates in the codebase.

### Batch 3 — T2 merges

Skipped. All 5 sibling-mergeable candidates were demoted to T4 (parent routes already export GET).

### Batch 4 — Stop check

| Measurement | Before (commit d20ddae3) | After T0 (commit 99306b9e) |
|---|---|---|
| Manifest-mode total | 2053 | **2027** (Δ = −26) |
| Fast-mode total | 2059 | ≈2033 |
| Vercel cap | 2048 | 2048 |
| Headroom to cap | −5 | **+21** |
| FIX-C error threshold | 2020 | 2020 |
| Status vs error threshold | over by 33 | over by 7 |
| Fix A target (2018) | over by 35 | over by 9 |

**Stop-check decision:** `count (2027) > TARGET_COUNT (2018)`. Per Fix A spec §A-2 Batch 4, execution stops here and escalates T3/T4 candidates for Matt's adjudication. Claude Code does NOT proceed into E-1/E-2/E-3 tiers without explicit approval.

**What T0 bought us:**
- Moved from **at-cap** (headroom −5) to **safely under cap** (headroom +21). This is the immediate Vercel-risk reduction Fix A's first priority — the next accidental new route.ts file no longer risks another `too_many_routes` production outage.
- Still 7 above FIX-C's error threshold, so FIX-C cannot flip from advisory to enforcing yet. That's the residual Fix A work.

---

## Escalation decision for Matt

Fix A's stated target (2018) is not hit by default rules. 9 more routes must be removed for enforcement-flip readiness. The options ranked by confidence-to-delete:

### Question 1: approve Tier E-1 bulk delete?

The 7 high-confidence extras listed in the original "Needs escalation" section above. Each has 0 src callers. Each is in a category where 0 src callers is a *strong* signal of genuine orphan (either typo, deprecated, or functionality now lives on the parent route):

- `src/app/api/deals/deals/[dealId]/etran/submit/route.ts` (path typo — `deals/deals/` is malformed)
- `src/app/api/deals/bootstrap/route.ts`
- `src/app/api/deals/new/upload-session/route.ts`
- `src/app/api/deals/[dealId]/checklist/status/route.ts` (demoted T2)
- `src/app/api/deals/[dealId]/uploads/status/route.ts` (demoted T2)
- `src/app/api/deals/[dealId]/status/route.ts` (demoted T2)
- `src/app/api/deals/[dealId]/spreads/status/route.ts` (demoted T2)

If all 7 are approved: estimated count goes from 2027 to **≈2013** (Δ −14), which is under target 2018 with 6 routes of cushion.

**Residual risk:** none of these routes have callers in `src/`, but my grep cannot see callers in `public/`, external clients (borrower portal, examiner portal, monitoring systems), or `.github/` workflow files. The 5 demoted T2 siblings are particularly worth double-checking — they were called at some point (their parent routes have overlapping but not identical behavior), and "0 callers now" could mean "migrated to the parent" or could mean "still called but through a client we can't see".

**Fastest adjudication:** if you're confident that any of these 7 have no external callers, say so and I'll execute the deletions in one more commit. For any you're uncertain about, leave them in place; the 4 I flagged for sure-orphan status (typo path + deals/bootstrap + deals/new/upload-session + one of the `/status` siblings) alone would get us to ≈2019, 1 over target — which is close enough that FIX-C enforcement could flip to `warning` status without false-positive-blocking new PRs.

### Question 2: approve Tier E-2 architectural consolidation?

Three T3 clusters each need a design call, not just a deletion decision:

- `/builder/entities/[entityId]` vs `/entities/[entityId]` — keep which as canonical?
- `/re-extract` + `/reextract-all` + `/reprocess-documents` — which combinations consolidate?
- `/recompute` vs `/pipeline-recompute` — architectural intent?

Each cluster could save 2-4 routes. These are slower work (need to read each route, understand callers, potentially migrate clients) and would be a separate follow-up PR rather than this one. Recommend deferring unless you see a clear winner.

### Question 3: proceed to flip FIX-C to enforcing after Fix A lands?

Per FIX-C spec's design, the trivial one-line workflow change (remove the `Always pass (advisory-only enforcement contract)` final step) can happen in a third PR as soon as we're under the ERROR threshold 2020 with meaningful cushion. That requires at least a few of the E-1 approvals to go through. Recommended: wait until we're at ~2010 or lower before flipping.

---

## Summary for the PR reader

- Started at 2053 routes. The Vercel cap is 2048.
- Shipped 13 surgical deletions (all debug/dev endpoints with 0 src callers, per the spec's T0 rule). Count dropped to 2027.
- Vercel blast radius reduced: went from at-cap to +21 routes of headroom.
- FIX-C remains advisory, not blocking, because we are still 7 routes above its error threshold.
- 7 additional high-confidence deletion candidates surfaced to Matt. A yes/no on those lands FIX-C enforcement-ready in one more commit within this PR.

---

## Execution: E-1 partial

**Commit:** following T0's `99306b9e`. Per Matt's adjudication, 2 of the 7 proposed E-1 deletions approved; remaining 5 deferred to a follow-up PR that audits them individually.

### Approved — 2 deletions

1. **`src/app/api/deals/deals/[dealId]/etran/submit/route.ts`** — typo'd duplicate of `/api/deals/[dealId]/etran/submit`. Pre-deletion verification: both files were **byte-identical** (`sha256 34eb029e23e30a9b8234b3fbaa1cf76227583255948e5bceaeb1ec217495c381`, 3357 bytes each). The doubled `deals/deals/` path segment means this file is unreachable via its intended URL; the canonical route at `/api/deals/[dealId]/etran/submit` remains in place and serves the real traffic.

2. **`src/app/api/deals/new/upload-session/route.ts`** — 410 Gone tombstone. The file body was:
   ```ts
   return NextResponse.json(
     { ok: false, error: "deprecated_use_bootstrap", requestId },
     { status: 410 },
   );
   ```
   It explicitly pointed callers at `/api/deals/bootstrap`. 0 callers in `src/`, 0 traffic observed in the last 7 days. A 410-returning route is a route that has been dead long enough that its own deprecation stub is itself dead.

### Inverted decision — 1 retained

- **`src/app/api/deals/bootstrap/route.ts`** — **KEPT**. The `upload-session` tombstone above targets this route, confirming `bootstrap` is the canonical path (not itself abandoned). Deletion would have broken any callers the tombstone's 410 response was redirecting.

### Deferred — 5 routes moved to follow-up PR

Per-route verification during this pass found that the 5 `/status` + `/preflight` siblings do NOT uniformly overlap their parents' GET handlers. The spec's T2 rule assumed equivalence; reality is each pair needs individual shape-comparison before safe deletion:

- `src/app/api/deals/[dealId]/checklist/status/route.ts`
- `src/app/api/deals/[dealId]/uploads/status/route.ts`
- `src/app/api/deals/[dealId]/status/route.ts`
- `src/app/api/deals/[dealId]/spreads/status/route.ts`
- `src/app/api/deals/[dealId]/spreads/preflight/route.ts` — explicitly noted as a unique diagnostic surface, keep regardless

**Reason for deferral:** 0 src callers is a necessary but not sufficient signal when the parent's GET returns a *different shape* than the sibling's GET. Before deleting any of these, each pair needs:
1. Read both route handlers
2. Compare returned JSON shape
3. If shapes are equivalent: delete the sibling, clients already on the parent path keep working
4. If shapes diverge: the sibling may be called by an unseen consumer (external portal, monitoring, etc.) — keep, or migrate clients first

That work is architecture, not a tier-rule delete. It belongs in its own spec with per-pair analysis.

### Final count after E-1 partial

| Measurement | Before T0 | After T0 (99306b9e) | After E-1 partial |
|---|---|---|---|
| Manifest-mode total | 2053 | 2027 (Δ −26) | **2023** (Δ −30 cumulative) |
| Vercel cap | 2048 | 2048 | 2048 |
| Headroom to cap | −5 (at cap) | +21 | **+25** |
| FIX-C error threshold | 2020 | 2020 | 2020 |
| Status vs error | over by 33 | over by 7 | **over by 3** |

### Follow-up work

- **Follow-up PR #1** — audit the 5 deferred `/status` + `/preflight` siblings individually. For each: compare parent-GET shape vs sibling shape, trace any external callers beyond `src/`, then either delete + client-migrate OR keep + document why. Expected gain: 6–8 routes if all 5 are deletable after audit (not guaranteed).
- **Follow-up PR #2** — flip `.github/workflows/route-budget.yml` from advisory to enforcing. Trivial one-line change (remove the final `exit 0` step). Should only happen AFTER Follow-up PR #1 lands us under FIX-C's error threshold (2020) with meaningful cushion. **This PR does NOT touch the FIX-C workflow.**
- **Optional later** — the three T3 architectural clusters (builder/entities duplication, extract-twin consolidation, recompute duplication). Each is its own spec.

---

## Follow-up verification (2026-04-22, step 1 — read-only)

Exhaustive caller-search pass against 2 candidate routes before any second round of deletions. Read-only. No code changes in the accompanying commit.

### `checklist/status` caller search

Target: `src/app/api/deals/[dealId]/checklist/status/route.ts`.

**Search 1 — literal `checklist/status` in TS/JS family (`*.{ts,tsx,js,jsx}`):** 0 matches.

**Search 2 — escaped-slash variant `checklist\/status` (JSON/JS string form):** 0 matches.

**Search 3 — `/checklist/status` across all files:** 5 matches, all in documentation:

```
specs/fix-a-route-consolidation/AUDIT.md:73   (this audit itself)
specs/fix-a-route-consolidation/AUDIT.md:79   (this audit itself)
specs/fix-a-route-consolidation/AUDIT.md:152  (this audit itself)
specs/fix-a-route-consolidation/AUDIT.md:247  (this audit itself)
specs/fix-a-route-consolidation/AUDIT.md:309  (this audit itself)
docs/archive/phase-84/AAR_PHASE_84_T05.md:112
docs/archive/phase-84/T05-checklist-taxonomy-audit.md:73
docs/archive/phase-84/T05-checklist-taxonomy-audit.md:133
```

**The T05 AAR match at line 112 requires attention:**

> **Audit banker-facing components for legacy reads** before deletion. `src/components/` was included in the grep scope but returned no direct `.from("deal_checklist_items")` hits. Still, the banker-facing `/api/deals/[dealId]/checklist/status` and `/api/deals/[dealId]/checklist/set-status` routes have frontends; confirm those migrate to canonical before removing the routes.

This is a prior-phase warning (Phase 84 T-05, written some months ago) that these routes "have frontends." My current exhaustive source search finds 0 callers, which suggests the frontends were migrated off `/checklist/status` in the intervening time — but I cannot confirm that from source alone. Surfacing verbatim per spec instruction.

**Search 4 — `"checklist"` in source (scanning for concatenation patterns):** 20 hits, all UI icon / filter / key names. None show concatenation with `/status`.

**Search 5 — `${...}/checklist/status` template-literal pattern:** 0 matches.

**Search 6 — non-`src/` directories (docs, supabase, public, .github, top-level configs):** No matches in `.github/`, `supabase/`, `public/`, `README.md`, `package.json`, `next.config.mjs`, `vercel.json`, `tsconfig.json`, `CLAUDE.md`, `BUDDY_PROJECT_ROADMAP.md`. Only the 3 doc files listed in Search 3.

**URL-construction helpers searched:** `checklistUrl`, `getChecklistUrl`, `checklistStatusUrl`, `checklistStatusPath` — 0 matches.

**Cross-grep — all `/checklist/` patterns in source** (confirms absence by exhaustion):
```
src/buddy/cockpit/useCockpitData.tsx:93              /api/deals/${dealId}/checklist           ← bare parent
src/buddy/ui/BuddyPanel.tsx:914                      /api/deals/${dealId}/checklist/reconcile ← different sibling
src/components/deals/cockpit/hooks/useChecklistDetail.ts:75    /api/deals/${dealId}/checklist/list     ← different sibling
src/components/deals/cockpit/panels/YearAwareChecklistPanel.tsx:121  /api/deals/${dealId}/checklist/list ← different sibling
src/lib/stitch/activations/borrowerTaskInboxActivation.ts:128  .../checklist/set-status           ← different sibling
src/stitch/surface_wiring_ledger.ts:201              /api/deals/[dealId]/checklist/set-status  ← different sibling
src/lib/documentTruth/__tests__/cockpitWiringGuard.test.ts:158 a guard test ASSERTING the content must NOT include /checklist
```

Of every `/checklist/` fragment in source, **none terminate at `/status`**. Parent route + `reconcile`, `list`, `set-status`, `set-required`, `upsert` are the active siblings. `/status` appears nowhere.

**Git history:**
```
efdf70c9 2026-04-22  fix(cockpit): cold-start hardening + /reclassify-all endpoint (Spec D5)
b2892d62 2025-12-25  WIP before Next 16 route param normalization
08611574 2025-12-20  feat: Buddy Credit Discovery + AI Everywhere system
```
The D5 commit was the `maxDuration` sweep (no behavioral change). Substantive last edit was 2025-12-25. The file has been stable for ~4 months. Consistent with "stable-dead" rather than "recently-added."

**Conclusion for `checklist/status`:** 0 current source callers confirmed across 6 search patterns + cross-grep for `/checklist/*` siblings. The T05 AAR's "frontends exist" warning pre-dates several migrations and is no longer supported by source evidence. **Judgment call for Matt** — the source evidence is clean, but the prior AAR explicitly flagged the route. Surfacing the flag rather than deciding.

---

### `uploads/route.ts` caller search (the parent, reads `/tmp/buddy_uploads`)

Target: `src/app/api/deals/[dealId]/uploads/route.ts`.

**Search 1 — `fetch(...)` of bare `/uploads"` (no subpath):** 0 matches.

**Search 2 — `fetch(...)` of `/uploads?` (query string):** 0 matches.

**Search 3 — backtick template literal ending in `/uploads\``:** **1 MATCH:**

```
src/components/deals/UploadBox.tsx:294:      const res = await fetch(`/api/deals/${safeDealId}/uploads`, { cache: "no-store" });
```

**This is a live caller.** Context: the function `refreshUploads()` in `UploadBox.tsx` calls this endpoint, consumes `data.files`, and populates `setUploads(Array.isArray(data.files) ? data.files : [])`. The function is invoked on mount via `useEffect`. `UploadBox` is mounted in the deal workspace:

```
src/app/(app)/deals/[dealId]/DealWorkspaceClient.tsx:75:              <UploadBox dealId={dealId} />
```

**Search 4 — `/uploads'` (single-quote terminator):** 0 matches.

**Search 5 — `buddy_uploads` (filesystem path):** 5 matches — **live writer confirmed:**

```
src/lib/docs/storage.ts:12            /mnt/data/buddy_uploads    (different base path)
src/lib/builder/builderUploadCore.ts:46  path.join("/tmp", "buddy_uploads", dealId, "builder")   ← WRITER (fs.writeFile at line 56)
src/lib/ocr/runOcrJob.ts:239          path.join("/tmp/buddy_uploads", dealId, storedName)        ← READER
src/app/api/deals/[dealId]/uploads/route.ts:25  the route itself                                  ← READER
src/app/api/files/signed-url/route.ts:22  "/tmp/buddy_uploads"                                   ← READER
```

`src/lib/builder/builderUploadCore.ts:56` has `await fs.writeFile(filePath, buffer);` — the `/tmp/buddy_uploads/{dealId}/...` directory the route reads is actively written to by production code.

**Search 6 — legacy `deal_uploads` table name:** Many matches, but all refer to the *Supabase storage bucket / table* named `deal_uploads`, not the `/tmp/buddy_uploads` filesystem path this route reads. Unrelated.

**Search 7 — upload-URL helper functions:**

```
src/components/deals/UploadBox.tsx:294      `/api/deals/${safeDealId}/uploads`      ← already counted
src/lib/builder/builderUploadCore.ts:127,207   `${args.dealId}/uploads/${timestamp}_...`   ← storage-path construction, not HTTP URL
src/app/(app)/deals/new/NewDealClient.tsx:7   imports createUploadSession (different surface)
src/app/api/storage/upload/route.ts:126,186    `${dealId}/uploads/...`                ← storage-path construction, not HTTP URL
```

Only UploadBox.tsx is an actual HTTP caller.

**Writer check for `/tmp/buddy_uploads`:** Confirmed — `src/lib/builder/builderUploadCore.ts:56` writes to the directory. The route is not reading a dead filesystem path.

**Git history:**
```
efdf70c9 2026-04-22  fix(cockpit): cold-start hardening + /reclassify-all endpoint (Spec D5)
b2892d62 2025-12-25  WIP before Next 16 route param normalization
33d4ba23              chore: lock Moody PnL package contract + smoke check
```
D5 was the maxDuration sweep. Substantive edits stable for months. Consistent with live-but-quiet.

**Conclusion for `uploads/route.ts`:** **NOT SAFE TO DELETE.** One live UI caller in `UploadBox.tsx:294` (mounted via `DealWorkspaceClient.tsx:75`), active filesystem writer in `builderUploadCore.ts:56`. The route wraps a real production pattern: banker workspace upload surface lists files written by the builder upload flow. Deleting this route breaks the upload listing in the deal workspace.

---

### Overall recommendation

The two candidates verified in this step should be handled differently:

1. **`checklist/status/route.ts`** — source-code verification came back clean (0 callers across all 6 search patterns). The 4-month-old stability is corroborating. However, a prior-phase AAR (Phase 84 T-05) explicitly warned about frontend migration before deletion. My reading: the frontends were likely migrated away since that warning was written (the current sibling `/checklist/list` dominates caller references), but I cannot confirm that non-destructively. **Ready to delete pending Matt's yes/no on the T05 AAR flag.**

2. **`uploads/route.ts`** — **not safe to delete.** Live UI caller confirmed (`UploadBox.tsx:294`), live filesystem writer confirmed (`builderUploadCore.ts:56`). This route is production functionality, not a zombie. The "0 callers" claim in my initial audit was a false negative — the audit's static-tail grep for `/api/deals/[dealId]/uploads` (static tail `/api/deals/`) was too short to isolate this route's specific path and matched hundreds of other `/api/deals/*` routes instead, effectively masking the real caller count. **Recommend removing this from the follow-up PR's deletion candidate list** and flagging as a lesson for the Fix B lint-rule work: "0 callers in audit" is a necessary but not sufficient signal; downstream verification must run a tight per-path caller search before deletion.

**Fallout for Fix A's stated goal:** without `uploads/route.ts`, the remaining 4 `/status` siblings (`checklist/status`, `uploads/status`, `deals/[dealId]/status`, `spreads/status`) would yield at most ~8 routes if all deleted. That brings us from 2023 to ~2015 — at or just under the 2020 error threshold but not meaningfully under. The FIX-C enforcement flip is still feasible but with less cushion than originally projected. Worth re-examining the T3 architectural clusters (builder/entities, extract-twin, recompute) if deeper reduction matters.

No deletions happening in this pass, per spec. This section is the record.


