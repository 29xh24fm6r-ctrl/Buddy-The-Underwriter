# Brokerage Specs — Revisions Round 4

**Status:** Apply these deltas during implementation of each sprint. This file lists every change validated against ChatGPT round 4 review + live schema audit conducted 2026-04-24.

**Master plan precedence still applies:** if any sprint spec conflicts with this revisions doc, this doc wins; if this doc conflicts with the master plan, master plan wins.

---

## Universal — applies to every sprint

### U-1. Hashed tokens, no exceptions

Anywhere a borrower session token appears in a column name, payload, audit log, or function signature, the field is `token_hash` (or `borrower_session_token_hash`), never `token`. The raw token lives only in the HTTP-only cookie. This was already established in master plan §3a but I missed propagating it to Sprint 4 audit log and Sprint 6 picks. Fix on sight in any spec where you see `borrower_session_token text`.

### U-2. Use admin role, not owner

`bank_user_memberships.role` has no check constraint, but the only existing value in production is `'admin'`. Brokerage operator seed (Sprint 1 §8 and Sprint 4 lender provisioning) inserts `role = 'admin'`, not `'owner'`. Update both specs.

### U-3. Cron timezone via real library

Anywhere a spec calls `nextBusinessDayAt(now, 9, "CT")` or similar, replace with explicit `date-fns-tz` (or equivalent) with the IANA `America/Chicago` zone:

```typescript
import { zonedTimeToUtc, utcToZonedTime } from "date-fns-tz";
import { addDays, setHours, setMinutes, setSeconds, setMilliseconds, isWeekend } from "date-fns";

export function nextBusinessDayAt(from: Date, hourCT: number): Date {
  const TZ = "America/Chicago";
  let candidate = utcToZonedTime(from, TZ);
  candidate = addDays(candidate, 1);
  while (isWeekend(candidate)) candidate = addDays(candidate, 1);
  candidate = setMilliseconds(setSeconds(setMinutes(setHours(candidate, hourCT), 0), 0), 0);
  return zonedTimeToUtc(candidate, TZ);
}
```

Required dep: `date-fns-tz` if not already in package.json.

---

## Sprint 1 v2 — deltas

### S1-1. Add `banks.clerk_org_id` column (foundational)

This was wrong before. Sprint 1's tenant model doesn't add `clerk_org_id`, but the existing `banks` table doesn't have one and Sprint 4 + Sprint 6 both assume it does. Pull this forward into Sprint 1's first migration so it's available before any lender provisioning happens:

```sql
-- supabase/migrations/20260425_banks_clerk_org_id.sql
ALTER TABLE public.banks
  ADD COLUMN IF NOT EXISTS clerk_org_id text;

CREATE UNIQUE INDEX IF NOT EXISTS banks_clerk_org_id_idx
  ON public.banks (clerk_org_id)
  WHERE clerk_org_id IS NOT NULL;

COMMENT ON COLUMN public.banks.clerk_org_id IS
  'Clerk organization ID for tenant resolution. NULL for legacy banks not yet linked. Lookup pattern: getAuth() -> orgId -> banks WHERE clerk_org_id = orgId.';
```

The brokerage tenant insert in Sprint 1 doesn't need a Clerk org (it's operated by Buddy ops who are members via `bank_user_memberships`). Lender tenants in Sprint 4 will set this column at provisioning time.

### S1-2. UNIQUE on `borrower_concierge_sessions(deal_id)`

Add to migration `20260425_brokerage_tenant_model.sql`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS borrower_concierge_sessions_deal_id_unique
  ON public.borrower_concierge_sessions (deal_id);
