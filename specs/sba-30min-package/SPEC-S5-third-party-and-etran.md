# SPEC S5 — Third-Party Orchestration + Real E-Tran Submission

**Date:** 2026-04-25 · **Owner:** Architecture (Matt) · **Executor:** Claude Code · **Effort:** 1.5–2 weeks · **Risk:** Medium-high (per-tenant cert handling; SBA E-Tran sandbox certification)

**Depends on:** S1 (rule triggers), S3 (e-sign for SBA forms), S4 (signed 4506-C must precede E-Tran submission)

**Blocks:** Nothing — closing sprint of the pack.

---

## Background

Two pieces close the loop on the 30-minute experience:

1. **Third-party orchestration.** Buddy *orchestrates* third parties — appraisal, business valuation, Phase I environmental, hazard insurance, life insurance, title commitment, UCC searches — but doesn't perform their work. Holds the relationships, manages order/intake/ingest, presents unified status to borrower and lender. Currently nothing exists. MVP: "Buddy emails the vendor with order details, banker confirms, ingest is by PDF upload." Auto-API integrations come later per vendor.

2. **Real E-Tran submission.** S1 fixed the guarantee bug; XML generation already works. What's still mocked: the actual SBA E-Tran API call. `submitETranXML` returns `SBA-${Date.now()}` as a fake number. Real E-Tran is XML-over-HTTPS with mutual TLS; lender certs are issued by SBA to each bank tenant. Per-tenant cert storage required. Human-approval gate stays — auto-submission is never enabled (SR 11-7 wall).

Plus closing items: cron deployments deferred from S3/S4, and the package PDF assembly that walks through all 7 forms in the SBA 10-tab structure.

## Build principles captured

**#24 — Buddy orchestrates third parties; never performs.** Phase I, appraisal, valuation — banks have approved-vendor lists. We dispatch orders with the right info and ingest results. We don't perform environmental assessments or value businesses ourselves.

**#25 — E-Tran human-approval gate is permanent.** Banker clicks submit. No "auto-submit when green." The bank decides; Buddy prepares.

**#26 — Per-tenant SBA certs are encrypted at rest, never in logs.** Bank lender ID + cert lives in dedicated table, encrypted via pgcrypto. Never logged. Never returned in API responses. Rotation runbook documented.

**#27 — Trigger engine drives third-party orders, not banker memory.** Real estate in collateral → appraisal triggered. NAICS in Appendix 6 → Phase I triggered. Acquisition + Standard 7(a) → business valuation triggered. Loan > $50K → hazard insurance required. Each trigger creates a `third_party_orders` row in `triggered` state; banker reviews + dispatches.

---

## Pre-implementation verification (PIV)

### PIV-1 — S1 + S3 + S4 shipped
- S1: 22 SOP 50 10 8 rules active
- S3: `signed_documents` table + e-sign service operational
- S4: `borrower_irs_transcript_requests` + signed 4506-C path operational

If any unmerged → block.

### PIV-2 — `banks.settings` schema
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='banks' AND column_name='settings';
```
Confirm `settings` is `jsonb`. This sprint adds keys under it: `approved_appraisers`, `approved_valuators`, `approved_environmental_consultants`, `approved_title_companies`. SBA cert storage uses a dedicated table, NOT `banks.settings`.

If `banks.settings` doesn't exist → add `20260605_a_banks_settings_column.sql` to create it.

### PIV-3 — pgcrypto extension
```sql
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto');
-- Expected: true (commonly enabled)
```
If false → migration enables it.

### PIV-4 — SBA E-Tran sandbox access
SBA provides sandbox endpoint for E-Tran testing. Sandbox lender ID + cert required for verification. **Surface if not yet provisioned — sandbox cert request takes 1–2 weeks.** Develop against mock endpoint until cert arrives.

### PIV-5 — NAICS Appendix 6 list
SOP 50 10 8 Appendix 6 lists environmentally-sensitive NAICS codes that trigger Phase I. Source from SBA. Commit to `src/lib/sba/data/naicsAppendix6.ts` as a static array.

### PIV-6 — Existing `etran/generator.ts` post-S1
Confirm S1 fix landed: `calculateSBAGuarantee` import + usage; no hardcoded 75. Verify before extending submission code.

---

## What's in scope

### A. Third-party orchestration

#### A-1. `supabase/migrations/20260605_b_third_party_orders.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.third_party_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  vendor_type text NOT NULL CHECK (vendor_type IN (
    'appraiser','business_valuator','environmental_consultant',
    'insurance_carrier','title_company','ucc_search_service'
  )),
  legal_name text NOT NULL,
  contact_email text,
  contact_phone text,
  service_regions text[],
  certifications text[],

  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tpv_bank ON public.third_party_vendors(bank_id, vendor_type)
  WHERE is_active;

ALTER TABLE public.third_party_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tpv_deny ON public.third_party_vendors FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY tpv_select_bank ON public.third_party_vendors FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=third_party_vendors.bank_id AND m.user_id=auth.uid())
);

CREATE TABLE IF NOT EXISTS public.third_party_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  order_type text NOT NULL CHECK (order_type IN (
    'real_estate_appraisal','business_valuation','phase_1_environmental',
    'phase_2_environmental','hazard_insurance','life_insurance',
    'title_commitment','ucc_lien_search'
  )),
  vendor_id uuid REFERENCES public.third_party_vendors(id),

  status text NOT NULL DEFAULT 'triggered' CHECK (status IN (
    'triggered','dispatched','in_progress','delivered','parsed','cancelled'
  )),

  trigger_reason text,
  triggered_at timestamptz NOT NULL DEFAULT now(),

  order_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordered_at timestamptz,
  ordered_by_user_id text,
  expected_completion_at timestamptz,
  estimated_cost numeric,

  delivered_at timestamptz,
  result_storage_path text,
  result_parsed_json jsonb,
  parsed_at timestamptz,

  cancellation_reason text,
  cancelled_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tpo_deal ON public.third_party_orders(deal_id);
