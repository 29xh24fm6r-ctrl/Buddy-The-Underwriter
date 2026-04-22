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

(This section will be filled in by the A-2 commits after each batch runs.)

### Batch 1 — T0 deletions

*Filled in post-execution.*

### Batch 2 — T1 deletions

*Skipped — no T1 candidates.*

### Batch 3 — T2 merges

*Skipped — all 5 candidates demoted to T4.*

### Batch 4 — Stop check

*Filled in post-execution.*
