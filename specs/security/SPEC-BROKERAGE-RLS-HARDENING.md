# SPEC-BROKERAGE-RLS-HARDENING

Status: READY FOR STAGED EXECUTION
Owner: Matt
Implementer: Claude Code
Parent spec: specs/brokerage/SPEC-BROKERAGE-PRODUCTIONIZATION-V1.md §Phase 7

## Mission

Bring the brokerage-critical Supabase tables to a state where the launch
threat model holds:

- anonymous borrowers reach the system **only** through server-only routes
  using a service-role admin client;
- a borrower never queries the session-token table directly from the
  client;
- a lender sees **only** the redacted KFS for listings matched to it and
  the full E-Tran package **only** for a deal it has won via borrower
  pick;
- Buddy ops sees every brokerage-tenant row;
- background workers and CRON jobs use the service role.

RLS is not enabled blindly. Each table follows the staged plan below and
is gated on policy-coverage proof.

---

## Threat model snapshot

We protect against:

- direct PostgREST scrape from an attacker holding only the anon key;
- backup / replica / log exfiltration that would otherwise reveal raw
  session tokens;
- a logged-in lender attempting to pivot from a matched listing to the
  full E-Tran package of a deal it did not win;
- a logged-in lender attempting to read another lender's claim history.

We do NOT model:

- a service-role key leak (every brokerage write paths through a
  server-only handler — see `src/lib/supabase/admin.ts`);
- a Clerk session compromise (out of scope here; bounded by Clerk's own
  controls).

---

## Brokerage-critical table inventory

Each row is: `table | current RLS | intended access`.

| Table | RLS today | Anonymous borrower | Logged-in lender | Brokerage ops |
| --- | --- | --- | --- | --- |
| `banks` | ON | none | none (read only via membership) | full read |
| `borrower_session_tokens` | OFF | none | none | full (service role) |
| `rate_limit_counters` | OFF | none | none | full (service role) |
| `deals` (origin = brokerage_*) | ON | none | matched + won only | full |
| `borrower_concierge_sessions` | ON | none | none | full |
| `borrower_portal_links` | mixed | none (token-gated) | none | full |
| `deal_upload_sessions` | ON | server-only | none | full |
| `deal_documents` | ON | server-only | won-deal-only | full |
| `document_artifacts` | ON | server-only | won-deal-only | full |
| `deal_document_slots` | ON | server-only | won-deal-only | full |
| `buddy_trident_bundles` | ON | none | won-deal-only | full |
| `buddy_sealed_packages` | ON | none | none | full |
| `marketplace_listings` | ON | none | matched only (redacted) | full |
| `marketplace_rate_card` | ON | none | none | full |
| `lender_programs` | ON | none | own bank only | full |

Brokerage-critical tables NOT yet RLS-ON are tracked as launch blockers
in Phase 7 §Launch Blockers.

---

## Access model

### Anonymous borrower (HTTP-only cookie)

- Never holds a Postgres credential.
- Reaches the DB only via server-only API handlers (`/api/brokerage/**`,
  `/api/portal/**`).
- Server handler resolves cookie → `borrower_session_tokens` hash → deal
  id → admin-client queries scoped to that deal id.

### Logged-in lender (Clerk)

- RLS policies on `marketplace_listings`, `marketplace_lender_claims`,
  `deal_documents`, `buddy_trident_bundles`, `buddy_sealed_packages`
  must filter rows by lender membership against `bank_user_memberships`.
- Pre-pick: redacted KFS only — the policy must reject any column-level
  exposure of full borrower identity.
- Post-pick: winning lender's `bank_user_memberships` row is checked
  against the listing's pick row, NOT against `matched_lender_bank_ids`
  (because losing lenders also appear there).

### Brokerage ops

- Membership row in the Buddy Brokerage `banks` row.
- RLS policies select rows where `EXISTS (...bank_user_memberships JOIN
  banks ON bank_kind='brokerage')`.

### Service-role workers

- CRON tasks, intake worker, OCR processors.
- Use `supabaseAdmin()`. RLS does not apply.
- All such call sites are audited via `scripts/admin-routes-guard.mjs`
  and `scripts/guards/guard-tenant-rls.mjs`.

---

## Staged policy plan

### Stage A — read-side hardening (low risk)

Targets: tables where the current code already uses the admin client
for writes and the only risk is anonymous reads via PostgREST.

1. `borrower_session_tokens` — enable RLS, add no SELECT policy. Server
   code paths use admin client; nothing else should ever read this.
2. `rate_limit_counters` — enable RLS, no SELECT policy. Same rationale.

Test gates before merge:
- `pnpm test:unit` covering `src/lib/brokerage/__tests__/sessionToken.test.ts`,
  `src/lib/brokerage/__tests__/rateLimits.test.ts`.
- Manual smoke: hit `/start`, `POST /api/brokerage/concierge` 10× — no
  errors.

### Stage B — lender-visible rows (medium risk)

Targets: `marketplace_listings`, `marketplace_lender_claims` (when
landed), `deal_documents` (when accessed by lender views).

1. Confirm `marketplace_listings_select_for_brokerage_ops` policy.
2. Add `marketplace_listings_select_for_matched_lender` policy:

   ```sql
   create policy marketplace_listings_select_for_matched_lender
     on public.marketplace_listings
     for select
     using (
       exists (
         select 1 from public.bank_user_memberships m
         where m.user_id = auth.uid()
           and m.bank_id = any(marketplace_listings.matched_lender_bank_ids)
       )
     );
   ```

3. Add equivalent policies on `marketplace_lender_claims` and
   `buddy_trident_bundles` once the corresponding lender UI lands.

Test gates:
- Add an integration test that authenticates as a lender membership and
  confirms it can read only its matched listing rows.

### Stage C — borrower portal table boundary (high risk, deferred)

Targets: `borrower_portal_links`, `deal_upload_sessions`,
`deal_document_slots`, `deal_document_slot_attachments`.

These are reached via token-gated server handlers today. RLS should
remain a defense-in-depth layer (`select using (false)` from authed
contexts, all access through admin client). Sequencing depends on the
borrower portal's own roadmap.

---

## Rollback plan

- Every stage migration ships with an inverse migration (`alter table ...
  disable row level security`). The inverse is committed as a sibling
  file so a deploy-time issue can be unwound without resorting to
  destructive operations.
- Stage A inverses are safe to apply at any time.
- Stage B inverses must be paired with feature-flagging the lender UI
  off, because policy removal would expose all rows.

---

## Launch blockers (P0)

Before the first live borrower session lands:

- [ ] `borrower_session_tokens` RLS enabled (Stage A).
- [ ] `rate_limit_counters` RLS enabled (Stage A).
- [ ] No server log line contains a raw cookie value (`grep -r 'buddy_borrower_session' src` for accidental log statements).
- [ ] Audit of all `from('borrower_session_tokens')` call sites: every
  one uses `supabaseAdmin()`.
- [ ] `scripts/guards/guard-tenant-rls.mjs` passes under CI.

Before lender views go live:

- [ ] Stage B policies present and proven by integration test.
- [ ] No client-side code references `marketplace_listings` directly —
  all goes through server route `/api/lender/listings`.

---

## Acceptance for this spec

- Spec file present under `specs/security/`.
- Each launch blocker is checkbox-trackable.
- Staging is explicit; no policy lands without an inverse.
- The PR that implements Stage A links back to this spec.