CREATE INDEX idx_tpo_pending ON public.third_party_orders(deal_id, status)
  WHERE status IN ('triggered','dispatched','in_progress','delivered');
CREATE INDEX idx_tpo_overdue ON public.third_party_orders(expected_completion_at)
  WHERE status IN ('dispatched','in_progress') AND expected_completion_at IS NOT NULL;

ALTER TABLE public.third_party_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tpo_deny ON public.third_party_orders FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY tpo_select_bank ON public.third_party_orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=third_party_orders.bank_id AND m.user_id=auth.uid())
);

DROP TRIGGER IF EXISTS trg_tpv_updated_at ON public.third_party_vendors;
CREATE TRIGGER trg_tpv_updated_at BEFORE UPDATE ON public.third_party_vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_tpo_updated_at ON public.third_party_orders;
CREATE TRIGGER trg_tpo_updated_at BEFORE UPDATE ON public.third_party_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
```

#### A-2. `src/lib/sba/data/naicsAppendix6.ts`

Static set of NAICS codes that trigger Phase I per SOP 50 10 8 Appendix 6. Categories: chemical/petroleum manufacturing, auto-related (gas stations, repair, body shops), dry cleaning, photo processing, mining/quarrying, agriculture with chemical use, metal plating/finishing, printing operations.

```ts
export const NAICS_PHASE_1_TRIGGER_CODES: ReadonlySet<string> = new Set([
  // Source codes from SOP 50 10 8 Appendix 6 — populate from SBA PDF
  // Sample subset — full list mechanical from appendix:
  '324110','325211','331110',         // chemical/petroleum/metals mfg
  '447110','447190',                  // gas stations
  '811111','811121','811198',         // auto repair / body shops
  '812320',                            // dry cleaning
  '212000','213000',                   // mining
  '111110','111150',                   // chemical-using agriculture
  // ... full list expands from appendix
]);

export function isPhase1TriggerNaics(code: string | null | undefined): boolean {
  if (!code) return false;
  return NAICS_PHASE_1_TRIGGER_CODES.has(code);
}
```

Mechanical population from PDF; ship reasonable subset; surface incompleteness for follow-up.

#### A-3. `src/lib/sba/thirdPartyTriggers.ts` — pure trigger engine

```ts
export type ThirdPartyOrderType =
  | 'real_estate_appraisal' | 'business_valuation'
  | 'phase_1_environmental' | 'phase_2_environmental'
  | 'hazard_insurance' | 'life_insurance'
  | 'title_commitment' | 'ucc_lien_search';

export interface ThirdPartyTriggerInput {
  dealId: string;
  loanAmount: number;
  loanProgram: string;       // sba_7a_standard|sba_7a_express|sba_504|...
  isAcquisition: boolean;
  isSingleOwnerBusiness: boolean;
  loanFullySecuredByHardCollateral: boolean;
  realEstateInUseOfProceeds: boolean;
  businessNaics: string | null;
}

export interface ThirdPartyTriggerResult {
  order_type: ThirdPartyOrderType;
  trigger_reason: string;
  required: boolean;
  expected_completion_days: number;
}

