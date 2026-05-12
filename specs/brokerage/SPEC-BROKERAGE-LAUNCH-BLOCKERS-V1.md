# SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1

Status: READY FOR IMPLEMENTATION
Owner: Matt
Implementer: Claude Code / Mobile Claude Code
Branch: `feat/brokerage-launch-blockers-v1`

This is an implementation spec, not an architecture doc. An implementer
should be able to open each section, edit the named files, run the named
commands, and check the listed acceptance criteria.

---

## 1. Baseline

- **Pushed baseline**: `bd9e29b` on `feat/buddy-sba-brokerage-core`.
- **Excluded**: unpushed local commit `84b0ad0` (lint-only patch blocked
  by git proxy 403). Do NOT depend on it. Reapply equivalent lint
  cleanups inline if they affect a file you're already touching;
  otherwise leave the issues for the proxy-recovery patch.
- Branch this work from `bd9e29b`:

  ```bash
  git checkout -b feat/brokerage-launch-blockers-v1 bd9e29b
  ```

---

## 2. Launch objective

Safely run **10–15 synthetic borrower deals** end-to-end through:

  intake → upload → OCR → checklist → SBA score → trident preview →
  package seal

without manual DB surgery, log digging, or ops triage. Synthetic
borrowers must complete in preview against the real concierge model
and the real OCR pipeline.

This spec is the **final preflight before live borrowers**. Marketplace
mechanics are out of scope.

---

## 3. P0 blockers

Implement in order. Each blocker has its own subsection (§3.1–§3.7).

| # | Blocker | Section |
| --- | --- | --- |
| 1 | Duplicate draft deal prevention | §3.1 |
| 2 | Upload prepare hardening | §3.2 |
| 3 | `borrower_portal_links` expiry + single-use enforcement | §3.3 |
| 4 | `borrower_session_tokens` RLS mitigation | §3.4 |
| 5 | `rate_limit_counters` RLS mitigation | §3.5 |
| 6 | Stuck OCR/upload/job visibility | §3.6 |
| 7 | Synthetic borrower E2E script | §3.7 |

---

### 3.1 Duplicate draft deal prevention

**Risk**: two simultaneous cookie-less POSTs to the concierge see "no
session" and both INSERT a draft deal. Orphan deals accumulate under
the brokerage tenant.

**Approach**: single source of truth + Postgres advisory lock keyed
by cookie hash.

**Files to change**:
- `src/lib/brokerage/session.ts` — wrap `getOrCreateBorrowerSession` so
  the create path acquires `pg_advisory_xact_lock(hashtext(p_token_hash))`
  before checking for an existing row.
- `src/app/api/brokerage/concierge/route.ts:114-155` — delete the
  inlined create branch; call `getOrCreateBorrowerSession()` instead.
  This is the SECOND draft-deal-insert site in the codebase and the
  reason a duplicate is still possible today.

**Files to inspect (read-only)**:
- `src/lib/brokerage/sessionToken.ts` (createBorrowerSession internals).
- `src/lib/tenant/brokerage.ts` (tenant resolver).

**Supabase work**:
- New migration: `supabase/migrations/<ts>_brokerage_session_dedup.sql`.
  - RPC `claim_brokerage_session(p_bank_id uuid)` that:
    - Takes `pg_advisory_xact_lock(hashtext(p_bank_id::text || ':new'))`
      to serialize cookie-less new-session creates per tenant
      (cookie-bearing requests never reach this RPC).
    - Inserts the deal row.
    - Returns the new `deal_id`.
  - Partial unique index: at most one `origin='brokerage_anonymous'`
    deal per `(bank_id, session_token_hash)`:

    ```sql
    -- adds a denormalized session_token_hash column to deals for the
    -- partial unique, NULL outside brokerage funnel.
    ALTER TABLE public.deals
      ADD COLUMN IF NOT EXISTS brokerage_session_token_hash text;

    CREATE UNIQUE INDEX IF NOT EXISTS
      deals_brokerage_anon_one_per_token
      ON public.deals (bank_id, brokerage_session_token_hash)
      WHERE origin = 'brokerage_anonymous'
        AND brokerage_session_token_hash IS NOT NULL;
    ```
  - The new column is populated inside `createBorrowerSession` /
    `getOrCreateBorrowerSession` immediately after the deal insert.

**Acceptance**:
- Concurrent test (Node `Promise.all` of 5 cookie-less POSTs) → exactly
  one `deals` row.