```

One session per deal. The brokerage concierge route uses `.maybeSingle()` on this lookup, which means duplicate rows would silently break. Enforce at DB layer.

### S1-3. Use `admin` role for operator seed

Update Sprint 1 §8 SQL:

```sql
-- WAS: role 'owner'
-- USE: role 'admin' (matches existing production value)
INSERT INTO public.bank_user_memberships (bank_id, user_id, role)
SELECT id, '<YOUR_AUTH_UID>', 'admin'
FROM public.banks WHERE code = 'BUDDY_BROKERAGE'
ON CONFLICT DO NOTHING;
```

### S1-4. Cleanup cron for expired tokens and counters

Add to Sprint 1 deliverables a new cron route:

```typescript
// src/app/api/cron/brokerage/cleanup-expired/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const CRON_SECRET = process.env.CRON_SECRET!;

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const tokens = await sb
    .from("borrower_session_tokens")
    .delete()
    .lt("expires_at", now);

  const counters = await sb
    .from("rate_limit_counters")
    .delete()
    .lt("expires_at", now);

  return NextResponse.json({
    ok: true,
    tokens_deleted: tokens.count ?? 0,
    counters_deleted: counters.count ?? 0,
  });
}
```

Register in `vercel.json`:

```json
{
  "path": "/api/cron/brokerage/cleanup-expired",
  "schedule": "0 4 * * *"
}
```

(4am UTC = 11pm CT, low-traffic window.)

### S1-5. Score trigger remains fire-and-forget for v1

ChatGPT suggested moving the score trigger to a job queue. Defer to P2. For v1 launch, fire-and-forget with a `console.warn` on failure is acceptable because: (a) the score is non-fatal to the borrower experience, (b) the next concierge turn re-triggers if the previous one failed, (c) we don't have a job queue infrastructure today and building one is bigger than the score itself. Add to `BUDDY_PROJECT_ROADMAP.md` as a P2 follow-up: *"Score trigger: move from in-request fire-and-forget to durable job queue when traffic warrants."*

---

## Sprint 2 — deltas

### S2-1. Never pass session token to client

Remove `sessionToken: string` from `BorrowerVoicePanelProps`. The component calls `/api/brokerage/voice/gemini-token` which reads the cookie server-side and mints a short-lived voice token. Client never sees the session token.

```tsx
// CORRECTED
type BorrowerVoicePanelProps = {
  dealId: string;
};

export function BorrowerVoicePanel({ dealId }: BorrowerVoicePanelProps) {
  // ... fetch /api/brokerage/voice/gemini-token with credentials: "include"
  // The cookie does the auth. No client-side token handling.
}
```

### S2-2. Gateway-side transcript writeback only

Remove from spec the "client-side fetch to `/api/brokerage/concierge` with transcribed text" pattern. Replace with: the Fly voice gateway, which already terminates the Gemini Live audio stream, writes transcripts directly back to `borrower_concierge_sessions.conversation_history` via a service-role Supabase client. The client never sees or relays transcripts for fact extraction.

This means the Fly gateway needs:
- Supabase service-role key in Fly secrets
- Per-borrower-scope transcript writeback path
- The same fact-extraction call (`callGeminiJSON` with `MODEL_CONCIERGE_EXTRACTION`) as the typed concierge route, called gateway-side after each borrower utterance

This is more work than the original spec but materially more secure. A malicious client can't inject "transcribed" text the gateway didn't actually hear.

### S2-3. Borrower voice audit rows scoped separately

Add to migration:

```sql
-- supabase/migrations/20260427_voice_session_audits.sql
CREATE TABLE IF NOT EXISTS public.voice_session_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('banker','borrower')),
  deal_id uuid REFERENCES public.deals(id),
  bank_id uuid REFERENCES public.banks(id),
  borrower_session_token_hash text,
  user_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,
  utterance_count integer NOT NULL DEFAULT 0,
  gateway_session_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX voice_session_audits_deal_id_idx ON public.voice_session_audits (deal_id);