export function evaluateThirdPartyTriggers(input: ThirdPartyTriggerInput): ThirdPartyTriggerResult[] {
  const out: ThirdPartyTriggerResult[] = [];

  if (input.realEstateInUseOfProceeds) {
    out.push({ order_type: 'real_estate_appraisal',
      trigger_reason: 'Real estate in use of proceeds',
      required: true, expected_completion_days: 18 });
    out.push({ order_type: 'title_commitment',
      trigger_reason: 'Real estate in use of proceeds',
      required: true, expected_completion_days: 14 });
  }

  if (input.isAcquisition && input.loanProgram === 'sba_7a_standard') {
    out.push({ order_type: 'business_valuation',
      trigger_reason: 'Acquisition deal under Standard 7(a)',
      required: true, expected_completion_days: 21 });
  }

  if (isPhase1TriggerNaics(input.businessNaics)) {
    out.push({ order_type: 'phase_1_environmental',
      trigger_reason: `NAICS ${input.businessNaics} on Appendix 6 list`,
      required: true, expected_completion_days: 28 });
  }

  if (input.loanAmount > 50_000) {
    out.push({ order_type: 'hazard_insurance',
      trigger_reason: 'Loan amount > $50K',
      required: true, expected_completion_days: 5 });
  }

  if (input.loanAmount > 350_000 && input.isSingleOwnerBusiness
      && !input.loanFullySecuredByHardCollateral) {
    out.push({ order_type: 'life_insurance',
      trigger_reason: 'Loan > $350K, single-owner, not fully secured',
      required: true, expected_completion_days: 10 });
  }

  // UCC lien search always required
  out.push({ order_type: 'ucc_lien_search',
    trigger_reason: 'Required for all 7(a) loans',
    required: true, expected_completion_days: 3 });

  return out;
}
```

#### A-4. `src/lib/thirdParty/orchestrator.ts` — service

Functions:
- `evaluateAndCreateTriggers(dealId)` — calls trigger engine; idempotently creates `third_party_orders` rows in status='triggered'. Idempotency: skip if active row of same `order_type` already exists (any status except `cancelled`)
- `dispatchOrder({ orderId, vendorId, orderedByUserId, orderMetadata })` — moves to status='dispatched'; sends order email via existing email infrastructure; inserts `deal_event` `third_party.order_dispatched`
- `ingestResult({ orderId, file, resultParsedJson? })` — uploads PDF to `third-party-results` storage bucket; sets status='delivered'; if `resultParsedJson` provided, also sets `parsed_at` + status='parsed'
- `cancelOrder({ orderId, reason })` — status='cancelled' with reason

#### A-5. Email-the-vendor pattern

For v1, dispatch is "Buddy emails the vendor with order details, banker confirms email sent." Uses existing email infrastructure. Per-vendor templates at `src/lib/thirdParty/emailTemplates/`:
- `appraisal-order.eml.ts`
- `valuation-order.eml.ts`
- `environmental-order.eml.ts`
- `title-commitment-order.eml.ts`
- `ucc-search-order.eml.ts`
- `insurance-binder-request.eml.ts`

Each template takes vendor + deal data, produces subject + body + attachment list. Banker reviews + clicks "Send" — Buddy sends, then status='dispatched'.

Auto-API integrations per vendor are **explicitly out of scope for v1** — added later per vendor as relationships are established.

#### A-6. API routes

- `POST /api/deals/[dealId]/third-party/evaluate` — triggers evaluation; creates rows
- `GET /api/deals/[dealId]/third-party/orders` — lists orders for deal
- `POST /api/deals/[dealId]/third-party/orders/[orderId]/dispatch` — banker confirms dispatch
- `POST /api/deals/[dealId]/third-party/orders/[orderId]/ingest` — multipart upload of result PDF
- `POST /api/deals/[dealId]/third-party/orders/[orderId]/cancel` — cancel order
- `GET /api/banks/[bankId]/third-party/vendors` — list approved vendors per type
- `POST /api/banks/[bankId]/third-party/vendors` — banker adds vendor to approved list

All `runtime = "nodejs"`, `maxDuration = 60`.

#### A-7. Story tab integration

`src/components/deals/cockpit/SbaThirdPartyPanel.tsx` — new panel inside Story tab. Per-order table showing status, vendor, ETA, result link.

Banker clicks "Dispatch" → opens vendor picker (filtered to approved vendors for `vendor_type` + `service_region`). Confirms dispatch → email sent.

For "Delivered" orders: banker uploads result PDF + can ingest structured data (manual extraction or future Gemini-assisted parse).

Add `<SbaThirdPartyPanel />` to `StoryPanel.tsx` after `<SbaSigningPanel />`.

#### A-8. Tests

- `src/lib/sba/__tests__/thirdPartyTriggers.test.ts` — 8 cases covering each trigger condition + combined cases
- `src/lib/thirdParty/__tests__/orchestrator.test.ts` — 6 cases (evaluate creates rows / idempotent re-evaluation / dispatch / ingest / cancel / RLS isolation)

### B. Real E-Tran submission

#### B-1. `supabase/migrations/20260605_c_etran_credentials.sql`

```sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.bank_etran_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL UNIQUE REFERENCES public.banks(id) ON DELETE CASCADE,

  sba_lender_id text NOT NULL,
  sba_service_center text NOT NULL,

  client_cert_pem_encrypted bytea NOT NULL,
  client_key_pem_encrypted bytea NOT NULL,

  endpoint_environment text NOT NULL DEFAULT 'sandbox'
    CHECK (endpoint_environment IN ('sandbox','production')),

  cert_expires_at timestamptz,
  last_rotation_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_etran_credentials ENABLE ROW LEVEL SECURITY;
-- DENY ALL — only service role access. No row-level read for any user.
CREATE POLICY bec_deny ON public.bank_etran_credentials
  FOR ALL USING (false) WITH CHECK (false);

DROP TRIGGER IF EXISTS trg_bec_updated_at ON public.bank_etran_credentials;
CREATE TRIGGER trg_bec_updated_at BEFORE UPDATE ON public.bank_etran_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.etran_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  truth_snapshot_id uuid REFERENCES public.deal_truth_snapshots(id),

  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared','submitted','accepted','rejected','error')),
  status_reason text,

  xml_storage_path text NOT NULL,
  response_storage_path text,

  sba_application_number text,
  endpoint_environment text NOT NULL CHECK (endpoint_environment IN ('sandbox','production')),

  approved_by_user_id text NOT NULL,
  approved_at timestamptz NOT NULL,
  submitted_at timestamptz,
  responded_at timestamptz,

  validation_passed boolean NOT NULL,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,

  idempotency_key text NOT NULL UNIQUE,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_es_deal ON public.etran_submissions(deal_id);
CREATE INDEX idx_es_bank ON public.etran_submissions(bank_id, submitted_at DESC);

ALTER TABLE public.etran_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY es_deny ON public.etran_submissions FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY es_select_bank ON public.etran_submissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=etran_submissions.bank_id AND m.user_id=auth.uid())
);

