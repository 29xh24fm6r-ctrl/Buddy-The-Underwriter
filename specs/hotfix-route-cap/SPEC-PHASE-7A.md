# SPEC HOTFIX-ROUTE-CAP — Phase 7a v3 (Non-Destructive Multi Zones Spike)

**Date:** 2026-04-28 · **Owner:** Architecture (Matt) · **Executor:** Claude Code
**Status:** ready · **Type:** P0 incident — proof spike · **Target:** prove cap-relief mechanism on preview only

## Standing rule

> Buddy is one product. We are solving Vercel cap pressure, not fragmenting the LOS.

Phase 7a is mechanical proof, not architectural change. Nothing committed to main. Nothing on production. Repo structure unchanged. Domains unchanged. Existing project unchanged.

## Goals (strict sequence — each gates the next)

1. **Mechanical:** A small standalone host project on Vercel can `rewrites` into a known-READY buddy-the-underwriter deployment.
2. **Auth:** Clerk session crosses the rewrite boundary cleanly. **Hard proof gate. No documented-only fallback.**
3. **Headers:** Project Routes apply correctly to responses on both projects.
4. **Allocation:** Complete route inventory with kept-on-host vs kept-on-os disposition.

If gate 1 fails, gates 2-4 don't run. Each gate is an explicit AAR surface point with go/no-go.

## Non-goals

- No monorepo conversion
- No moving `src/` into `apps/buddy-os/`
- No Turborepo
- No domain reassignment
- No production cutover
- No buddy-the-underwriter project changes
- No commit to main
- No PR #353 changes

## Step 0 — Identify a known-READY buddy-os deployment URL (DO FIRST)

The latest deployment of buddy-the-underwriter is ERROR. Branch aliases (`*-git-main-...vercel.app`) and the canonical alias (`buddy-the-underwriter-mpalas-projects-a4dbbece.vercel.app`) have moved to the most recent ERROR deploy and **will not serve as a target** — they hang or return Vercel's error shell. Cannot use either.

Before any other spike work:

1. Find the most recent READY deployment of buddy-the-underwriter and use its **deployment-specific URL** (the unique `buddy-the-underwriter-<hash>-mpalas-projects-a4dbbece.vercel.app` URL, NOT a branch alias):
   ```bash
   npx vercel ls buddy-the-underwriter --scope mpalas-projects-a4dbbece
   ```
   Look for Ready status. **Walk backward through deployment-specific URLs until a true READY/200 baseline is found, or surface that none is available.** Do not assume any specific deployment ID is usable without verifying.

2. Verify the chosen deployment's **deployment-specific URL** still serves traffic:
   ```bash
   READY_URL="<deployment-specific URL, NOT branch alias>"
   curl -I $READY_URL/api/health
   ```
   Expect 200 OK with reasonable headers. If the deployment has been garbage-collected or returns error shell, pick the next-most-recent READY deploy.

3. Lock the chosen URL as `BUDDY_OS_URL` for all subsequent steps. Surface in AAR with: deployment ID, URL, last-deploy-date, and confirmation that `/api/health` responds 200.

If no usable READY deployment can be found within reasonable history, **stop and surface.** The spike cannot proceed without a working target.

## Step 1 — Route allocation table (do BEFORE building host)

Generate complete inventory of every route in buddy-the-underwriter from **current-state Phase 6c (commit `e4ba31cc`)** build log — NOT historical pre-Phase-1 inventory. Routes deleted across Phases 1-6c are gone and not in scope.

For each route, decide host vs os per allocation rules below.

### Allocation rules (locked per Matt's decisions)