CREATE INDEX voice_session_audits_scope_idx ON public.voice_session_audits (scope);
```

---

## Sprint 3 — deltas

### S3-1. Redaction at data layer, watermark at render layer

Tighten language so this is unambiguous:

- **Redaction.** Modify the data passed to the renderer. Numeric tables receive `"$XXK"` strings or `null` values. Narrative sections receive `"[Unlocks when you pick a lender]"` placeholder strings. The PDF is rendered from already-redacted data — the original numbers and narratives never reach the renderer.
- **Watermark.** A visual overlay applied during render (PDFKit diagonal text on every page). The watermark is purely cosmetic; it does NOT protect data and must NOT be the only redaction mechanism. Removing the watermark from a preview PDF must yield a document that still has no real numbers or full narratives.

### S3-2. Bundle status + partial unique current per mode

Update the `buddy_trident_bundles` migration:

```sql
-- supabase/migrations/20260427_trident_bundles.sql
CREATE TABLE IF NOT EXISTS public.buddy_trident_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  mode text NOT NULL CHECK (mode IN ('preview', 'final')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed')),
  business_plan_pdf_path text,
  projections_pdf_path text,
  projections_xlsx_path text,
  feasibility_pdf_path text,
  version integer NOT NULL DEFAULT 1,
  generation_started_at timestamptz,
  generation_completed_at timestamptz,
  generation_error text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);

-- Exactly one current bundle per (deal, mode).
CREATE UNIQUE INDEX buddy_trident_bundles_one_current_per_deal_mode
  ON public.buddy_trident_bundles (deal_id, mode)
  WHERE superseded_at IS NULL AND status = 'succeeded';

