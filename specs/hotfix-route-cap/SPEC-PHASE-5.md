# SPEC HOTFIX-ROUTE-CAP — Phase 5 v4 (Project Routes Smoke Test First)

**Date:** 2026-04-27 · **Owner:** Architecture (Matt) · **Executor:** Claude Code
**Status:** ready · **Type:** P0 hotfix structural pivot

## Why a Phase 5

Phase 4 page-only deletion projected delivery is ~2 entries (Phase 2's empirical 16% page-only rate). Will not clear cap. Production red 49+ hours, time pressure favors structural pivot.

Vercel "Project-Level Routes" (March 2026 feature) is the proposed structural answer. **However:** Vercel docs confirm the feature exists and runs before deployment routes, but **do NOT explicitly state** that project routes are independent of the 2048 deployment manifest cap. The docs' enumerated escape hatches for the 2048 cap are Edge Middleware, Edge Config, bulk redirects, and Serverless Functions — **not** project routes.

Our Phase 5 strategy load-bears on an assumption we cannot verify from documentation. **The smoke test below converts that assumption into an empirical answer.**

## Decision (Matt, 2026-04-27)

> "skip phase 4, go to project routes"

Smoke test gates full migration. If smoke test refutes manifest-independence, pivot to Edge Middleware (documented escape hatch).

## Step 0 — Feature availability check (~2 min)

1. **Project Routes UI exists in Vercel dashboard.** Open `https://vercel.com/mpalas-projects-a4dbbece/buddy-the-underwriter/settings` — look for "Project Routes," "Routing," or "CDN" tab with route configuration. **Load-bearing gate.** If absent, surface — pivot to Edge Middleware.

2. **(Optional, soft check) `vercel routes` CLI subcommand.** Run `npx vercel --help`. If `routes` appears, can use CLI alongside dashboard. **CLI absence is NOT a blocker** — dashboard is sufficient.

If dashboard check passes, proceed to Step 1.

## Step 1 — Smoke test (synthetic header, single-path source)

**Procedure:**

1. From `main`, create branch `phase-5-projroutes-smoketest` with one trivial commit (e.g., adding a comment to `README.md`) so Vercel triggers a deploy on push.

2. Add ONE synthetic header rule via Vercel Project Routes (dashboard preferred, CLI if available):
   - Source: `/api/health` (single leaf path; no overlap with existing `next.config.mjs` rules — removes merge/override ambiguity)
   - Header: `X-Buddy-SmokeTest-Phase5: 1` (header name doesn't exist anywhere else — no de-dup confound)

3. Push the branch. Wait for deploy (will fail — branch adds nothing that reduces cap; ERROR state expected and load-bearing for the manifest measurement).

4. Read `received` from inspector after deploy ERROR.

**Decision rules (build-noise tolerant; baseline is Phase 3 `received`: 2056):**

- `received` 2055–2057 (within ±1 of baseline): **Inconclusive on isolated manifest cost.** Combined with Step 5 curl verification, treat as "manifest-independent enough" → proceed to Step 2 with calibration uncertainty documented in AAR.
- `received` ≥ 2058 (≥ +2 from baseline): **Clear evidence project route counted.** Stop, pivot to Edge Middleware.
- `received` ≤ 2054 (≥ −2 from baseline): Unexpected drop. Re-deploy the same branch once to control for noise. If second reading also ≤ 2054, surface — something else changed.
- Deploy succeeds (READY) at `received` ≤ 2048: would mean cap accidentally cleared on a synthetic-add. Surface and investigate.
- Different `errorCode`: new failure surface introduced. Surface and stop.

5. **Verify the synthetic header actually applies in production response paths.**

   The smoketest URL itself is in ERROR state and serves Vercel's generic error shell from a different internal origin (`instant-preview-site.vercel.app`) which short-circuits before project routes apply. Querying the smoketest URL would produce false-negative.

   Instead, query a READY deploy alias for the same project — Project Routes apply at the project level, so the synthetic rule should appear on responses from any READY alias of any deployment in this project:

   ```bash
   curl -I https://buddy-the-underwriter-git-main-mpalas-projects-a4dbbece.vercel.app/api/health
   ```

   Expect `X-Buddy-SmokeTest-Phase5: 1` in the response. (Choose any alias of a recent READY deploy from main; `git-main-...` is the most stable.)

   If header absent, project routes aren't applying responses correctly even if manifest-independent — feature wouldn't serve our purpose. Surface.

6. **Cleanup:** delete the synthetic header from Project Routes via dashboard (or `vercel routes delete` if CLI worked). Delete the smoketest branch. **Do not leave the synthetic header in place.**

## Linearity-assumption note

Step 1 tests one rule. Step 2 will move three rules. The smoke test cannot prove linear cost — if project routes have nonlinear cost, the smoke test reads "free" but Step 2 might cost +3 or more.

This is acknowledged uncertainty. Step 2's pre-merge curl + manifest re-read on a preview URL is the second proof gate before merge to main. AAR for Step 1 should explicitly note: "linearity unverified; Step 2 inspector read is second proof."

## Step 2 — Full migration (held until Step 1 confirms)

Drafted only after Step 1 surfaces a clean confirmation. Briefly: move all 3 `headers()` rules from `next.config.mjs` to Project Routes, delete the `headers()` function from `next.config.mjs`, deploy on a real hotfix branch. Pre-merge curl verification of all security headers on a preview URL before merging to main.

## Step 3 — Production smoke (held with Step 2)

Includes `curl -I` verification of all expected headers on `/`, `/sign-in`, `/api/health`, `/credit-memo/<any-id>`, `/deals/<any-id>`. Microphone-permission header on `/credit-memo/*` and `/deals/*` is highest-risk (Gemini Live banker interviews depend on it).

## What NOT to touch in Step 1

- `next.config.mjs` — leave existing 3 `headers()` rules in place during smoke test
- PR #353 — stays open and unmerged
- Any production-bearing code

## AAR requirements (Step 1 only)

1. Step 0 result: dashboard surface available? CLI command available (optional)?
2. Smoke test branch + commit SHA
3. Synthetic header configured in Project Routes (screenshot or CLI list output)
4. Deploy result + `received` count from inspector
5. Build-noise re-test result if Step 1 reading was ≤ 2054 or ambiguous
6. `curl -I` output from READY deploy alias (NOT the smoketest URL)
7. Linearity-assumption note — explicit acknowledgment in AAR
8. Cleanup confirmation: synthetic header deleted, branch deleted
9. Decision: proceed to Step 2 (full migration) or pivot to Edge Middleware

## Out of scope

- Step 2 and Step 3 — drafted only after Step 1 confirms feasibility
- Edge Middleware migration — drafted only if Step 1 refutes Project Routes
- Phase 4 v3 page hygiene — deferred to next session if Phase 5 succeeds

## Done condition (Step 1 specifically)

Smoke test returns a definitive answer on whether Project Routes counts toward the 2048 manifest cap (modulo linearity uncertainty). AAR back with answer.