DROP TRIGGER IF EXISTS trg_es_updated_at ON public.etran_submissions;
CREATE TRIGGER trg_es_updated_at BEFORE UPDATE ON public.etran_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
```

#### B-2. `supabase/migrations/20260605_d_etran_rpc.sql`

SECURITY DEFINER RPCs that wrap encrypt/decrypt + upsert. Service role only (RLS denies all on `bank_etran_credentials`; RPC bypasses via SECURITY DEFINER + explicit `SET search_path`).

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.etran_upsert_credentials(
  p_bank_id uuid,
  p_sba_lender_id text,
  p_sba_service_center text,
  p_client_cert_pem text,
  p_client_key_pem text,
  p_endpoint_environment text,
  p_cert_expires_at timestamptz,
  p_encryption_key text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.bank_etran_credentials (
    bank_id, sba_lender_id, sba_service_center,
    client_cert_pem_encrypted, client_key_pem_encrypted,
    endpoint_environment, cert_expires_at, last_rotation_at
  ) VALUES (
    p_bank_id, p_sba_lender_id, p_sba_service_center,
    pgp_sym_encrypt(p_client_cert_pem, p_encryption_key),
    pgp_sym_encrypt(p_client_key_pem, p_encryption_key),
    p_endpoint_environment, p_cert_expires_at, now()
  )
  ON CONFLICT (bank_id) DO UPDATE SET
    sba_lender_id = EXCLUDED.sba_lender_id,
    sba_service_center = EXCLUDED.sba_service_center,
    client_cert_pem_encrypted = EXCLUDED.client_cert_pem_encrypted,
    client_key_pem_encrypted = EXCLUDED.client_key_pem_encrypted,
    endpoint_environment = EXCLUDED.endpoint_environment,
    cert_expires_at = EXCLUDED.cert_expires_at,
    last_rotation_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.etran_get_credentials_decrypted(
  p_bank_id uuid,
  p_encryption_key text
) RETURNS TABLE (
  sba_lender_id text,
  sba_service_center text,
  client_cert_pem text,
  client_key_pem text,
  endpoint_environment text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    sba_lender_id,
    sba_service_center,
    pgp_sym_decrypt(client_cert_pem_encrypted, p_encryption_key)::text AS client_cert_pem,
    pgp_sym_decrypt(client_key_pem_encrypted, p_encryption_key)::text AS client_key_pem,
    endpoint_environment
  FROM public.bank_etran_credentials
  WHERE bank_id = p_bank_id;
$$;

REVOKE EXECUTE ON FUNCTION public.etran_upsert_credentials(uuid, text, text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.etran_get_credentials_decrypted(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.etran_upsert_credentials(uuid, text, text, text, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.etran_get_credentials_decrypted(uuid, text) TO service_role;

COMMIT;
```

#### B-3. `src/lib/etran/credentials.ts`

```ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface EtranCredentials {
  sba_lender_id: string;
  sba_service_center: string;
  client_cert_pem: string;
  client_key_pem: string;
  endpoint_environment: 'sandbox' | 'production';
}

export async function getEtranCredentials(bankId: string): Promise<EtranCredentials | null> {
  const sb = supabaseAdmin();
  const encryptionKey = process.env.ETRAN_CRED_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error('ETRAN_CRED_ENCRYPTION_KEY not configured');

  const { data, error } = await sb.rpc('etran_get_credentials_decrypted', {
    p_bank_id: bankId, p_encryption_key: encryptionKey,
  });
  if (error || !data || !data[0]) return null;
  return data[0] as EtranCredentials;
}

export async function storeEtranCredentials(args: {
  bankId: string;
  sbaLenderId: string;
  sbaServiceCenter: string;
  clientCertPem: string;
  clientKeyPem: string;
  endpointEnvironment: 'sandbox' | 'production';
  certExpiresAt: Date | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sb = supabaseAdmin();
  const encryptionKey = process.env.ETRAN_CRED_ENCRYPTION_KEY;
  if (!encryptionKey) return { ok: false, reason: 'ENCRYPTION_KEY_MISSING' };

  const { error } = await sb.rpc('etran_upsert_credentials', {
    p_bank_id: args.bankId,
    p_sba_lender_id: args.sbaLenderId,
    p_sba_service_center: args.sbaServiceCenter,
    p_client_cert_pem: args.clientCertPem,
    p_client_key_pem: args.clientKeyPem,
    p_endpoint_environment: args.endpointEnvironment,
    p_cert_expires_at: args.certExpiresAt?.toISOString() ?? null,
    p_encryption_key: encryptionKey,
  });
  if (error) return { ok: false, reason: 'DB_UPSERT_FAILED' };
  return { ok: true };
}
```

#### B-4. `src/lib/etran/submitter.ts` — real submission

Real SBA E-Tran POST with mutual TLS using Node `https` module:

```ts
import https from 'node:https';
import crypto from 'node:crypto';
import { generateETranXML } from "./generator";
import { getEtranCredentials } from "./credentials";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function submitToSba(args: {
  dealId: string; bankId: string; approvedByUserId: string;
}): Promise<
  | { ok: true; sba_application_number: string; submission_id: string }
  | { ok: false; reason: string; details?: string }
> {
  const sb = supabaseAdmin();

  // 1. Build XML (uses S1-fixed guarantee calc)
  const xmlResult = await generateETranXML({ dealId: args.dealId, bankId: args.bankId });
  if (!xmlResult.ready_for_review) {
    return { ok: false, reason: 'VALIDATION_FAILED',
      details: xmlResult.validation_errors.join(';') };
  }

  // 2. Pre-flight: required signed forms present + non-stale
  const required = ['FORM_1919','FORM_413','FORM_1920','FORM_4506C'];
  const { data: signed } = await sb.from('signed_documents')
    .select('form_code')
    .eq('deal_id', args.dealId)
    .gt('expires_at', new Date().toISOString());
  const present = new Set((signed ?? []).map(r => r.form_code));
  const missing = required.filter(c => !present.has(c));
  if (missing.length > 0) {
    return { ok: false, reason: 'REQUIRED_SIGNED_FORMS_MISSING',
      details: missing.join(',') };
  }

  // 3. Fetch credentials
  const creds = await getEtranCredentials(args.bankId);
  if (!creds) return { ok: false, reason: 'ETRAN_CREDENTIALS_MISSING' };

  // 4. Persist XML
  const xmlPath = `etran/${args.dealId}/${Date.now()}.xml`;
  await sb.storage.from('etran-submissions').upload(xmlPath, xmlResult.xml, {
    contentType: 'application/xml',
  });

  // 5. Idempotency
  const idempotencyKey = crypto.createHash('sha256')
    .update(`${args.dealId}:etran_submit:${xmlResult.xml}`)
    .digest('hex');

  // 6. Insert pre-call submission record
  const { data: submission, error: insertErr } = await sb
    .from('etran_submissions')
    .insert({
      deal_id: args.dealId, bank_id: args.bankId,
      status: 'prepared',
      xml_storage_path: xmlPath,
      endpoint_environment: creds.endpoint_environment,
      approved_by_user_id: args.approvedByUserId,
      approved_at: new Date().toISOString(),
      validation_passed: true,
      validation_errors: [],
      idempotency_key: idempotencyKey,
    })
    .select().single();

  if (insertErr) {
    // Idempotency replay — return existing
    if (insertErr.code === '23505') {
      const { data: existing } = await sb.from('etran_submissions')
        .select('*').eq('idempotency_key', idempotencyKey).single();
      if (existing?.sba_application_number) {
        return { ok: true,
          sba_application_number: existing.sba_application_number,
          submission_id: existing.id };
      }
    }
    return { ok: false, reason: 'DB_INSERT_FAILED', details: insertErr.message };
  }

  // 7. POST to SBA E-Tran
  const endpoint = creds.endpoint_environment === 'production'
    ? process.env.SBA_ETRAN_PROD_ENDPOINT!
    : process.env.SBA_ETRAN_SANDBOX_ENDPOINT!;

  try {
    const response = await postToSbaEtran({
      endpoint, xml: xmlResult.xml,
      clientCertPem: creds.client_cert_pem,
      clientKeyPem: creds.client_key_pem,
    });

    const respPath = `etran/${args.dealId}/${submission.id}-response.xml`;
    await sb.storage.from('etran-submissions').upload(respPath, response.body, {
      contentType: 'application/xml',
    });

    const sbaAppNumber = parseSbaApplicationNumber(response.body);

    await sb.from('etran_submissions').update({
      status: response.accepted ? 'accepted' : 'rejected',
      sba_application_number: sbaAppNumber,
      response_storage_path: respPath,
      submitted_at: new Date().toISOString(),
      responded_at: new Date().toISOString(),
      status_reason: response.accepted ? null : response.rejectionReason,
    }).eq('id', submission.id);

    await sb.from('deal_events').insert({
      deal_id: args.dealId, bank_id: args.bankId,
      event_type: response.accepted ? 'sba_application_submitted' : 'sba_application_rejected',
      event_data: {
        sba_application_number: sbaAppNumber,
        submission_id: submission.id,
        environment: creds.endpoint_environment,
      },
    });

    return response.accepted
      ? { ok: true, sba_application_number: sbaAppNumber!, submission_id: submission.id }
      : { ok: false, reason: 'SBA_REJECTED', details: response.rejectionReason };

  } catch (err: any) {
    await sb.from('etran_submissions').update({
      status: 'error', status_reason: err.message,
    }).eq('id', submission.id);
    return { ok: false, reason: 'NETWORK_ERROR', details: err.message };
  }
}

function postToSbaEtran(args: {
  endpoint: string; xml: string;
  clientCertPem: string; clientKeyPem: string;
}): Promise<{ accepted: boolean; body: string; rejectionReason?: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(args.endpoint);
    const req = https.request({
      method: 'POST', hostname: url.hostname, path: url.pathname, port: 443,
      cert: args.clientCertPem, key: args.clientKeyPem,
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(args.xml),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const accepted = res.statusCode === 200 && body.includes('<Status>Accepted</Status>');
        resolve({ accepted, body,
          rejectionReason: accepted ? undefined : extractRejectionReason(body) });
      });
    });
    req.on('error', reject);
    req.write(args.xml);
    req.end();
  });
}

function parseSbaApplicationNumber(xml: string): string | null {
  const match = xml.match(/<ApplicationNumber>([^<]+)<\/ApplicationNumber>/);
  return match ? match[1] : null;
}

function extractRejectionReason(xml: string): string {
  const match = xml.match(/<RejectionReason>([^<]+)<\/RejectionReason>/);
  return match ? match[1] : 'Unknown rejection reason';
}
```

#### B-5. Replace stub in `generator.ts`

Existing `submitETranXML` returns `SBA-${Date.now()}`. Replace with delegation:

```ts
import { submitToSba } from "./submitter";

export async function submitETranXML(params: {
  dealId: string; bankId: string; xml: string; approvedBy: string;
}): Promise<{ submitted: boolean; sba_application_number?: string; error?: string }> {
  const result = await submitToSba({
    dealId: params.dealId, bankId: params.bankId,
    approvedByUserId: params.approvedBy,
  });
  if (result.ok) {
    return { submitted: true, sba_application_number: result.sba_application_number };
  }
  return { submitted: false,
    error: `${result.reason}${'details' in result && result.details ? ': ' + result.details : ''}` };
}
```

Existing API route caller continues to work because the function signature is preserved.

#### B-6. Bank credential admin UI