CREATE INDEX buddy_trident_bundles_status_idx ON public.buddy_trident_bundles (status);
```

Bundle generation orchestrator updates: insert row with `status='pending'` first, transition to `'running'` at start, `'succeeded'` on commit, `'failed'` with `generation_error` on exception. Failed bundles do NOT supersede the previous succeeded one.

### S3-3. Output types — both PDF and XLSX for projections

Borrower preview shows the PDF version (truncated, redacted). Final release at pick delivers BOTH the PDF and the full XLSX workbook so the borrower has the live model. Update bundle table to track both paths (added above).

### S3-4. Signed URL endpoint requires session ownership

Tighten the spec:

```typescript
// GET /api/brokerage/deals/[dealId]/trident/download/[kind]
// Authorization:
//   1. Read borrower_session cookie, hash it.
//   2. Look up borrower_session_tokens by hash.
//   3. Verify session.deal_id === [dealId] from URL path.
//   4. ONLY THEN mint signed URL.
// A request without a matching session cookie OR with a session for a different
// deal returns 404 (not 403 — don't leak existence of other deals).
```

For winning lender access (post-pick), separate route `GET /api/lender/deals/[dealId]/package/[kind]` gated by Clerk auth + `requireLenderMarketplaceAccess` + verification that this lender `bank_id` is the winning_claim's `lender_bank_id`.

---

## Sprint 4 — deltas

### S4-1. Provisioning RPC, transactional

Replace the Sprint 4 admin route's sequential inserts with a single transactional RPC:

```sql
-- supabase/migrations/20260428_provision_lender_rpc.sql
CREATE OR REPLACE FUNCTION public.provision_lender(
  p_lender_name text,
  p_code text,
  p_clerk_org_id text,
  p_first_user_id uuid,
  p_lender_program jsonb,
  p_lma_signed_by_name text,
  p_lma_signed_by_title text,
  p_lma_signed_pdf_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bank_id uuid;
  v_lma_id uuid;
  v_current_lma uuid;
BEGIN
  -- 1. Insert lender bank.
  INSERT INTO public.banks (code, name, bank_kind, clerk_org_id, is_sandbox)
  VALUES (p_code, p_lender_name, 'commercial_bank', p_clerk_org_id, false)
  RETURNING id INTO v_bank_id;

  -- 2. Add first user.
  INSERT INTO public.bank_user_memberships (bank_id, user_id, role)
  VALUES (v_bank_id, p_first_user_id, 'admin');

  -- 3. Lender program.
  INSERT INTO public.lender_programs (bank_id, lender_name, criteria_json)
  VALUES (v_bank_id, p_lender_name, p_lender_program);

  -- 4. Resolve current LMA.
  SELECT id INTO v_current_lma
  FROM public.legal_documents
  WHERE doc_type = 'lma' AND superseded_at IS NULL
  ORDER BY effective_date DESC LIMIT 1;

  IF v_current_lma IS NULL THEN
    RAISE EXCEPTION 'No active LMA version published';
  END IF;

  -- 5. LMA signing record.
  INSERT INTO public.lender_marketplace_agreements (
    lender_bank_id, legal_document_id, signed_at,
    signed_by_name, signed_by_title, signed_pdf_storage_path, status
  )
  VALUES (
    v_bank_id, v_current_lma, now(),
    p_lma_signed_by_name, p_lma_signed_by_title,
    p_lma_signed_pdf_storage_path, 'active'
  )
  RETURNING id INTO v_lma_id;

  RETURN jsonb_build_object(
    'ok', true,
    'lender_bank_id', v_bank_id,
    'lma_agreement_id', v_lma_id
  );
END;
$$;
```

The admin route just calls this RPC. Failure rolls back all inserts.

### S4-2. UNIQUE active LMA per lender per legal_document

Add to LMA migration:

```sql
CREATE UNIQUE INDEX lender_marketplace_agreements_one_active_per_lender_doc
  ON public.lender_marketplace_agreements (lender_bank_id, legal_document_id)
  WHERE status = 'active';
```

A lender can have one and only one active agreement per LMA version. New version = new row + previous version may stay active until re-signed (depending on grace policy), or be auto-marked superseded by app logic on version bump.

### S4-3. Audit log uses token hash only

Update the `marketplace_audit_log` migration:

```sql
-- WAS: borrower_session_token text
-- USE:
borrower_session_token_hash text,
```

Anywhere the audit log receives borrower context, callers pass `session.tokenHash`, never `session.rawToken`.

### S4-4. Audit log insert policy is service-role only

Replace the audit log insert policy:

```sql
-- WAS: CREATE POLICY audit_log_insert_any_authenticated
--      ON public.marketplace_audit_log FOR INSERT
--      WITH CHECK (auth.uid() IS NOT NULL);
-- REMOVE this policy entirely.

-- Audit log writes happen exclusively via supabaseAdmin() (service role)
-- from server-side code paths. No INSERT policy = no client can write.
-- SELECT policies for ops + own-events remain unchanged.
```

App code already uses `supabaseAdmin()` for audit log writes, so this is purely tightening the security boundary.

### S4-5. Placeholder LMA hash — explicit launch blocker

Add to launch checklist:

**HARD BLOCKER:** `legal_documents` row for `('lma', '1.0.0')` has `content_hash = 'PLACEHOLDER_HASH_UPDATE_ON_REAL_UPLOAD'`. Marketplace cannot accept a real lender claim until this is replaced with the SHA-256 of the counsel-finalized LMA PDF and the PDF is uploaded to `legal/lma-v1.0.0.pdf` in Supabase Storage. Add a startup check that fails app boot in production if the placeholder hash is still present.

---

## Sprint 5 — deltas

### S5-1. Replace EXCLUDE with partial unique index

`btree_gist` is not installed in the database (verified). Replace the EXCLUDE constraint on `buddy_sealed_packages`:

```sql
-- REMOVE:
-- CONSTRAINT sealed_packages_one_active_per_deal
--   EXCLUDE (deal_id WITH =) WHERE (unsealed_at IS NULL)

-- USE:
CREATE UNIQUE INDEX buddy_sealed_packages_one_active_per_deal
  ON public.buddy_sealed_packages (deal_id)
  WHERE unsealed_at IS NULL;
```

### S5-2. Redactor architecture: deterministic first, LLM optional, scanner backstop

Restructure §6 of Sprint 5:

```
Layer 1 — Deterministic redactor (REQUIRED, security-critical):
  Pure function. Strips all identity fields by name. Buckets numeric values
  by published bucketing rules. Returns the structured KFS object.
  This is the actual security boundary — if this layer is broken, PII leaks.

Layer 2 — LLM anonymized narrative (OPTIONAL second pass):
  Gemini Flash receives the already-redacted KFS plus a sanitized fact summary
  with explicit "strip identifiers" instruction. Produces a 2-3 paragraph
  narrative for the listing. NEVER receives raw deal data.

Layer 3 — PII scanner (REQUIRED backstop):
  After narrative generation, scan the narrative output for:
    - Capitalized first-last name patterns
    - Email addresses (regex)
    - Phone numbers (E.164 + common US patterns)
    - ZIP codes (regex)
    - Street suffixes ("Street", "Ave", "Boulevard", etc.)
    - Borrower's actual name (passed in as a known-bad token)
    - Borrower's actual business name (same)
  If ANY match: discard the narrative, log the violation, fall back to a
  deterministic templated narrative. Do NOT publish the LLM output.

The scanner is a backstop, not the primary defense. The deterministic redactor
is the security boundary. The narrative-generation prompt is the secondary
defense. The scanner catches obvious failures of the first two.
```

### S5-3. Add `kfs_redaction_version` to listings

Update `marketplace_listings` migration:

```sql
ALTER TABLE public.marketplace_listings
  ADD COLUMN kfs_redaction_version text NOT NULL DEFAULT '1.0.0';
```

Bump the version whenever the redactor logic changes. Old listings retain their version; their KFS is the output of that version's redactor. Forensics-friendly.

### S5-4. Listing RLS requires active LMA

Replace the `listings_select_for_matched_lenders` policy:

```sql
DROP POLICY IF EXISTS listings_select_for_matched_lenders ON public.marketplace_listings;

CREATE POLICY listings_select_for_matched_lenders_with_active_lma
  ON public.marketplace_listings FOR SELECT
  USING (
    status IN ('previewing', 'claiming', 'awaiting_borrower_pick')
    AND EXISTS (
      SELECT 1 FROM public.bank_user_memberships m
      WHERE m.user_id = auth.uid()
        AND m.bank_id = ANY (marketplace_listings.matched_lender_bank_ids)
        -- MUST have an active LMA on the current version.
        AND EXISTS (
          SELECT 1
          FROM public.lender_marketplace_agreements lma
          JOIN public.legal_documents ld ON ld.id = lma.legal_document_id
          WHERE lma.lender_bank_id = m.bank_id
            AND lma.status = 'active'
            AND ld.superseded_at IS NULL
            AND ld.doc_type = 'lma'
        )
    )
  );
```

Lenders with expired or superseded LMAs lose visibility immediately at the database layer.

### S5-5. Matching engine handles 0 matches

Update `matchLendersToDeal` contract:

```typescript
// Returns at most 10, possibly empty.
export async function matchLendersToDeal(args: {
  dealId: string;
  sb: SupabaseClient;
}): Promise<{
  matched: string[];          // bank_ids
  matchCount: number;
  noMatchReasons?: string[];  // populated if matched.length === 0
}>;
```

Sealing gate (`canSeal`) treats zero matches as a sealing failure with reason "no lenders match this deal's profile (score X, program Y, state Z, loan amount $W). Adjust the deal or contact ops." Borrower sees this in the seal UI and can either revise the deal or contact ops.

---

## Sprint 6 — deltas

### S6-1. Atomic unlock redesigned as state machine + outbox

This is the largest revision in the round. The original spec described a TypeScript function doing 5 side effects in sequence and called it atomic. It is not. Here is the correct pattern.

**New table: `unlock_jobs`**

```sql
CREATE TABLE IF NOT EXISTS public.unlock_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id uuid NOT NULL REFERENCES public.marketplace_picks(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id),
  winning_claim_id uuid NOT NULL REFERENCES public.marketplace_claims(id),

  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','generating_trident','generating_package','releasing','completed','failed_retryable','failed_terminal')),

  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,

  -- Per-step completion markers. NULL = not yet done.
  trident_bundle_id uuid REFERENCES public.buddy_trident_bundles(id),
  package_release_id uuid,                    -- references package release record (Sprint 3)
  losers_finalized_at timestamptz,
  borrower_notified_at timestamptz,
  winner_notified_at timestamptz,
  losers_notified_at timestamptz,

  last_error text,
  last_error_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,

  UNIQUE (pick_id)  -- exactly one unlock job per pick
);