- Cookie-bearing POST repeated → no new deal row.
- Reset-cookie test → new draft row (intended fallback), prior row
  untouched.

**Tests/commands**:

```bash
node --test --import tsx src/lib/brokerage/__tests__/getOrCreateBorrowerSession.test.ts
```

---

### 3.2 Upload prepare hardening

**Risk**: `/api/brokerage/upload/prepare` (today: cookie check + INSERT)
allows a borrower to mint unlimited `borrower_portal_links` rows on
double-click or replay, with no rate limit and no idempotency.

**Files to change**:
- `src/app/api/brokerage/upload/prepare/route.ts` — add three things in
  this order at the top of `POST`:
  1. `checkConciergeRateLimit({ tokenHash: session.tokenHash })`. On
     deny, return 429 with `retry-after`.
  2. Idempotency: query `borrower_portal_links` for any row matching
     `deal_id = session.deal_id`, `channel = 'brokerage_self_serve'`,
     `used_at IS NULL`, `expires_at > now()`, `revoked_at IS NULL`. If
     found, return that row instead of minting.
  3. On mint of a new row, in the same statement (or single
     transaction), set `revoked_at = now()` on any prior
     `brokerage_self_serve` row for the same deal.
- `src/lib/brokerage/rateLimits.ts` — add an `upload_prepare` tier:
  per cookie 3 / hour, 10 / day. IP limits inherited.

**Files to inspect**:
- `src/app/api/brokerage/concierge/route.ts` (existing rate-limit
  usage pattern for reference).

**Supabase work**:
- See §3.3 for the `revoked_at` column.
- Add `ai_events` rows: `scope = 'brokerage_upload'`, `action =
  'link_minted' | 'link_returned_idempotent' | 'rate_limited'`.

**Acceptance**:
- Repeat POST within the hour → same token.
- 4th POST in a rolling hour → 429.
- New mint → prior `brokerage_self_serve` link's `revoked_at` set.
- One `ai_events` row per outcome.

**Tests/commands**:

```bash
node --test --import tsx src/app/api/brokerage/upload/prepare/__tests__/route.test.ts
```

---

### 3.3 `borrower_portal_links` expiry + single-use enforcement