`src/components/banks/EtranCredentialAdminPanel.tsx` — banker-admin-only panel. Banker uploads:
- SBA Lender ID
- Service Center (dropdown)
- Client cert PEM (file upload)
- Client key PEM (file upload)
- Cert expiration date
- Endpoint environment toggle (sandbox/production) — **explicit warning banner when production selected**

POSTs to `/api/banks/[bankId]/etran/credentials`, which calls `storeEtranCredentials`. Encryption happens in the RPC. PEM never logged. UI shows "Credentials configured (cert expires YYYY-MM-DD)" — never displays cert content.

Cert rotation runbook in `infrastructure/etran/CREDENTIAL_ROTATION.md`:
- Bank receives renewed cert from SBA
- Banker admin replaces via panel
- Old cert immediately superseded; new cert active on next submission
- Rotation event recorded in `bank_etran_credentials.last_rotation_at`
- Alerting: weekly job emits gap when `cert_expires_at < now() + interval '30 days'`

#### B-7. Tests

- `src/lib/etran/__tests__/submitter.test.ts` — 8 cases:
  - Validation fails → VALIDATION_FAILED
  - Required signed forms missing → REQUIRED_SIGNED_FORMS_MISSING
  - Credentials missing → ETRAN_CREDENTIALS_MISSING
  - SBA accepts → returns sba_application_number
  - SBA rejects → returns rejection reason
  - Network error → NETWORK_ERROR
  - Idempotent retry → existing submission_id
  - Sandbox vs production endpoint selection
- `src/lib/etran/__tests__/credentials.test.ts` — 4 cases:
  - Round-trip encrypt/decrypt
  - Missing encryption key → throws
  - Missing cred row → null
  - Upsert replaces existing

### C. Cron deployments

#### C-1. IRS polling cron (deferred from S4)

Vercel Cron preferred. `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/poll-irs-transcripts", "schedule": "*/30 * * * *" }
  ]
}
```
Route at `src/app/api/cron/poll-irs-transcripts/route.ts` — verifies Vercel Cron auth header, calls `pollPendingTranscripts()` from S4, returns count.

#### C-2. Stale signature checker cron (deferred from S3)

```json
{ "path": "/api/cron/check-stale-signatures", "schedule": "0 12 * * *" }
```
Daily at 6am CT (= 12 UTC). Calls `findStaleSignatures()` from S3.

#### C-3. Third-party order overdue checker

```json
{ "path": "/api/cron/check-third-party-overdue", "schedule": "0 13 * * *" }
```
Daily at 7am CT. Queries `third_party_orders WHERE status IN ('dispatched','in_progress') AND expected_completion_at < NOW() - interval '3 days'`. Surfaces in `deal_gap_queue` with `gap_type='third_party_overdue'`.

#### C-4. Cert expiration warning cron

```json
{ "path": "/api/cron/check-etran-cert-expiry", "schedule": "0 14 * * 1" }
```
Weekly Monday. Queries `bank_etran_credentials WHERE cert_expires_at < now() + interval '30 days'`. Emits alert per bank tenant (email to bank admin).

### D. Package PDF assembly (10-tab structure)

#### D-1. `src/lib/sba/package/assemble.ts`

Pure-ish function `assemblePackagePdf(dealId): Promise<Buffer>`:
- Tab 1: Cover sheet (deal summary)
- Tab 2: Form 1919 (signed)
- Tab 3: Forms 413 per owner (signed)
- Tab 4: Form 912 (if applicable, signed)
- Tab 5: Form 1920 (banker-completed)
- Tab 6: Form 4506-C (signed)
- Tab 7: Form 155 (if applicable, signed)
- Tab 8: Form 159 (if applicable, signed)
- Tab 9: Financial spread (existing renderer)
- Tab 10: Third-party reports + supporting docs

Uses pdf-lib to merge PDFs from Supabase Storage. Returns assembled buffer.

#### D-2. API route

`GET /api/deals/[dealId]/sba/package/pdf` — assembles and streams. `runtime = "nodejs"`, `maxDuration = 300`.

#### D-3. Tests

`src/lib/sba/package/__tests__/assemble.test.ts` — 4 cases:
- Full package with all forms → 10 tabs
- Package missing optional forms (no 912/155/159) → 7 tabs
- Required signed form missing → throws clear error
- Storage fetch error → graceful failure

### E. Roadmap update + build principles

#### E-1. `BUDDY_PROJECT_ROADMAP.md`

Add "Phase 87 — SBA 30-Min Package" entry covering all 5 sprints. Mark complete upon merge.

#### E-2. Build principles section

Append principles #11–#27 to roadmap's "Build Principles" section.

---

## Tests required

| File | Coverage |
|---|---|
| `src/lib/sba/__tests__/thirdPartyTriggers.test.ts` | 8 cases |
| `src/lib/thirdParty/__tests__/orchestrator.test.ts` | 6 cases |
| `src/lib/etran/__tests__/submitter.test.ts` | 8 cases |
| `src/lib/etran/__tests__/credentials.test.ts` | 4 cases |
| `src/lib/sba/package/__tests__/assemble.test.ts` | 4 cases |

Plus integration test: `src/__tests__/integration/sba-etran-submission-flow.test.ts` — full happy path: all forms signed → bank creds present → submit → SBA sandbox accepts → application number captured.

---

## Environment variables

