# Brokerage launch checklist

Consolidated gate list before the first real borrower deal lists on the Buddy marketplace. Sprint 1 adds the operator seed; Sprints 4–6 populate the rest (LMA, rate card, lenders). Also see specs/brokerage/revisions-round-4.md §P0 launch blockers.

## Sprint 1 (tenant + brokerage concierge)

### Brokerage operator seed (manual post-deploy)

After Sprint 1 ships, run once with your real Clerk `auth.uid()` (from the Clerk dashboard or a `SELECT auth.uid()` issued while signed in) to gain brokerage-tenant access:

```sql
-- Role is 'admin' — matches the single production value in bank_user_memberships.
-- See revisions-round-4.md U-2.
INSERT INTO public.bank_user_memberships (bank_id, user_id, role)
SELECT id, '<YOUR_AUTH_UID>', 'admin'
FROM public.banks WHERE code = 'BUDDY_BROKERAGE'
ON CONFLICT DO NOTHING;
```

### Environment variables

- `CRON_SECRET` must be set in the Vercel project. The nightly cleanup cron at `/api/cron/brokerage/cleanup-expired` rejects calls without `Authorization: Bearer <CRON_SECRET>`.
- `GEMINI_API_KEY` must be set. The brokerage concierge route calls Gemini Pro + Flash via `callGeminiJSON`; without the key every turn falls back to the default message.

### Deploy-time verification

After deploy, confirm:

- [ ] `GET /` renders the brokerage-facing hero (not the bank-SaaS hero).
- [ ] `GET /for-banks` renders the prior bank-SaaS marketing content unchanged.
- [ ] `POST /api/brokerage/concierge` with a sample `{userMessage}` returns `ok:true`, sets the `buddy_borrower_session` cookie with `HttpOnly; Secure; SameSite=Lax; Path=/`, and creates a row in `deals` with `origin='brokerage_anonymous'`.
- [ ] Sixth POST within 60 seconds from the same IP returns HTTP 429 with a `retry-after` header.
- [ ] The nightly cron at `/api/cron/brokerage/cleanup-expired` returns 401 without the bearer and 200 with it.

## Sprint 4+ — P0 launch blockers (from revisions-round-4.md)

Not this sprint; listed here so the gate stays visible.

- [ ] Counsel-finalized LMA PDF uploaded; `legal_documents.content_hash` is a real SHA-256, not a placeholder.
- [ ] Rate card v1.0.0 seeded with counsel-reviewed SOP cap table values.
- [ ] App-startup check fails boot in production if either of the above is placeholder.
- [ ] ≥3 lenders provisioned via the transactional `provision_lender` RPC.
- [ ] PII scanner tested against a full-PII fixture (Sprint 5).
- [ ] Atomic-unlock state machine tested with injected failure at each step (Sprint 6).
