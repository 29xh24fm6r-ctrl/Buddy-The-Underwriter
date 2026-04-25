# SPEC S3 — IAL2 Identity Verification + DocuSeal E-Signature

**Date:** 2026-04-25 · **Owner:** Architecture (Matt) · **Executor:** Claude Code · **Effort:** 1.5–2 weeks · **Risk:** Medium-high (regulatory compliance gate; vendor contracts; AGPL nuance)

**Depends on:** S2 (forms must exist before they can be signed) · **Blocks:** S4 (4506-C signing), S5 (E-Tran final signing)

---

## Background

Two compliance-critical pieces ship together because they're tightly coupled:

1. **IAL2 identity verification.** SBA SOP 50 10 8 Appendix 10 requires NIST 800-63 IAL2 standards for electronic signatures on SBA forms. That means: ID document presentment + validation + biometric (liveness selfie) matching the ID. ESIGN Act compliance alone does not satisfy SBA. Buddy currently has no IAL2 path. The existing `src/lib/identity/intelligence/` is for ownership-graph inference, not borrower KYC. **Vendor v1: Persona** — most SBA-aware option, white-label friendly, IAL2-explicit packages.

2. **DocuSeal e-signature.** Self-hosted, AGPL-3.0, Ruby/Vue, ~11.4k stars on GitHub, mature. Replaces the missing e-sign layer entirely. Deployed as Cloud Run service in `buddy-the-underwriter` GCP project (same project as franchise-sync-worker). Embedded via REST API + iframe — no fork or modification, so AGPL obligation does not trigger.

These ship together because IAL2 gates e-sign by design. Shipping e-sign without IAL2 produces SBA-noncompliant signatures. Shipping IAL2 without e-sign produces verified identities with nothing to sign.

## Build principles captured

**#17 — IAL2 is a hard gate, not an advisory.** No SBA form ever gets signed without a passing IAL2 verification linked via FK. The gate is enforced at signature-request time AND at completion-webhook time (defense in depth).

**#18 — Vendor neutrality from day one.** Per-tenant vendor configuration in `banks.settings`. v1 supports Persona; the schema and service layer accommodate Stripe Identity, Veriff, Jumio without restructure.

**#19 — DocuSeal embeds as a service.** No fork. No modifications. AGPL obligation does not trigger. If we ever need to modify DocuSeal source, that's a separate spec with legal review attached.

---

## Pre-implementation verification (PIV)

### PIV-1 — S2 forms shipped
Confirm `src/lib/sba/forms/form1919/` and `form413/` exist with `build.ts`. If not, S2 isn't merged yet — block.

### PIV-2 — Confirm `bank_user_memberships` shape
RLS policies in this spec depend on it. Check column types match existing pattern (`m.user_id = auth.uid()`).

### PIV-3 — Confirm Supabase Storage buckets configured
This sprint creates a `signed-documents` bucket. Verify:
```sql
SELECT name, public FROM storage.buckets;
```
Bucket name available; service-role write only.

### PIV-4 — Confirm GCP project + Artifact Registry
Per memory: `us-central1-docker.pkg.dev/buddy-the-underwriter/buddy-workers/`. Confirm:
```sh
gcloud artifacts repositories describe buddy-workers --location=us-central1 --project=buddy-the-underwriter
```
Confirm Cloud Run admin permissions for the deployer.

### PIV-5 — Confirm Persona account access
Persona dashboard access required to:
- Generate API key (`PERSONA_API_KEY`)
- Generate webhook secret (`PERSONA_WEBHOOK_SECRET`)
- Create IAL2 inquiry template; capture template ID (`PERSONA_TEMPLATE_ID_IAL2`)

If Persona account doesn't yet exist: surface. Account setup is a 1–2 day procurement step.

### PIV-6 — Confirm DocuSeal version + license
DocuSeal latest stable as of execution: docusealco/docuseal@latest. AGPL-3.0. Embed-as-service does not trigger obligation. Document this decision in `infrastructure/docuseal/README.md`.