```
ETRAN_CRED_ENCRYPTION_KEY=  # 32-byte base64 — pgcrypto symmetric key
SBA_ETRAN_SANDBOX_ENDPOINT=https://sandbox.sba.gov/etran/submit  # confirm at execution
SBA_ETRAN_PROD_ENDPOINT=https://etran.sba.gov/submit              # confirm at execution
SBA_ETRAN_MOCK_ENDPOINT=http://localhost:9999/mock-etran          # for dev pre-sandbox
CRON_SECRET=  # Vercel Cron auth header verification
```

Plus storage bucket creation:
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('etran-submissions', 'etran-submissions', false, 10485760, ARRAY['application/xml']),
  ('third-party-results', 'third-party-results', false, 52428800, ARRAY['application/pdf','application/json'])
ON CONFLICT (id) DO NOTHING;
```

---

## Verification (V-5)

**V-5a — Migrations applied**
```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public' AND table_name IN
  ('third_party_vendors','third_party_orders','bank_etran_credentials','etran_submissions');
-- Expected: 4

SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto');
-- Expected: true

SELECT proname FROM pg_proc WHERE proname IN
  ('etran_upsert_credentials','etran_get_credentials_decrypted');
-- Expected: 2 rows
```

**V-5b — Trigger engine**
- Real estate in proceeds → `evaluateThirdPartyTriggers` returns appraisal + title + ucc
- Acquisition + 7(a) standard → returns business_valuation
- NAICS in Appendix 6 list → returns phase_1_environmental
- Loan > $50K → returns hazard_insurance
- Loan > $350K + single owner + not fully secured → returns life_insurance

**V-5c — Order workflow end-to-end**
1. POST `/api/deals/<test-deal>/third-party/evaluate` → creates 'triggered' rows
2. POST `/api/deals/<test-deal>/third-party/orders/<id>/dispatch` with vendor_id → status='dispatched', vendor email sent
3. POST `/api/deals/<test-deal>/third-party/orders/<id>/ingest` with PDF → status='delivered'

**V-5d — Credentials encryption**
- Store cert via admin panel
- Verify `bank_etran_credentials.client_cert_pem_encrypted` is bytea (not plain)
- `getEtranCredentials` returns plaintext PEM via RPC
- DB dump does NOT contain plain PEM (search the dump file for `-----BEGIN`)

**V-5e — E-Tran sandbox round-trip**
1. All 4 required forms (FORM_1919, FORM_413, FORM_1920, FORM_4506C) signed for test deal
2. Cert configured for test bank (sandbox)
3. POST submit endpoint with banker user_id
4. Sandbox accepts → `etran_submissions.status='accepted'`, `sba_application_number` populated
5. `deal_events` shows `sba_application_submitted`

**V-5f — Pre-flight gate**
- Same call without FORM_1919 signed → returns `REQUIRED_SIGNED_FORMS_MISSING`
- No credentials configured → `ETRAN_CREDENTIALS_MISSING`

**V-5g — Idempotency**
- Submit twice with same XML → second call returns existing submission_id, no duplicate row in `etran_submissions`

**V-5h — Package PDF assembly**
- GET `/api/deals/<test-deal>/sba/package/pdf` returns valid PDF with all expected tabs

**V-5i — Cron deployments live**
- IRS polling cron runs (Vercel Cron logs visible)
- Staleness checker cron runs daily
- Third-party overdue checker runs daily
- Cert expiration cron runs weekly

**V-5j — `tsc --noEmit` clean, `vitest run` clean, integration test passes**

**V-5k — GitHub API verification**
All spec'd files exist on `main`. Roadmap updated with Phase 87 entry. Build principles #11–#27 listed.

---

## Non-goals

- Auto-API integrations to specific third-party vendors (incremental per vendor as relationships develop)
- Hardware Security Module (HSM) for cert keys (pgcrypto sym is acceptable for v1; HSM is a future security upgrade)
- Multi-region E-Tran failover (SBA endpoint is single)
- Crypto lending module (Phase 65 — separate from this pack)
- Borrower-facing package preview (banker-only for v1)
- Closing notes, security agreements (out of pack scope)

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | SBA E-Tran sandbox cert provisioning takes 1–2 weeks | High | PIV-4 surface step at sprint start; develop against `SBA_ETRAN_MOCK_ENDPOINT` until sandbox ready |
| 2 | Real SBA E-Tran XML schema differs from `generator.ts` output | Medium | Sandbox test exercises schema; iterate before prod cutover. SBA's E-Tran XSD published — re-validate output against it |
| 3 | pgcrypto encryption key rotation strategy | Medium | Document in `infrastructure/etran/CREDENTIAL_ROTATION.md`; v1 uses single env-var key; rotation = full table re-encrypt; KMS-managed key deferred |
| 4 | Third-party email templates spam-flagged by vendor inboxes | Low | Send from authenticated buddytheunderwriter.com domain; SPF/DKIM already configured |
| 5 | Vendor APIs vary widely — premature standardization | Low | v1 uses email-the-vendor pattern; per-vendor API integration is incremental |
| 6 | NAICS Appendix 6 list incomplete | Medium | Ship reasonable subset; surface for review; rules-as-config makes additions data-only updates |
| 7 | Banker submits to production by mistake when in sandbox config | Medium | `endpoint_environment` field on credentials + submission; admin UI requires explicit prod toggle; warning banner when prod selected |
| 8 | Pulse fastlane noise from many new event types | High | New events: `third_party.order_triggered/_dispatched/_delivered/_parsed/_cancelled`, `sba_application_submitted/_rejected`, `etran.network_error`, `etran.credentials_rotated`. **D3 silence is a hard prerequisite** — without it ledger noise becomes unmanageable |
| 9 | Package PDF assembly times out on Vercel | Medium | maxDuration=300; if still slow, move to Cloud Run worker with signed-URL response pattern |
| 10 | Cert expiration warning cron emails not delivered | Low | Existing email infrastructure; verify SPF on first deployment; second-channel alert via Slack to bank admin if email fails |

---

## Hand-off commit message

```
spec(sba-30min-package/s5): third-party orchestration + real E-Tran submission