**Risk**: the link state machine is enforced in scattered call sites
(`/upload/[token]/page.tsx:43-45` sets `used_at`, but downstream
upload commits don't re-validate). A leaked URL can be partially
replayed.

**Approach**: a single SECURITY DEFINER RPC consumes / peeks the link;
all server code goes through it.

**Files to change**:
- `src/app/(borrower)/upload/[token]/page.tsx` — replace the inline
  SELECT + UPDATE block with a call to the new RPC
  `consume_borrower_portal_link(p_token)`. Render the existing error
  surfaces for `link_expired`, `link_consumed`, `link_revoked`.
- `src/app/api/portal/upload/commit/route.ts` — call
  `peek_borrower_portal_link(p_token)` (read-only variant) before
  accepting any file commit. Reject on terminal state.

**Files to inspect**:
- `src/app/api/portal/upload/prepare/route.ts` (banker-side upload
  pipeline — keep aligned).
- `src/app/api/portal/[token]/docs/route.ts`.

**Supabase work**:
- New migration: `supabase/migrations/<ts>_borrower_portal_link_state.sql`.
  - `ALTER TABLE public.borrower_portal_links ADD COLUMN IF NOT EXISTS
    revoked_at timestamptz;` (backfill NULL).
  - RPC `consume_borrower_portal_link(p_token text)`:
    - Locks the row (FOR UPDATE).
    - Asserts: `expires_at > now()`, `used_at IS NULL OR single_use =
      false`, `revoked_at IS NULL`. On fail, raise the matching error
      code: `link_expired | link_consumed | link_revoked |
      link_not_found`.
    - If `single_use AND used_at IS NULL`: `UPDATE used_at = now()`.
    - Returns `(deal_id, bank_id, label)`.
  - RPC `peek_borrower_portal_link(p_token text)` — same asserts, no
    write, returns the same shape.

**Acceptance**:
- Replay consumed link → 410 `link_consumed`.
- Replay expired link → 410 `link_expired`.
- Revoked link → 410 `link_revoked`.
- Existing rows pre-migration continue to validate (NULL `revoked_at`
  treated as not-revoked).

**Tests/commands**:

```bash
node --test --import tsx src/lib/portal/__tests__/portalLinkState.test.ts
psql $DATABASE_URL -f supabase/migrations/<ts>_borrower_portal_link_state.sql
```

---

### 3.4 `borrower_session_tokens` RLS mitigation

**Risk**: today `borrower_session_tokens` has RLS disabled in
production. Anyone holding the anon key can scrape the table. The
SHA-256-only-at-rest invariant limits the damage but doesn't replace
RLS.

**Approach**: enable RLS, add **no** SELECT/INSERT/UPDATE/DELETE
policies. Service role (admin client) is unaffected by RLS. Anon
access drops to zero. Co-locate an inverse migration.

**Files to change**:
- None in application code (review of `bd9e29b` already confirmed every
  call site uses `supabaseAdmin()`).

**Files to inspect**:
- `src/lib/brokerage/sessionToken.ts` — only via admin client.
- `src/app/api/cron/brokerage/cleanup-expired/route.ts` — admin client.

**Supabase work**:
- New migration:
  `supabase/migrations/<ts>_brokerage_rls_stage_a.sql`:

  ```sql
  ALTER TABLE public.borrower_session_tokens ENABLE ROW LEVEL SECURITY;
  ```
- Inverse migration co-located:
  `supabase/migrations/<ts>_brokerage_rls_stage_a_inverse.sql`. Not
  applied automatically.
- New CI guard: `scripts/guards/guard-brokerage-rls-tables.mjs`. Scans
  for any non-admin Supabase client touching the protected tables.
  Adds itself to `pnpm guard:all`.

**Acceptance**:
- `curl` with anon JWT against `…/rest/v1/borrower_session_tokens` →
  zero rows / 401.
- `/start` + concierge POST + upload prepare flow all green in
  preview after migration applied.
- CI guard fails on a hypothetical non-admin client added to the
  protected table.

**Tests/commands**:

```bash
node scripts/guards/guard-brokerage-rls-tables.mjs
```

---

### 3.5 `rate_limit_counters` RLS mitigation

Same shape as §3.4 for `rate_limit_counters`.

**Files to change**:
- None in application code (`src/lib/brokerage/rateLimits.ts` uses
  admin client).

**Supabase work**:
- Same migration file as §3.4 adds:

  ```sql
  ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
  ```
- Inverse migration includes the matching DISABLE.
- CI guard added in §3.4 also covers this table.

**Acceptance**:
- Anon `curl` → zero rows / 401.
- Existing rate-limit unit tests in
  `src/lib/brokerage/__tests__/rateLimits.test.ts` still pass.

**Tests/commands**:

```bash
node --test --import tsx src/lib/brokerage/__tests__/rateLimits.test.ts
```

---

### 3.6 Stuck OCR/upload/job visibility

**Risk**: ops can see counts via `/admin/brokerage/listings` (counts-only
stub from bd9e29b §Phase 8) but cannot see **which** deal is stuck and
**why**. The synthetic-borrower run (§3.7) requires this visibility for
triage.

**Files to change**:
- `src/app/admin/brokerage/listings/page.tsx` — convert each tile to
  a `<Link>` to a filtered detail page.

**Files to add**:
- `src/app/admin/brokerage/sessions/page.tsx` — last-24h sessions.
- `src/app/admin/brokerage/deals/page.tsx` — filtered by `origin` via
  search param.
- `src/app/admin/brokerage/uploads/page.tsx` — `deal_documents` with
  `finalized_at IS NULL`, ordered by `uploaded_at ASC`.
- `src/app/admin/brokerage/packages/page.tsx` — sealed packages.
- The existing `/admin/brokerage/listings/page.tsx` keeps its summary
  role; per-status detail filters via `?status=…`.

**Files to inspect**:
- `src/app/admin/layout.tsx` — auth gate inheritance is already
  correct (super_admin). No new gate needed.

**Acceptance**:
- Each tile click lands on a working table with at least: deal id,
  display name (NULL-safe), age, last `ai_events.action`, age in
  seconds.
- Empty state renders explicitly (no perpetual skeleton).
- 50-row cap per page; oldest-first ordering.
- No new write endpoints introduced in this phase. If a triage action
  needs a new endpoint, document the gap; do not build it here.

**Tests/commands**:

```bash
pnpm typecheck
pnpm lint
```

(no unit tests — these are SSR pages reading existing tables; the
typecheck + lint + manual preview check is the gate.)

---

### 3.7 Synthetic borrower E2E script

**Goal**: drive 10–15 fake borrowers end-to-end against a preview
deployment, without manual DB surgery.

**Files to add**:
- `scripts/synth-borrower-e2e.ts` — Node script (tsx run).
- `scripts/synth-borrower-e2e/fixtures/*.json` — N transcripts (≥ 15).
  Reuse the deterministic PDF set under `goldens/`.

**Files to inspect**:
- `src/app/api/brokerage/concierge/route.ts` — request/response shape.
- `src/app/api/brokerage/upload/prepare/route.ts` — bridge response
  shape.
- `src/app/api/brokerage/deals/[dealId]/seal-status/route.ts` —
  polling endpoint.

**Behavior**:
1. Read `BUDDY_PREVIEW_URL` and `SUPABASE_SERVICE_ROLE_KEY` from env.
2. For each fixture (default N=15):
   - Fresh cookie jar.
   - Multi-turn `POST /api/brokerage/concierge` until response
     reports `nextRequiredFields = []`.
   - `POST /api/brokerage/upload/prepare`, follow the returned
     `uploadUrl`, upload the fixture's PDF set.
   - Poll `GET /api/brokerage/deals/{dealId}/seal-status` every 5s
     up to 5 minutes.
3. Write `.ci/synth-borrower-e2e-report.json`:

   ```ts
   {
     ran_at: string,
     baseline_commit: string,  // git rev-parse HEAD
     fixtures: Array<{
       fixture_id: string,
       deal_id: string | null,
       sealed: boolean,
       elapsed_ms: number,
       last_event: { scope: string, action: string, created_at: string } | null,
       error: string | null,
     }>,
     pass_rate: number,
   }
   ```
4. Exit non-zero if `pass_rate < 13/15`.

**npm script**: `"synth:borrowers": "tsx scripts/synth-borrower-e2e.ts"`.

**Acceptance**:
- Script runs to completion against preview.
- `pass_rate >= 13/15` for at least one run inside the PR.
- Each failure row has a non-empty `last_event` so ops can pick up
  the trail.

**Tests/commands**:

```bash
BUDDY_PREVIEW_URL=https://preview-... pnpm synth:borrowers
cat .ci/synth-borrower-e2e-report.json | jq '.pass_rate'
```

---

## 4. Exact files to inspect / change (summary)

Touched (write):
- `src/lib/brokerage/session.ts` (§3.1)
- `src/lib/brokerage/rateLimits.ts` (§3.2)
- `src/app/api/brokerage/concierge/route.ts` (§3.1)
- `src/app/api/brokerage/upload/prepare/route.ts` (§3.2)
- `src/app/(borrower)/upload/[token]/page.tsx` (§3.3)
- `src/app/api/portal/upload/commit/route.ts` (§3.3)
- `src/app/admin/brokerage/listings/page.tsx` (§3.6)
- `src/app/admin/brokerage/sessions/page.tsx` *(new, §3.6)*
- `src/app/admin/brokerage/deals/page.tsx` *(new, §3.6)*
- `src/app/admin/brokerage/uploads/page.tsx` *(new, §3.6)*
- `src/app/admin/brokerage/packages/page.tsx` *(new, §3.6)*
- `scripts/synth-borrower-e2e.ts` *(new, §3.7)*
- `scripts/synth-borrower-e2e/fixtures/*.json` *(new, §3.7)*
- `scripts/guards/guard-brokerage-rls-tables.mjs` *(new, §3.4)*
- `package.json` (`synth:borrowers`, `guard:brokerage-rls` scripts)

Inspected (read-only):
- `src/lib/brokerage/sessionToken.ts`
- `src/lib/tenant/brokerage.ts`
- `src/app/api/brokerage/concierge/route.ts` (request/response shape)
- `src/app/api/brokerage/deals/[dealId]/seal-status/route.ts`
- `src/app/api/cron/brokerage/cleanup-expired/route.ts`
- `src/app/admin/layout.tsx`

---

## 5. Exact Supabase migrations involved

New (added in this PR):

| Migration | Purpose | Section |
| --- | --- | --- |
| `<ts>_brokerage_session_dedup.sql` | `claim_brokerage_session` RPC + `deals.brokerage_session_token_hash` column + partial unique index | §3.1 |
| `<ts>_borrower_portal_link_state.sql` | `borrower_portal_links.revoked_at` + `consume_borrower_portal_link` + `peek_borrower_portal_link` RPCs | §3.3 |
| `<ts>_brokerage_rls_stage_a.sql` | RLS ON for `borrower_session_tokens` + `rate_limit_counters` | §3.4 / §3.5 |
| `<ts>_brokerage_rls_stage_a_inverse.sql` | Inverse of above. Not auto-applied. | §3.4 / §3.5 |

Existing (must remain unchanged):

- `20260425_brokerage_tenant_model.sql` — singleton seed + concierge
  sessions + session tokens.
- `20260425_brokerage_deal_fields.sql` — `deals.origin`,
  `deals.borrower_email`.
- `20260620000001_brokerage_singleton_assert.sql` — singleton unique
  index (from `bd9e29b`).

Tables touched (no destructive changes):

- `deals` — additive column only.
- `borrower_portal_links` — additive column only.
- `borrower_session_tokens` — RLS toggle only.
- `rate_limit_counters` — RLS toggle only.

---

## 6. Acceptance criteria per blocker

Per-blocker checkboxes (use in the PR body):

§3.1
- [ ] Concurrent cookie-less test → exactly one new deal row.
- [ ] Cookie-bearing repeat POST → no new deal row.
- [ ] Partial unique index present in DB.

§3.2
- [ ] Repeat POST within hour returns same token.
- [ ] 4th POST/hour returns 429.
- [ ] Prior `brokerage_self_serve` link revoked on new mint.
- [ ] `ai_events` row per outcome.

§3.3
- [ ] Consumed link replay → 410 `link_consumed`.
- [ ] Expired link → 410 `link_expired`.
- [ ] Revoked link → 410 `link_revoked`.
- [ ] All server callers use the RPCs.

§3.4
- [ ] Anon curl → zero rows / 401.
- [ ] Existing flows still green in preview.
- [ ] CI guard added.

§3.5
- [ ] Anon curl → zero rows / 401.
- [ ] `rateLimits.test.ts` still passes.

§3.6
- [ ] Each tile click renders a detail table.
- [ ] Empty + populated states both render.
- [ ] 50-row cap honored.

§3.7
- [ ] Script runs against preview.
- [ ] `pass_rate >= 13/15`.
- [ ] Report committed under `.ci/`.

---

## 7. Tests / commands

```bash
# whole-PR gate
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm guard:all
pnpm guard:brokerage-rls   # new — see §3.4

# blocker-targeted
node --test --import tsx src/lib/brokerage/__tests__/getOrCreateBorrowerSession.test.ts
node --test --import tsx src/app/api/brokerage/upload/prepare/__tests__/route.test.ts
node --test --import tsx src/lib/portal/__tests__/portalLinkState.test.ts
node --test --import tsx src/lib/brokerage/__tests__/rateLimits.test.ts

# end-to-end
BUDDY_PREVIEW_URL=<preview> pnpm synth:borrowers
```

If `pnpm` is unavailable on the runner, substitute `node_modules/.bin/`
directly (e.g. `node_modules/.bin/tsc --noEmit --skipLibCheck`).

---

## 8. Explicit non-goals

Do NOT build in this PR:

- Full marketplace engine (`SPEC-MARKETPLACE-PREVIEW-CLAIM-PICK-V1`).
- Lender claim / borrower pick / atomic unlock flows.
- Self-serve lender onboarding.
- Autonomous lender selection.
- Multiple brokerages.
- Portfolio monitoring / annual review / workouts.
- Examiner tooling.
- Pulse / PEIS / third-brain systems.
- Crypto collateral systems.
- Non-SBA products.

Do NOT touch:

- Any commercial-bank tenant code path.
- The existing readiness / OCR / classification pipeline implementation.
- The `getBrokerageBankId()` helper (use it, don't change it).

---

## 9. Definition of pilot-ready

Buddy SBA Brokerage is pilot-ready when **all** of the following are
true:

1. **10 synthetic borrower deals** can enter through `/start`.
2. **No duplicate draft deals** are created by session refresh / retry.
3. Each borrower can **upload documents** through the existing upload
   path.
4. **Failed OCR / upload states are visible to ops** (the §3.6
   drilldowns are wired and rendering).
5. **Borrower session tables are not publicly exposed** (Stage A RLS
   from §3.4 + §3.5 is applied; anon-key probes return zero rows).
6. **Portal links expire and cannot be reused after consumption** (the
   §3.3 RPC-backed state machine is the single enforcement point).
7. **All tests pass from the `bd9e29b` baseline**:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test:unit`
   - `pnpm guard:all`

Pilot-ready is a single-shot gate. The first 10 real borrowers are
opened only after every item above is independently verified. The
unpushed lint commit `84b0ad0` is **not** a precondition — if proxy
auth recovers and it lands, fold it forward; if not, reapply the
equivalent lint cleanups inline when an adjacent file is already being
touched.