---

## What's in scope

### A. Persona IAL2 integration

#### A-1. `supabase/migrations/20260512_borrower_identity_verifications.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.borrower_identity_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  ownership_entity_id uuid NOT NULL REFERENCES public.ownership_entities(id) ON DELETE CASCADE,

  vendor text NOT NULL DEFAULT 'persona'
    CHECK (vendor IN ('persona','stripe_identity','jumio','veriff')),
  vendor_inquiry_id text NOT NULL,
  vendor_template_id text,
  vendor_session_token_hash text,

  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','pending','completed','approved','failed','expired','declined','needs_review')),
  status_reason text,

  -- IAL2 evidence (references; full artifacts at vendor)
  id_document_type text,    -- 'drivers_license'|'passport'|'state_id'
  id_document_country text, -- ISO 3166
  id_document_state text,
  id_document_first_name text,
  id_document_last_name text,
  id_document_dob_year integer,  -- year only; full DOB at vendor

  selfie_match_score numeric,
  liveness_passed boolean,

  -- Storage refs (never raw images on Buddy side)
  id_image_storage_path text,
  selfie_image_storage_path text,
  vendor_artifacts_url text,  -- Persona inquiry URL for examiner audit

  initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  initiator_user_id text,
  initiator_ip text,
  initiator_user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, ownership_entity_id, vendor_inquiry_id)
);

CREATE INDEX idx_biv_deal ON public.borrower_identity_verifications(deal_id);
CREATE INDEX idx_biv_entity ON public.borrower_identity_verifications(ownership_entity_id);
CREATE INDEX idx_biv_status_pending ON public.borrower_identity_verifications(status)
  WHERE status IN ('created','pending');
CREATE INDEX idx_biv_completed ON public.borrower_identity_verifications(deal_id, ownership_entity_id, completed_at DESC)
  WHERE status IN ('completed','approved');

ALTER TABLE public.borrower_identity_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY biv_deny ON public.borrower_identity_verifications
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY biv_select_bank ON public.borrower_identity_verifications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.bank_user_memberships m
      WHERE m.bank_id=borrower_identity_verifications.bank_id AND m.user_id=auth.uid())
  );

DROP TRIGGER IF EXISTS trg_biv_updated_at ON public.borrower_identity_verifications;
CREATE TRIGGER trg_biv_updated_at BEFORE UPDATE ON public.borrower_identity_verifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.borrower_identity_verifications IS
  'IAL2 identity verification artifacts per ownership_entity per deal. Required gate for SBA e-signature per SOP 50 10 8 Appendix 10.';

COMMIT;
```

#### A-2. `src/lib/identity/kyc/persona.ts` — vendor client

Pure HTTP wrapper around Persona REST API (`https://api.withpersona.com/api/v1`). Functions:
- `createPersonaInquiry({ templateId, referenceId, fields })` — POST `/inquiries`. `referenceId` = `deal:${dealId}:owner:${ownershipEntityId}` for unambiguous webhook routing
- `fetchPersonaInquiry(inquiryId)` — GET `/inquiries/{id}`. Used in webhook handler to refetch canonical state
- `generatePersonaOneTimeLink(inquiryId)` — POST `/inquiries/{id}/one-time-link`. For embedded flow; expires after single use

Auth: `Authorization: Bearer ${PERSONA_API_KEY}` + `Persona-Version: 2023-01-05` headers. Response validation via zod.

#### A-3. `src/lib/identity/kyc/service.ts` — orchestration

Three exports:

**`initiateKyc({ dealId, bankId, ownershipEntityId, initiatorUserId, initiatorIp, initiatorUserAgent })`**

Idempotency: if existing `borrower_identity_verifications` row with status in `('created','pending')` exists for `(dealId, ownershipEntityId)`, return it (`reused: true`). No new Persona call.