- Migration 20260605_b: third_party_vendors + third_party_orders tables
- Migration 20260605_c: bank_etran_credentials (encrypted) + etran_submissions
- Migration 20260605_d: pgcrypto SECURITY DEFINER RPCs for cred encrypt/decrypt
- src/lib/sba/data/naicsAppendix6.ts: Phase I trigger NAICS codes
- src/lib/sba/thirdPartyTriggers.ts: pure trigger evaluation
- src/lib/thirdParty/orchestrator.ts: order lifecycle + email dispatch
- src/lib/etran/credentials.ts: encrypted cert storage via RPC
- src/lib/etran/submitter.ts: real SBA E-Tran POST with mutual TLS
- generator.ts submitETranXML rewritten to delegate to submitter
- src/lib/sba/package/assemble.ts: 10-tab package PDF
- 7 third-party API routes; admin panel; cred rotation runbook
- 4 Vercel Cron deployments (IRS poll / staleness / TPO overdue / cert expiry)
- 5 test files; 1 integration test
- Roadmap: Phase 87 + build principles #11-#27

Verification: V-5a through V-5k
Spec: specs/sba-30min-package/SPEC-S5-third-party-and-etran.md
```

---

## Addendum for Claude Code

**Judgment boundaries — when to stop and surface:**

- **PIV-4 (SBA sandbox cert) is on a 1–2 week procurement clock.** If not provisioned at sprint start: surface; develop against `SBA_ETRAN_MOCK_ENDPOINT` (a local mock service that returns canned responses); cut over to real sandbox when cert arrives. Do NOT block sprint progress on cert procurement
- **PIV-5 (NAICS Appendix 6 list):** ship a reasonable subset of codes from the SOP appendix. Don't block on completeness — rules-as-config means additions are 1-line data updates
- **Third-party vendor approval is per bank tenant.** Don't seed a global vendor list. Each bank tenant adds their own approved vendors via `/api/banks/[bankId]/third-party/vendors`. Test deals get test vendors
- **Vercel Cron vs Cloud Run cron** for IRS polling, staleness, TPO overdue, cert expiry: prefer Vercel Cron unless reasons surface (e.g., longer-than-Vercel-allows runtime). Vercel Cron limits: 60s on Hobby tier; 300s on Pro
- **Auto-submission: NEVER.** The human-approval gate is in the API route — the route requires `approved_by_user_id` from a Clerk session. **Do not add a "auto-submit when ready" feature** under any circumstances. SR 11-7 wall. If anyone (including Matt in a hurry) asks for auto-submit, surface and cite this addendum
- **Encryption key handling:** `ETRAN_CRED_ENCRYPTION_KEY` is set in Vercel env. Do NOT log it. Do NOT include it in error messages. If a code path requires it and it's missing, return `{ ok: false, reason: 'ENCRYPTION_KEY_MISSING' }` — never a stack trace that mentions the variable
- **Cert PEM in code paths:** PEM strings flow through `submitter.ts` for the TLS handshake. They live in memory only during the submission. Never log them. Never include them in `deal_events.event_data`. Test mocks should use throwaway test certs, not real ones
- **DocuSeal templates for forms 1920, 912, 4506-C, 155, 159:** S4 spec assumed these were uploaded. If S4 didn't ship them, S5 needs to confirm they exist before package assembly works. PIV step on this if S4 shipped without templates uploaded
- **Mock vs real SBA endpoint at boundary:** `creds.endpoint_environment === 'production'` selects prod URL. The admin panel has a hard prod toggle with confirmation modal. **Never default to production** — default is sandbox. Banker explicitly switches to prod when ready

**Pulse fastlane:** new event types per risk #8. **D3 silence is now a hard prerequisite for this sprint.** If D3 hasn't shipped: ship D3 first or alongside; do not let this sprint pile on without it.

**E-Tran XSD validation:** SBA publishes the E-Tran XML schema. Before going live in production, validate `generator.ts` output against the published XSD. The XSD-validation step is an additional sanity check beyond `validation.ts`. Worth a 1-day dedicated task just before production cutover. Surface as a follow-up sprint task — not strictly required for sandbox testing.

**Production cutover process** (post-sprint, per bank tenant):
1. Bank receives prod cert from SBA (separate from sandbox cert)
2. Banker admin uploads prod cert via admin panel; toggles `endpoint_environment='production'` with confirmation
3. First production submission is monitored live — banker + Matt on call
4. After 3 successful prod submissions, bank tenant is "production-active"
5. Per-tenant production active flag visible in cockpit deal header

This isn't part of S5 implementation — it's the operational handoff. Document in `infrastructure/etran/PRODUCTION_CUTOVER_RUNBOOK.md`.

**Final closing thought:** this sprint completes the 30-minute package capability. After S5 merges + cron deployments live + at least one bank tenant is configured for sandbox: a borrower can complete their full SBA package in 30 minutes (their part), with all async items (IRS, appraisal, valuation, Phase I) tracked transparently. SR 11-7 wall holds throughout. SOP 50 10 8 + March 2026 procedural notices fully baked into eligibility. IAL2 + audit-trail compliance documented. This is the launch-readiness milestone for SBA lending on Buddy.