| Route category | Disposition | Rationale |
|---|---|---|
| `/` | host | Public landing |
| `/(marketing)/for-banks`, `/(marketing)/pricing` | host | Marketing |
| `/start(.*)` | host | Borrower SBA onboarding concierge — public, anonymous |
| `/sign-in(.*)`, `/sign-up(.*)` | host | Clerk auth UI — public entry |
| `/upload(.*)` | host | Public upload (per `proxy.ts` public matcher) |
| `/portal/owner/(.*)`, `/portal/share/(.*)` | host | Token-gated public portals |
| `/generate`, `/s/[id]`, `/upgrade` | host | AI screen generator — public, borrower-facing |
| `/api/health(.*)` | host | Public health endpoint |
| `/(borrower)/borrower/portal(/*)` | host | Borrower magic-link portal |
| **`/(app)/borrower/portal/[token]`** | **os** | **Per Matt 2026-04-28: stays on os for spike** — reduces host's dependency surface |
| `/deals/*`, `/api/deals/*` | os | Deal lifecycle, gated |
| `/banker/*`, `/api/banker/*` | os | Banker workspace |
| `/(admin)/*`, `/admin/*`, `/api/admin/*` | os | Admin surface |
| `/(app)/*` (everything except borrower portal) | os | Banker app shell |
| `/(examiner)/*`, `/examiner-portal/*`, `/api/examiner/*` | os | Examiner surface |
| `/credit-memo/*` | os | Credit memos, gated |
| `/underwrite(.*)`, `/underwriting/*` | os | Underwriting workspace |
| `/ops/*`, `/workout/*`, `/portfolio`, `/exceptions`, `/recovery`, `/reo`, `/servicing` | os | Internal ops |
| `/banks/*`, `/borrowers/*`, `/lender/*`, `/intake`, `/settings`, `/profile`, `/output`, `/evidence`, `/templates/*`, `/tenant/*`, `/documents`, `/credit/*`, `/committee`, `/compliance/*`, `/ocr*` | os | All authenticated product surfaces |
| `/stitch/*`, `/stitch-login`, `/stitch-share/*` | os | Stitch surfaces |
| `/api/*` (everything except `/api/health`) | os | All authenticated API |
| `/_builder/*` Pages Router routes | os | Internal builder tooling |
| Cron `/api/cron/*`, `/api/jobs/worker/tick`, `/api/workers/*` | os | Cron endpoints stay with buddy-os |

### Estimated route counts

| Project | Logical routes (estimate) | Manifest cost (estimate) | Cap headroom |
|---|---|---|---|
| host | 12-18 | 30-50 entries | ~2000 entries free |
| os | 950-955 | 2030-2040 entries | ~5-15 entries free |

**Critical observation (surfaced upfront, repeated in Step 5 recommendation):** os post-split still close to cap. Real growth budget is ~5-15 entries. **This is a temporary fix.** Long-term buddy-os still needs route discipline.

## Step 2 — Host project skeleton (preview only)

Create brand-new minimal Next.js 16 app in separate location.

**Default: throwaway repo `buddy-spike-host`** in same GitHub org, OR a local-only directory deployed via `vercel deploy` without GitHub integration if repo creation isn't available to executor. Cleanest isolation either way.

### Host content (minimum for spike)

- `src/app/page.tsx` — single landing page, "Buddy Spike Host"
- `src/app/spike/marketing/page.tsx` — verifies host serves locally
- `src/app/spike/auth/page.tsx` — calls Clerk's `useUser()` and displays session JSON
- `next.config.mjs` with single rewrite: `/spike/proxied/:path*` → `${BUDDY_OS_URL}/api/health`
- Clerk middleware configured with same publishable key as buddy-the-underwriter
- `package.json` with minimal Next.js + Clerk deps

### What buddy-spike-host does NOT contain

- No production data
- No Supabase, Gemini, or other secrets unrelated to Clerk
- No actual marketing copy (placeholder only)
- No domain assignment

## Step 3 — Vercel project setup

1. Push `buddy-spike-host` to throwaway repo (or `vercel deploy` from local directory if no GitHub repo)
2. Create Vercel project `buddy-spike-host` in `mpalas-projects-a4dbbece` team
3. Set env vars on `buddy-spike-host`:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — same as buddy-the-underwriter
   - `CLERK_SECRET_KEY` — same
   - `CLERK_JWT_KEY` — same
   - `BUDDY_OS_URL=<deployment-specific URL from Step 0>`