Otherwise:
1. Fetch owner from `ownership_entities` (`display_name, evidence_json`)
2. Call `createPersonaInquiry` with prefill from display_name split (`name_first` + `name_last`)
3. Insert `borrower_identity_verifications` row
4. Insert `deal_event` with `event_type: 'kyc.verification_initiated'`
5. Return `{ ok: true, verification, reused: false }`

Returns `{ ok: false, reason: 'OWNER_NOT_FOUND' | 'DB_INSERT_FAILED' }` on failures.

**`handlePersonaWebhook(payload)`**

1. Extract `inquiry_id` from payload — fail closed if absent (`MISSING_INQUIRY_ID`)
2. Refetch the inquiry from Persona — never trust webhook payload alone (replay safety)
3. Find `borrower_identity_verifications` row by `vendor_inquiry_id`
4. Update `status`, `status_reason`. If status in `('completed','approved')`, also set `completed_at`, `id_document_first_name`, `id_document_last_name`, `id_document_dob_year`, `selfie_match_score`, `liveness_passed`
5. Insert `deal_event` with `event_type: kyc.verification_${status}`
6. Return `{ ok: true, verification_id, status }`

**`hasValidIal2(dealId, ownershipEntityId): Promise<boolean>`**

Returns true iff a row exists with `status IN ('completed','approved')` AND `completed_at IS NOT NULL` for the given `(dealId, ownershipEntityId)`. Used as the gate in S3 e-sign and S4 4506-C signing.

#### A-4. API routes

- `POST /api/deals/[dealId]/kyc/initiate` — body `{ ownership_entity_id }`; calls `initiateKyc`; returns verification + Persona one-time link
- `GET /api/deals/[dealId]/kyc/status/[ownershipEntityId]` — returns latest verification record + status
- `POST /api/kyc/persona/webhook` — verifies Persona signature using `PERSONA_WEBHOOK_SECRET`; calls `handlePersonaWebhook`; returns 200 on success, 4xx on signature failure

All `runtime = "nodejs"`, `maxDuration = 30`. Webhook signature uses Persona's HMAC-SHA256 pattern: header `Persona-Signature` is `t=<timestamp>,v1=<hex>`. Verify via constant-time compare of `HMAC(secret, "${t}.${rawBody}")`.

#### A-5. `src/lib/identity/kyc/__tests__/service.test.ts`

Cases (mocked Persona client + supabase):
- `initiateKyc` no existing → creates new + writes deal_event
- `initiateKyc` existing pending → reuses, no API call
- `initiateKyc` missing owner → `OWNER_NOT_FOUND`
- `handlePersonaWebhook` `status=completed` → updates record, sets `completed_at`
- `handlePersonaWebhook` `status=declined` → updates record, no `completed_at`
- `handlePersonaWebhook` missing inquiry_id → `MISSING_INQUIRY_ID`
- `hasValidIal2` with completed → `true`
- `hasValidIal2` with only pending → `false`
- `hasValidIal2` with declined → `false`

### B. DocuSeal deployment

#### B-1. `infrastructure/docuseal/Dockerfile`

```dockerfile
FROM docusealco/docuseal:latest
ENV PORT=3000
ENV RAILS_ENV=production
ENV FORCE_SSL=true
EXPOSE 3000
```

Pin to specific tag (e.g. `docusealco/docuseal:1.8.4`) at execution time; `:latest` here is for spec readability. Use the most recent stable tag at the time of build.

#### B-2. `infrastructure/docuseal/cloudrun.yaml`

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: buddy-docuseal
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        run.googleapis.com/cpu-throttling: "false"
    spec:
      containers:
      - image: us-central1-docker.pkg.dev/buddy-the-underwriter/buddy-workers/docuseal:<tag>
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: docuseal-database-url
              key: latest
        - name: SECRET_KEY_BASE
          valueFrom:
            secretKeyRef:
              name: docuseal-secret-key-base
              key: latest
        - name: HOST
          value: docuseal.buddytheunderwriter.com
        resources:
          limits:
            memory: 1Gi
            cpu: '1'