CREATE INDEX unlock_jobs_status_idx ON public.unlock_jobs (status);
CREATE INDEX unlock_jobs_deal_id_idx ON public.unlock_jobs (deal_id);
```

**Pick API — fast, transactional**

`POST /api/brokerage/deals/[dealId]/pick` does ONLY the following, in one DB transaction:

1. Verify session, listing state, winning claim validity (all read-only checks).
2. Insert `marketplace_picks` row.
3. Update winning claim → `status='won'`, losing claims → `status='lost'`.
4. Update listing → `status='picked'`, `picked_at=now()`.
5. Update deal → `status='picked'`.
6. Insert `unlock_jobs` row with `status='queued'`.
7. Insert audit log `borrower_picked`.
8. Return 200 to borrower with `pickId` and `unlockJobId`.

That's it. ~200ms total. No PDF generation, no storage writes, no email. The borrower sees: *"Your pick is recorded. Your trident is being prepared and will be available in your portal in ~2 minutes."*

**Unlock worker — separate process, idempotent**

A worker runs unlock jobs from the queued state forward. Implementation can be a polling cron (`/api/cron/brokerage/process-unlock-jobs` every 30s) or a queue (BullMQ / Inngest / similar) — pick whichever Buddy already has. The state machine:

```
queued
  → start worker, set status='running', attempt_count++