4. Configure Project Routes on buddy-spike-host (3 header rules: no-cache HTML, security, microphone-allow)
5. Trigger first deploy. Verify READY before any gate testing.

## Step 4 — Smoke tests (each gate blocks the next)

**Gate ordering:** Project Routes verification (former Gate 3) runs FIRST, before any rewrite testing. Isolates the "is the host project itself healthy" variable from the "do rewrites work" variable.

### Gate 1: Project Routes apply on host (PRIORITY 1, isolates host health)

```bash
HOST_URL="https://buddy-spike-host-<hash>.vercel.app"
curl -I $HOST_URL/
```

**Pass:** all 5 expected security headers + no-cache HTML applied to a fresh READY host's responses.
**Fail:** Project Routes config didn't apply. **STOP. Surface.** Phase 5 confirmed Project Routes are manifest-independent on buddy-the-underwriter; if they don't work on a fresh project, that's a different problem and the spike's premise needs revisiting.

### Gate 2: Host serves locally (verify rewrite scope before rewrites are tested)

```bash
curl -i $HOST_URL/
curl -i $HOST_URL/spike/marketing
```

**Pass:** both serve host's local pages. No accidental rewrite.
**Fail:** unexpected rewrite — beforeFiles regex matched too broadly. **STOP. Surface.**

### Gate 3: Mechanical rewrite (the load-bearing test)

```bash
curl -i $HOST_URL/spike/proxied/test
```

**Pass:** response is JSON from buddy-os `/api/health`. Status 200.

**Fail mode 1a:** 404 with destination URL containing literal `${BUDDY_OS_URL}` in error or response — env var not substituted at build time. Confirm `BUDDY_OS_URL` is set on host project's Vercel env config; redeploy. Distinguishes "env var unset" from "rewrite mechanism broken" so we don't conclude the wrong fork.

**Fail mode 1b:** 502 / 504 / timeout — rewrite mechanism hits buddy-os deployment but can't reach it. Verify `BUDDY_OS_URL` (Step 0 result) still serves traffic via standalone curl.

**Fail mode 1c:** 404 from buddy-os — `/api/health` route doesn't exist on the chosen READY deploy (stale snapshot before route was added). Pick a different READY deploy in Step 0 retrospectively.

**Any fail:** STOP. Surface. Gates 4+ do not run.

### Gate 4: Clerk session crosses rewrite boundary (HARD PROOF)

Per Matt 2026-04-28: hard proof gate. **No documented-only fallback. If empirical proof unavailable, stop and surface.**

The mechanism: same-domain cookies. For the spike to actually prove this, both `buddy-spike-host` and `buddy-the-underwriter` must be served under the same apex domain. Two acceptable approaches:

**Approach A (preferred): test apex via DNS Matt controls**

1. Pick a test apex Matt owns (subdomain of an owned domain, e.g. `spike.<some-domain>.com`)
2. Configure DNS so both projects serve under same apex via Vercel rewrites
3. Cookies share automatically; Clerk session crosses cleanly

**Approach B (fallback): Vercel-managed routing primitives**

If Vercel offers a mechanism where two projects in the same team share a generated apex for preview testing (verify in Vercel docs at execution time), use that.

**No Approach C.** If A and B both unavailable: **stop, surface, do not proceed to Phase 7b.** AAR returns "Gate 4 unverifiable empirically — Phase 7b cannot proceed without proof of Clerk cross-boundary auth." Matt makes the call from there (acquire test apex, accept risk and proceed manually, or pivot mechanism entirely).

**Test procedure (whichever approach):**

1. Open `<apex>/sign-in` — Clerk UI loads
2. Sign in with known buddy account
3. Navigate to `<apex>/spike/auth` — verify Clerk's `useUser()` returns signed-in user with valid session
4. Inspect browser cookies — Clerk session cookies present on the apex
5. Navigate to `<apex>/spike/proxied/test` — request rewrites to buddy-os `/api/health`
6. Inspect request headers received by buddy-os — Clerk session cookies present in rewritten request