```

`min_machines_running=1` to avoid cold-start delays during signing ceremonies. Cost: roughly $20–30/month per Cloud Run instance.

#### B-3. `infrastructure/docuseal/README.md` — deployment runbook

Sections:
- Build + push to Artifact Registry
- Deploy via `gcloud run services replace cloudrun.yaml`
- Domain mapping: `docuseal.buddytheunderwriter.com` via GoDaddy DNS pointing to Cloud Run
- Database provisioning: separate Supabase project OR separate schema in existing Buddy Supabase. RLS does NOT apply (DocuSeal owns its own tables — no Buddy data lives there)
- Secrets: `DATABASE_URL`, `SECRET_KEY_BASE`, `DOCUSEAL_API_TOKEN` (generated via DocuSeal admin UI; stored in Buddy Vercel env)
- Template upload: SBA form templates uploaded once via DocuSeal admin UI. Template IDs captured in env for resolution by `docuseal/service.ts`
- AGPL-3.0 license note: embed-as-service via REST API + iframe; no fork or modification; AGPL obligation does not trigger. **If DocuSeal source is ever modified, that requires a separate spec with legal review.**

#### B-4. `supabase/migrations/20260513_signed_documents.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.signed_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  form_code text NOT NULL,         -- 'FORM_1919'|'FORM_413'|'FORM_4506C'|...
  template_version text NOT NULL,

  signer_ownership_entity_id uuid REFERENCES public.ownership_entities(id),
  signer_role text NOT NULL
    CHECK (signer_role IN ('applicant','guarantor','spouse','agent','witness')),

  -- IAL2 evidence chain — REQUIRED, no exceptions
  identity_verification_id uuid NOT NULL
    REFERENCES public.borrower_identity_verifications(id),

  docuseal_submission_id text NOT NULL,
  docuseal_submitter_id text NOT NULL,

  signed_pdf_storage_path text NOT NULL,
  audit_trail_storage_path text NOT NULL,

  signature_request_sent_at timestamptz NOT NULL,
  signature_completed_at timestamptz NOT NULL,

  -- SBA form staleness (90 days for 1919/413; 120 for 4506-C)
  staleness_window_days integer NOT NULL DEFAULT 90,
  expires_at timestamptz NOT NULL,

  signer_ip text,
  signer_user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, form_code, signer_ownership_entity_id, signature_completed_at)
);

CREATE INDEX idx_sd_deal ON public.signed_documents(deal_id);
CREATE INDEX idx_sd_form ON public.signed_documents(deal_id, form_code);
CREATE INDEX idx_sd_signer ON public.signed_documents(signer_ownership_entity_id);
CREATE INDEX idx_sd_expiring ON public.signed_documents(expires_at)
  WHERE expires_at > NOW();

ALTER TABLE public.signed_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY sd_deny ON public.signed_documents FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY sd_select_bank ON public.signed_documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=signed_documents.bank_id AND m.user_id=auth.uid())
);

COMMENT ON TABLE public.signed_documents IS
  'Executed SBA form signatures. Every row references the IAL2 verification that gated the ceremony. SOP 50 10 8 Appendix 10 compliance artifact.';

COMMIT;
```

Plus storage bucket creation:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signed-documents', 'signed-documents', false, 52428800, ARRAY['application/pdf','application/json'])
ON CONFLICT (id) DO NOTHING;
```

#### B-5. `src/lib/esign/docuseal/client.ts` — vendor client

Functions:
- `createDocusealSubmission({ templateId, submitters, externalId, sendEmail, signOrdered })` — POST `/submissions`
- `fetchDocusealSubmission(submissionId)` — GET `/submissions/{id}`
- `downloadDocusealSignedPdf(submissionId, documentName)` — fetches the document URL from submission detail; returns `Buffer`