running
  → if no trident_bundle_id: generate final trident bundle.
    On success: set trident_bundle_id, transition to 'generating_package'.
    On failure: increment attempt_count, set last_error, transition to 'failed_retryable' if attempt < max, else 'failed_terminal'.

generating_package
  → if no package_release_id: generate full E-Tran package + signed URLs for winning lender.
    On success: set package_release_id, transition to 'releasing'.
    On failure: same retry pattern.

releasing
  → if losers_finalized_at NULL: confirm losing claims status='lost' (idempotent).
    Then send notifications:
      - borrower email if borrower_notified_at NULL
      - winning lender email if winner_notified_at NULL
      - losing lender emails if losers_notified_at NULL
    Each notification updates its timestamp on success.
    When all three notification timestamps set, transition to 'completed'.

completed
  → terminal. completed_at set. No further action.

failed_retryable
  → worker re-picks up after backoff (exponential: 1m, 5m, 30m).
  → after attempt_count == max_attempts, transition to 'failed_terminal'.

failed_terminal
  → ops alert fires. Manual intervention required. Pick is recorded; the
    borrower has been told their pick was received. Ops manually completes
    the steps that succeeded and resumes from the failed step.
```

**Idempotency guarantees**

- Trident generation: orchestrator checks for existing successful bundle for this deal+mode='final' before regenerating. If exists, reuse.
- Package generation: same pattern.
- Notifications: each timestamp is the idempotency key. If already set, skip.
- Loser claim updates: `WHERE status='active'` filter is naturally idempotent.

**What this means for the borrower experience**

Borrower picks → *"Your pick is recorded. Trident generation usually takes 2-5 minutes. We'll email you when it's ready and your portal will refresh."* Portal polls or websocket-listens to `unlock_jobs.status` and updates UI accordingly. If `failed_retryable`, portal shows "still processing." If `failed_terminal`, portal shows "We hit a snag. Buddy ops has been notified and will follow up within an hour."

**Acceptance criterion change**

The original "atomic unlock all-or-nothing" criterion is replaced with: **pick is atomic and recorded in <500ms. Unlock job runs separately, is idempotent, retries on failure, and never double-releases.** Failed terminal jobs alert ops and pause for manual intervention. Pick is never lost regardless of unlock outcome.

### S6-2. Token hash everywhere in `marketplace_picks`

```sql
-- WAS: borrower_session_token text NOT NULL
-- USE: borrower_session_token_hash text NOT NULL
```

Pick API hashes the cookie before passing to the RPC.

### S6-3. Stripe — descope to "ops fires manually" for v1

Replace the Stripe section with:

v1 Stripe integration is manual ops-fired, not automated.

The `mark-funded` admin route does NOT create Stripe payment intents. Instead it:

1. Marks `deals.status = 'funded'`.
2. Inserts two `marketplace_transactions` rows with `stripe_status = 'pending_manual'`.
3. Sends an ops email: *"Deal X funded $Y. Borrower fee owed: $1,000. Lender fee owed: $Z (1% of $Y at founding cohort rate). Closing agent: [name from manual entry]. Please initiate borrower fee collection from closing-agent escrow and lender ACH invoice."*

Real Stripe automation is a Sprint 7 workstream after the first 5 deals close manually and we understand the actual closing-agent flow per state.

Founding-cohort detection logic (count of prior funded lender transactions) remains in the spec because it determines the fee amount the ops email shows.

This is honest about where we are. Auto-charging a borrower's saved card for $1,000 doesn't reflect how SBA closings work — the closing agent disburses from loan proceeds.

### S6-4. Rate card source-of-truth

The `recomputeRateCard` function pulls from `SOP_SPREAD_CAPS_BPS` which the Sprint 6 spec left as a partial example. Before any production listing accepts a real claim:

**HARD BLOCKER:** `SOP_SPREAD_CAPS_BPS` table must be populated with the full SBA SOP 50 10 7.1 max-rate matrix (loan amount tier × term tier), reviewed and signed off by SBA-competent counsel. Rate card v1.0.0 cannot be marked active in `marketplace_rate_card` until this happens. Add startup check that fails app boot if rate card v1.0.0 is missing OR `SOP_SPREAD_CAPS_BPS` has placeholder values.

### S6-5. Cron timezone — see U-3

Replace ad-hoc `nextBusinessDayAt(now, 9, "CT")` with `date-fns-tz` implementation per universal rule U-3.

### S6-6. Sprint 6 references to `session.token` are stale

Search Sprint 6 spec for any remaining `session.token` references and replace with `session.tokenHash`. The session object's shape changed in Sprint 1 v2 and Sprint 6 was written before that. Sweep and fix.

---

## Build order — confirmed

No change to the previously locked sequence:

1. Prereq Gemini migration (in flight, Claude Code at PR stage)
2. Sprint 0 Buddy SBA Score (queued next)
3. Sprint 1 v2 + S1-1 through S1-5 deltas
4. Sprint 3 trident previews + S3 deltas
5. Sprint 4 LMA + S4 deltas
6. Sprint 5 sealing + S5 deltas
7. Sprint 6 marketplace + S6 deltas, with atomic unlock redesigned per S6-1
8. Sprint 2 borrower voice — parallel after Sprint 1

---

## P0 launch blockers (consolidated)

Before first real borrower deal lists on the marketplace:

- [ ] Counsel-finalized LMA PDF uploaded; `legal_documents.content_hash` matches real SHA-256 (not placeholder).
- [ ] Rate card v1.0.0 seeded with counsel-reviewed SOP cap table values (no placeholders).
- [ ] App startup check fails boot if either of the above is still placeholder.
- [ ] At least 3 lenders provisioned via the transactional `provision_lender` RPC, each with active LMA on current version.
- [ ] Brokerage operator (Matt) added to `bank_user_memberships` for `BUDDY_BROKERAGE` tenant with role `'admin'`.
- [ ] Concierge Gemini migration prereq merged and live smoke passed.
- [ ] Buddy SBA Score Sprint 0 complete with eligibility engine ≥8 named checks.
- [ ] PII scanner (S5-2 Layer 3) tested against fixture with full PII — must catch every planted leak.
- [ ] Atomic unlock state machine (S6-1) tested with injected failure at each step — must resume correctly without double-release.
- [ ] Stripe `pending_manual` ops email path tested end-to-end with at least one synthetic fund event.
- [ ] State broker licensing review for Wisconsin (and any other states the first cohort lenders operate in).
- [ ] Cleanup cron (S1-4) deployed and verified running nightly.

---

## Done

That's every legitimate finding addressed. The biggest single change is **S6-1 atomic unlock redesigned as a state machine + outbox**. That's 1-2 extra days of Sprint 6 implementation, but it's the difference between a marketplace that works once in test and one that survives a real production failure.

The smallest changes (S1-3 role, S2-1 don't pass token to client, S5-1 partial unique index) are 5-minute fixes that prevent real bugs.

ChatGPT did good work on this round. The atomic-unlock catch alone justifies the whole review.