**Pass:** Steps 1-6 all succeed. Session present at host AND in rewritten request to buddy-os.
**Fail:** session lost in transit, cookies not on apex, or any step fails. **STOP. Surface.** Multi Zones doesn't work for our auth model and Phase 7b can't proceed without rethinking.

### Gate 5: Cap arithmetic (informational, doesn't block)

After buddy-spike-host's first deploy, read its inspector `received` count. Expect ~30-50.

Pass: received well under 2048.
Fail: surprising — would invalidate Multi Zones approach. Surface.

## Step 5 — Recommendation report

After Steps 1-4 complete (or any failed gate), Claude Code surfaces AAR with:

1. Step 0 result: which deployment-specific READY URL was chosen as BUDDY_OS_URL (deployment ID + URL + last-deploy-date)
2. Step 1 allocation table — full route inventory with disposition (current-state Phase 6c)
3. Test results for each gate (1-5), with output
4. **Recommendation: is repo restructure necessary?**
   - **Yes (default):** if mechanical proof passes and route allocation is clean, monorepo conversion is right next step (Phase 7b)
   - **No (alternative):** if minimal split (small host project + existing buddy-the-underwriter as-is) suffices, document lighter alternative
   - **Pivot (if any gate fails):** recommend Edge Middleware / bulk redirects / different mechanism
5. Honest estimate of buddy-os post-split cap headroom (likely ~5-15 entries — tight). **Repeat the "this is temporary, route discipline still required" framing.**
6. Risk register update — what failure modes did spike surface?
7. Decision request for Phase 7b path

## Step 6 — Cleanup

After Phase 7a completes (regardless of outcome):

1. **Keep `buddy-spike-host` Vercel project initially.** Useful for re-testing as Phase 7b is scoped.
2. **7-day cleanup deadline:** if Phase 7b is not authorized within 7 days of Phase 7a AAR (i.e. by 2026-05-05), delete `buddy-spike-host` Vercel project and its associated repo. Don't accumulate dead infrastructure with stale Clerk credentials bound to throwaway URLs.
3. No changes to production. No changes to buddy-the-underwriter. No changes to main branch.

## AAR separation rule (per Matt 2026-04-28)

AAR must explicitly separate observed facts from assumptions. Each Step / Gate result tagged "OBSERVED:" (verified empirically) or "ASSUMED:" (inferred or extrapolated). No mixing.

## Rollback

Phase 7a has nothing to roll back — nothing touches production. Cleanup is deleting throwaway Vercel project (per 7-day deadline) if pivoting.

## Risks

### Risk 1: BUDDY_OS_URL deployment-specific URL unavailable

Step 0 might find no usable READY deployment-specific URL. **Mitigation:** Step 0 surfaces this before any spike work. Stop and surface if so.

### Risk 2: Gate 4 (Clerk cross-boundary) requires test apex

Approach A needs a domain Matt controls for DNS. **No Approach C escape valve in v3.** If A and B unavailable, **stop and surface** — Matt makes the call.

### Risk 3: Spike conflates failure modes

Mitigated by Gate 1 reordering (Project Routes first, isolates host health) + Fail Mode 1a addition (env var substitution).

### Risk 4: Clerk publishable-key reuse on different host

Using buddy-the-underwriter's Clerk keys on a different host may surface Clerk instance/origin checks. **Mitigation:** Gate 4 explicitly tests this. Failure is informative, not surprising.

## Done condition (Phase 7a specifically)

AAR back with:
- Step 0 BUDDY_OS_URL choice (deployment-specific URL with metadata)
- Step 1 allocation table (current-state Phase 6c, reviewed and approved by Matt)
- Step 2-4 results logged per gate, OBSERVED/ASSUMED tagged
- Step 5 recommendation
- Decision request for Phase 7b or alternative

No production change. No main change. No PR #353 change. No buddy-the-underwriter change. Spike artifacts contained to throwaway project with 7-day cleanup deadline.