Auth: `X-Auth-Token: ${DOCUSEAL_API_TOKEN}` header. Response validation via zod.

#### B-6. `src/lib/esign/docuseal/service.ts` — orchestration

**This is where the IAL2 gate lives.**

**`requestSignature({ dealId, bankId, formCode, templateVersion, signerOwnershipEntityId, signerRole, signerEmail, signerName, prefillFields })`**

1. **IAL2 GATE:** call `hasValidIal2(dealId, signerOwnershipEntityId)`. If false, return `{ ok: false, reason: 'IAL2_NOT_COMPLETED' }`. **No exceptions.**
2. Fetch the verification record's `id` to attach to `signed_documents` later
3. Resolve DocuSeal `template_id` from `(formCode, templateVersion)` via env-config map
4. Call `createDocusealSubmission` with `externalId: deal:${dealId}:form:${formCode}:signer:${signerOwnershipEntityId}` for unambiguous webhook routing
5. Insert `deal_event` with `event_type: 'esign.requested'` and event_data including `identity_verification_id`
6. Return `{ ok: true, submission_id, embed_url }`

**`handleDocusealWebhook(payload)`**

1. Extract `event_type`. Ignore non-`form.completed` events — return `{ ok: true, ignored: true }`
2. Extract `external_id`, parse via regex `/^deal:([^:]+):form:([^:]+):signer:([^:]+)$/`. Fail closed on malformed (`MALFORMED_EXTERNAL_ID`)
3. **Re-confirm IAL2 still holds at completion time** (defense in depth). If not, write `deal_event` `esign.completed_without_ial2_anomaly` with full payload and return `{ ok: false, reason: 'IAL2_GATE_FAILED_AT_COMPLETION' }`. Do NOT persist to `signed_documents`.
4. Fetch submission detail from DocuSeal
5. Lookup `deal.bank_id` and the IAL2 `verification_id`
6. Download signed PDF + audit trail to Supabase Storage at `signed-documents/${dealId}/${formCode}/${ownershipEntityId}/${submissionId}.pdf` and `...-audit.json`
7. Insert `signed_documents` row with all fields populated. `expires_at = completed_at + staleness_window_days * 24h`
8. Insert `deal_event` `event_type: 'esign.completed'`
9. Return `{ ok: true }`

Helpers:
- `resolveTemplateId(formCode, templateVersion)` — returns env var value or throws `docuseal_template_not_configured`
- `formStalenessDays(formCode)` — 90 for FORM_1919/FORM_413, 120 for FORM_4506C, 365 default
- `buildEmbedUrl(submissionId)` — `${DOCUSEAL_BASE_URL_PUBLIC}/s/${submissionId}` (note: PUBLIC variant for browser-facing URL)

#### B-7. API routes

- `POST /api/deals/[dealId]/esign/request` — body `{ form_code, template_version, signer_ownership_entity_id, signer_role, signer_email, signer_name }`; calls `requestSignature`. Form prefill data fetched from `inputBuilder` (S2)
- `GET /api/deals/[dealId]/esign/status/[submissionId]` — returns current submission status
- `POST /api/esign/docuseal/webhook` — verifies DocuSeal signature using `DOCUSEAL_WEBHOOK_SECRET`; calls `handleDocusealWebhook`

All `runtime = "nodejs"`, `maxDuration = 60`. Webhook fetches PDF + audit trail — needs the time.

#### B-8. `src/lib/esign/docuseal/__tests__/service.test.ts`

Cases (mocked DocuSeal + supabase):
- `requestSignature` no IAL2 → `IAL2_NOT_COMPLETED`
- `requestSignature` with IAL2 → creates submission + writes `esign.requested` event
- `handleDocusealWebhook` `event_type=form.viewed` → ignored
- `handleDocusealWebhook` `event_type=form.completed` without IAL2 → anomaly event + no `signed_documents` row
- `handleDocusealWebhook` `event_type=form.completed` with IAL2 → uploads PDF, writes `signed_documents`, fires `esign.completed`
- Malformed `external_id` → `MALFORMED_EXTERNAL_ID`
- `signed_documents.expires_at` correctly set: 90d for FORM_1919; 120d for FORM_4506C
- Storage upload failure → `PDF_UPLOAD_FAILED` + no `signed_documents` row (transactional invariant)

### C. Story tab integration

#### C-1. `src/components/deals/cockpit/SbaSigningPanel.tsx`

Renders inside Story tab (existing Phase 52 convention). Per-owner-per-form table:

```
Owner   | IAL2 Status | Form 1919 | Form 413 |
Alice   | ✓ Verified  | ✓ Signed  | ⏳ Send  |
Bob     | ⏳ Pending  | — Locked  | — Locked |
Carol   | ✗ Declined  | — Locked  | — Locked |
```

Buttons:
- "Start ID verification" — opens Persona embedded flow via `/api/deals/[dealId]/kyc/initiate`
- "Send for signature" — calls `/api/deals/[dealId]/esign/request`. Disabled when `hasValidIal2 = false`
- "View signed PDF" — opens signed PDF from Supabase Storage signed URL

#### C-2. Update S2's `SbaFormReadinessPanel`

The S2 panel had a placeholder "Sign Form 1919" button disabled with `title="Available after identity verification (Sprint 3)"`. Now it links to `SbaSigningPanel`.

#### C-3. `src/components/deals/cockpit/StoryPanel.tsx` — surgical addition

Add `<SbaSigningPanel />` after `<SbaFormReadinessPanel />`. Story tab convention preserved — no bolt-below-cockpit-page.

### D. Form staleness scheduler

#### D-1. Background job: re-check signature dates

`src/lib/jobs/staleSignatureChecker.ts`:

Pure function:
```ts
async function findStaleSignatures(): Promise<Array<{ deal_id, form_code, signer_id, expires_at, days_remaining }>>
```

Returns rows from `signed_documents` where `expires_at` is within 14 days. Used by:
- Cloud Run cron job (separate from franchise-sync-worker; new `buddy-staleness-checker` service) running daily at 6 AM CT
- Inserts `deal_gap_queue` row per finding so banker sees "Form 1919 expires in 8 days — re-sign before submission"

Spec out the worker but defer actual deployment to S5 if time-constrained — the migration + library function is enough for S3 to mark stale signatures correctly. Cron deployment can be a follow-up.

#### D-2. `src/lib/sba/forms/form1919/build.ts` and `form413/build.ts` — staleness-aware

Update build result to include:
```ts
signature: {
  has_valid_signature: boolean;       // signed_documents row exists with expires_at > NOW()
  signed_at: string | null;
  expires_at: string | null;
  needs_resignature: boolean;         // expires_at within 14d
}
```

Build function fetches latest `signed_documents` for `(deal_id, form_code, ownership_entity_id)` to compute. **This adds a DB call to a previously pure function** — split: `buildForm1919(input)` stays pure; `buildForm1919WithSignature(dealId)` adds the DB lookup.

---

## Tests required

| File | Coverage |
|---|---|
| `src/lib/identity/kyc/__tests__/service.test.ts` | 9 cases minimum |
| `src/lib/esign/docuseal/__tests__/service.test.ts` | 8 cases minimum |
| `src/lib/jobs/__tests__/staleSignatureChecker.test.ts` | 4 cases (within 14d, beyond 14d, expired, just-signed) |

Plus integration test for IAL2 → e-sign happy path (mocked external services):
- `src/__tests__/integration/sba-signing-flow.test.ts` — initiate KYC → webhook completes → request signature → webhook completes → `signed_documents` row exists

---

## Environment variables

Add to Vercel + `.env.example`:

```
PERSONA_API_KEY=
PERSONA_TEMPLATE_ID_IAL2=itmpl_
PERSONA_WEBHOOK_SECRET=

DOCUSEAL_BASE_URL=https://docuseal.buddytheunderwriter.com/api
DOCUSEAL_BASE_URL_PUBLIC=https://docuseal.buddytheunderwriter.com
DOCUSEAL_API_TOKEN=
DOCUSEAL_WEBHOOK_SECRET=
DOCUSEAL_TEMPLATE_FORM_1919=
DOCUSEAL_TEMPLATE_FORM_413=
```

Plus DocuSeal infra secrets (Cloud Run secrets, not Vercel):
- `docuseal-database-url`
- `docuseal-secret-key-base`

---

## Verification (V-3)

**V-3a — DocuSeal Cloud Run reachable**
```sh
curl -I https://docuseal.buddytheunderwriter.com
# Expect 200 or 302 (admin login redirect)
```

**V-3b — DocuSeal templates configured**
- Form 1919 template uploaded via DocuSeal admin UI
- Form 413 template uploaded
- Template IDs captured in Vercel env

**V-3c — Migrations applied**
```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('borrower_identity_verifications','signed_documents');
-- Expected: 2

SELECT id FROM storage.buckets WHERE id='signed-documents';
-- Expected: 1 row
```

**V-3d — End-to-end IAL2 (Persona sandbox)**
1. POST `/api/deals/<test-deal>/kyc/initiate` → returns verification + one-time link
2. Open one-time link in test browser; complete Persona sandbox flow
3. Webhook fires; `borrower_identity_verifications.status='completed'`
4. `deal_events` shows `kyc.verification_initiated` + `kyc.verification_completed`

**V-3e — End-to-end e-sign (DocuSeal)**
1. With completed IAL2, POST `/api/deals/<test-deal>/esign/request` form_code=FORM_1919 → returns `embed_url`
2. Open embed_url; sign in DocuSeal flow
3. Webhook fires; `signed_documents` row created
4. Signed PDF retrievable from Supabase Storage
5. Audit trail PDF retrievable from Supabase Storage

**V-3f — IAL2 gate enforcement**
- Without IAL2: POST `/api/deals/<test-deal>/esign/request` → 4xx with `IAL2_NOT_COMPLETED`
- With declined IAL2: same response

**V-3g — Defense-in-depth gate**
Bypass IAL2 check at request time (developer test). Webhook still fires for completed signature. `deal_events` shows `esign.completed_without_ial2_anomaly`. `signed_documents` row NOT created.

**V-3h — Staleness logic**
- New signature → `expires_at = completed_at + 90d` for FORM_1919
- Mock `signed_documents.expires_at` to NOW + 10d → `findStaleSignatures()` returns it
- Mock to NOW + 100d → not returned

**V-3i — `tsc --noEmit` clean, `vitest run` clean, integration test passes**

**V-3j — GitHub API verification**
All spec'd files exist on `main`.

---

## Non-goals

- Multi-vendor live support (schema accommodates Stripe Identity / Veriff / Jumio; only Persona implemented in v1)
- Custom e-sign UI — DocuSeal embed only
- Forms 4506-C, 912, 155, 159 (S4)
- 4506-C IRS submission (S4)
- E-Tran final-form signing (S5)
- Closing notes, security agreements (out of pack scope)
- KMS-managed Plaid token encryption (S5 if time; otherwise separate sprint)

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | Persona pricing surprises (~$1.50–3 per IAL2 verification) | Medium | Per-tenant Persona credentials in v2; v1 monitors usage; cost reporting in admin dashboard |
| 2 | DocuSeal AGPL — accidental modification triggers obligation | Low | Run unmodified container; document in B-3 README; require legal review for any source change |
| 3 | DocuSeal Cloud Run cold starts during signing ceremony | Low | `min_machines_running=1` in cloudrun.yaml (~$25/mo) |
| 4 | DocuSeal version drift (we run a fork that's ahead/behind upstream) | Medium | Pin tag in Dockerfile; document version in `infrastructure/docuseal/README.md`; review on every quarterly upgrade |
| 5 | Persona webhook signature replay | Low | Each webhook re-fetches inquiry from Persona for canonical state — replays update record idempotently |
| 6 | DocuSeal external_id format changes | Low | Format owned by us (we set it); regex parse fails closed |
| 7 | Owner has Persona inquiry ID across multiple deals (data leak) | Low | `vendor_inquiry_id` is per-Buddy-deal; we never reuse across deals. RLS prevents cross-tenant read |
| 8 | Borrower abandons IAL2 mid-flow | High | `borrower_identity_verifications.status='pending'` rows persist; UI surfaces "complete your verification" prompt; idempotency in `initiateKyc` returns existing record on retry |
| 9 | DocuSeal database is separate Postgres — schema drift, backup strategy | Medium | Document in B-3 README. Backup cadence matches Buddy primary DB |
| 10 | Pulse fastlane noise from new event types | Medium | New events: `kyc.verification_initiated`, `kyc.verification_${status}`, `esign.requested`, `esign.completed`, `esign.completed_without_ial2_anomaly`. Each emits `pulse.forwarding_failed` once until D3 ships |

---

## Hand-off commit message

```
spec(sba-30min-package/s3): IAL2 (Persona) + DocuSeal e-signature

- Migration 20260512: borrower_identity_verifications table
- Migration 20260513: signed_documents table + signed-documents storage bucket
- src/lib/identity/kyc/: persona client + service (initiateKyc, webhook, hasValidIal2)
- src/lib/esign/docuseal/: client + service (requestSignature with IAL2 gate, webhook with defense-in-depth re-check)
- 3 KYC routes + 3 e-sign routes
- infrastructure/docuseal/: Dockerfile + cloudrun.yaml + deployment runbook
- SbaSigningPanel in Story tab
- Form 1919/413 build results extended with signature staleness
- Stale-signature checker library function (cron deployment optional)
- 8+9+4 test cases + 1 integration test

Verification: V-3a through V-3j
Spec: specs/sba-30min-package/SPEC-S3-identity-and-esign.md
```

---

## Addendum for Claude Code

**Judgment boundaries:**

- If PIV-5 reveals no Persona account → surface. Account procurement is out of executor scope. Block until Matt provisions
- If PIV-4 reveals no Cloud Run admin permissions → surface. Provisioning permissions out of executor scope
- DocuSeal production deployment is out of executor scope unless GCP credentials available. Acceptable: Dockerfile + cloudrun.yaml + README committed; actual deployment by Matt or a separate ops handoff
- If `pdf-lib` AcroForm filling worked in S2 but DocuSeal needs different prefill format → adapt prefill data shape in `requestSignature` payload. DocuSeal accepts `fields` array per submitter; map S2 `Form1919Input` fields accordingly
- Staleness checker cron deployment optional in this sprint. Library function + tests are mandatory. Cron deployment in S5 if time
- If PIV-1 reveals S2 hasn't merged → block. Don't ship S3 against missing forms
- IAL2 gate is non-negotiable. The `requestSignature` IAL2 check is a hard gate. The webhook IAL2 re-check is also a hard gate. Both must remain in code regardless of test convenience. Surface and discuss before any change that weakens either gate
- DocuSeal source modification: do not modify upstream DocuSeal source. Embed-as-service only. If Persona's prefill behavior requires DocuSeal customization → surface; that's a separate spec with legal review

**Pulse fastlane:** new event types — see risk #10. Strongly recommend D3 silence ships before this sprint, alongside, or accept noisy ledger until D3 lands.

**Legal review note:** AGPL-3.0 compliance for DocuSeal-as-service is settled by FSF guidance — running an unmodified AGPL-licensed program as a service does not trigger the source-disclosure obligation. Document this position in `infrastructure/docuseal/README.md`. If at any point we modify DocuSeal source, that's a separate spec with general counsel review attached. **Do not modify DocuSeal source under any circumstance in this sprint.**
