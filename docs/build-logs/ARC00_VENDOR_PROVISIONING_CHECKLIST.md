# ARC-00 Vendor Provisioning Checklist

**Purpose:** every SBA integration built in ARC-00 (`specs/sba-30min-package/ARC-00-forms-complete-build-arc.md`)
is real, tested code that fails closed with a clear error when its vendor
credentials are missing — none of it is a stub or a mock pretending to be
real. This doc is the "go get these" list for whoever has authority to sign
up for vendor accounts, request SBA lender access, and set environment
variables in Vercel. It cannot be completed by a coding session: every item
below requires either a business relationship, a government approval, or a
credential that only a human with account access can obtain.

**How to use this:** work top to bottom, roughly in priority order (Plaid
and Didit/SignWell unblock the most downstream form-fill/e-sign work; SBA
E-Tran is last because nothing upstream of it in the pipeline depends on
it). For each item, the "Verify" step tells you how to confirm Buddy
picked it up — mostly "trigger the flow and see the error message change
from vendor-credentials-missing to something else."

All env vars below go in **Vercel → Project Settings → Environment
Variables**, not in chat, not committed to the repo. `.env.example` (now
corrected/expanded alongside this checklist) documents every var name
with a comment pointing at the file that reads it.

---

## 1. Plaid — bank transaction data

**What it's for:** soft bank-statement/transaction data feeding equity
seasoning, debt schedule auto-build, and DSCR inputs. No credit-bureau
data.

**Get:** a Plaid developer account → Production access request (sandbox
works immediately for testing, no request needed).

**Set:**
- `PLAID_CLIENT_ID`, `PLAID_SECRET`
- `PLAID_ENV` (`sandbox` → `development` → `production` as you progress)
- `PLAID_WEBHOOK_URL` (already correct in `.env.example`:
  `https://buddytheunderwriter.com/api/webhooks/plaid`)
- `PLAID_ACCESS_TOKEN_ENCRYPTION_KEY` — generate with `openssl rand -base64 32`, not a vendor value

**Verify:** run a Plaid Link flow for a test borrower; confirm
`borrower_bank_connections` gets a row and a subsequent sync populates
transactions.

**Known gap (not blocking):** multi-tenant/per-bank Plaid credentials are
deferred to v2 — today it's one global Plaid app for the whole platform.

---

## 2. Didit — IAL2-equivalent identity verification

**What it's for:** required before any SBA form can be e-signed (SOP 50
10 8 Appendix 10 identity-proofing requirement).

**Replaced Persona 2026-07-15** — same requirement, different vendor.
Persona was built but never provisioned; Didit was chosen instead after a
cost/build comparison (80% cheaper per check, 500/mo free permanently,
SOC 2 Type I + ISO/IEC 27001:2022 + iBeta Level 1 liveness cert). Whether
Didit is acceptable to Buddy's lender partners (some banks maintain an
approved-vendor list) is a business/compliance question for Matt and the
CCO, not settled by this checklist — pilot in parallel with the current
setup before treating it as final.

**Get:** a Didit account at https://business.didit.me, then build a
**verification workflow** in the Didit dashboard (ID scan + liveness +
face match) — note its `workflow_id`.

**Set:**
- `DIDIT_API_KEY`
- `DIDIT_WORKFLOW_ID`
- `DIDIT_WEBHOOK_SECRET_KEY` — configure a Didit webhook pointing at
  `https://<buddy-app-domain>/api/webhooks/didit`; verifies the
  `X-Signature-Simple` + `X-Timestamp` headers (see
  `src/lib/identity/kyc/verifyDiditWebhook.ts` — this scheme was never
  checked against a live account during the build; Didit's docs describe
  a stronger `X-Signature-V2` canonicalized-body scheme as preferred, not
  yet implemented pending that confirmation)

**Verify:** initiate identity verification for a test owner
(`POST /api/deals/[dealId]/kyc`), complete the Didit-hosted flow, confirm
the webhook lands and the owner's verification status flips. Also spot-
check that Didit's decision payload (document type, name, DOB, selfie
match score) actually matches the field paths assumed in
`src/lib/identity/kyc/service.ts`'s `handleDiditWebhook` — those detail
fields aren't populated yet pending that confirmation (status is).

---

## 3. SignWell — e-signature

**What it's for:** signing every fillable SBA form (1919, 413, 912,
1244, 4506-C, 148/148L, 601, and Form 155's borrower side).

**Replaced DocuSeal 2026-07-15** — DocuSeal was fully built
(`src/lib/esign/docuseal/`) but never deployed; self-hosting it would
have added a second unmanaged service on top of unresolved ops debt on
the Chatto droplet (no offsite backups, no fail2ban, SSH hardening
pending). SignWell is a hosted REST API on every tier including free —
no deployment, no separate Postgres database, no Cloud Run cold-start
risk during a live signing ceremony.

**Get:** a SignWell account at https://www.signwell.com (free, no card).
Get the API key from **Settings > API**. Build a template for each SBA
form under **Templates**, note each `template_id`, and configure a
webhook under **API > Webhooks** pointing at
`https://<buddy-app-domain>/api/webhooks/signwell` — the response
includes a webhook id, which is the HMAC key (not the API key).

**Set:**
- `SIGNWELL_API_KEY`
- `SIGNWELL_TEST_MODE` (`true` in dev — documents don't count against
  billing and aren't legally binding; `false` in prod)
- `SIGNWELL_WEBHOOK_ID` — from the webhook Create/List response
- `SIGNWELL_TEMPLATE_1919`, `SIGNWELL_TEMPLATE_413` — **no `FORM_`
  infix**, same convention DocuSeal used
  (`src/lib/esign/signwell/service.ts` reads these exact names)

**Verify:** confirm `src/lib/esign/signwell/verifySignwellWebhook.ts`'s
assumed payload shape (`event.type`/`event.time`/`event.hash` embedded in
the JSON body, keyed by the webhook id) actually matches what SignWell
sends — this was built from SignWell's public API reference without a
live account to confirm against. Then run a real signature request for
Form 1919 end to end and confirm `signed_documents` gets a row with
`esign_provider = 'signwell'`.

---

## 4. CAIVRS — federal debt / prior-SBA-loss screening

**What it's for:** SBA eligibility check for prior federal loan defaults.

**Get:** SBA-authorized CAIVRS access (this is a government-adjacent data
source, not a normal SaaS signup — confirm with SBA or your CAIVRS access
vendor what the actual onboarding path is; this wasn't verified during
the build).

**Set:**
- `CAIVRS_API_BASE`, `CAIVRS_AUTH_USERNAME`, `CAIVRS_AUTH_PASSWORD`
  (HTTP Basic auth)

**Known gap:** these are global env vars today, not per-bank. The spec
wanted `banks.settings.caivrs_credentials` (per-bank), but that column
didn't exist in prod when this was built (`banks.settings` exists now as
of Phase 6, but only holds vendor-roster data, not credentials). If
multiple banks with different CAIVRS access need to share this deployment,
that's a real follow-up, not something this checklist alone fixes.

**Verify:** trigger a CAIVRS check for a test owner and confirm a result
comes back instead of a `CAIVRS_CREDENTIALS_MISSING` gap in
`deal_gap_queue`.

---

## 5. SAM.gov — exclusion list check

**What it's for:** SBA eligibility check for federally-debarred entities.

**Get:** a SAM.gov API key (free, self-service at sam.gov — this is the
easiest item on this list). Technically optional — the endpoint works
without a key but gets rate-limited (429) quickly.

**Set:**
- `SAM_GOV_API_KEY`

**Verify:** trigger a SAM.gov check for a test business; confirm a real
exclusion-status result instead of a rate-limit error. Also worth a
manual response-shape review — the parser was built without live network
access to confirm SAM.gov's exact JSON shape, so double-check the first
few real responses against `src/lib/integrations/samGov/client.ts`'s
assumptions before trusting it in production.

---

## 6. Credit bureau — soft pull

**What it's for:** soft credit pull for SBA eligibility (never a hard
pull — enforced at 3 layers in code, see the Drift Log).

**Decision needed first:** the default vendor (`plaid_check`) was picked
by the build executor without a stakeholder confirmation round-trip —
worth confirming this is actually the intended vendor before provisioning
it. The type system also allows `array`/`measureone`/`transunion`/
`equifax`/`experian`, but only `plaid_check` is actually wired end-to-end.

**Get:** whichever vendor is confirmed — if `plaid_check`, this may
reuse the Plaid account from item 1 (Plaid Check is a separate product
within Plaid, confirm with your Plaid rep).

**Set:**
- `CREDIT_BUREAU_VENDOR` (defaults to `plaid_check`)
- `CREDIT_BUREAU_API_BASE_URL`, `CREDIT_BUREAU_API_KEY`

**Verify:** trigger a soft-pull for a test owner, confirm a real credit
summary lands instead of a credentials-missing gap.

---

## 7. IRS transcript vendor — Form 4506-C fulfillment

**What it's for:** submitting/polling IRS tax transcript requests after
Form 4506-C is signed.

**Decision + get:** `IRS_TRANSCRIPT_VENDOR` accepts `irs_direct | ncs |
idology | wolters_kluwer` (defaults to `ncs`). **Avoid `irs_direct`** —
it requires IRS Designated User authorization, which the vendor client's
own code comment notes takes 30+ days to provision. NCS or IDology are
faster paths; confirm which one your team has (or wants) a relationship
with.

**Set:**
- `IRS_TRANSCRIPT_VENDOR`
- `IRS_VENDOR_BASE_URL`, `IRS_VENDOR_API_KEY`

**Verify:** submit a test 4506-C transcript request, confirm the
`/api/cron/sba-checks?check=irs-transcripts` cron job (runs every 30 min)
successfully polls and reconciles it — check `borrower_irs_transcript_requests`
for a status transition out of `submitted`.

---

## 8. SBA E-Tran — application submission

**What it's for:** the actual submission of a completed SBA application
to SBA. This is the last step in the pipeline and has the highest bar —
it requires a real, existing SBA-approved lender relationship. **This
almost certainly cannot be "provisioned" by going to a website; it
requires your organization to already be (or become) an SBA-approved
7(a)/504 lender with E-Tran access.**

**Get, per bank using Buddy for SBA lending:**
1. The bank's SBA Lender ID and Service Center (from their existing SBA
   relationship).
2. A mutual-TLS client certificate + private key issued by SBA for that
   lender's E-Tran access — this is **not a self-service API key**, it's
   a certificate SBA issues as part of the lender relationship.

**Set (platform-wide, one time):**
- `SBA_ETRAN_SANDBOX_ENDPOINT`, `SBA_ETRAN_PROD_ENDPOINT`
- `ETRAN_CRED_ENCRYPTION_KEY` — a symmetric key **you generate** (not
  from SBA) to encrypt stored certs at rest; treat like any other secret,
  losing it makes every stored cert unrecoverable (see
  `infrastructure/etran/CREDENTIAL_ROTATION.md`)

**Set (per bank, via the app, NOT an env var):** once the above two env
vars exist, a `bank_admin` user goes to `/banks/[bankId]/templates` →
"SBA Integration Settings" → "Configure" and pastes the cert/key PEM
directly into that form. It's encrypted server-side before storage
(`bank_etran_credentials`, RLS-locked, only reachable through
`SECURITY DEFINER` RPCs) — the PEM never touches an env var or the repo.

**Verify:** with `endpoint_environment=sandbox` set for a test bank,
submit one application via the `submit-etran` action on
`/api/deals/[dealId]/sba` and confirm SBA's sandbox accepts it. **Do not**
test against `production` until sandbox is confirmed working — there is
no dry-run flag, `submitToSba()` really submits.

**Non-negotiable reminder (SR 11-7 wall):** there is no "auto-submit"
path anywhere in this codebase and there must never be one — every E-Tran
submission requires `approvedByUserId` from an authenticated human
session. This isn't a provisioning step, just a standing constraint worth
knowing before anyone builds automation on top of this endpoint.

---

## 9. SBA official form template ingestion

**What it's for:** `scripts/ingest-sba-templates.ts` scrapes the current
PDF + revision date off SBA's/IRS's own "document page" HTML (not a
hardcoded URL) and stores it in `bank_document_templates`, so form
renderers always fill the *current* official template (AP-6 — official
templates are versioned artifacts, never a placeholder).

**Get:** nothing to sign up for — this is a network-access problem, not
a vendor-credential problem. It needs outbound HTTPS access to `sba.gov`
and `irs.gov` from wherever it runs (this build session's proxy blocked
both, which is why `bank_document_templates` is empty in prod today).

**Do:** run `scripts/ingest-sba-templates.ts` from any environment with
real internet access (a local machine, a CI runner without a restrictive
egress policy, etc.) pointed at the prod Supabase project
(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).

**Verify:** the script's own comment warns its page-scrape regexes were
never checked against live `sba.gov`/`irs.gov` HTML — read its output
carefully on first run rather than trusting a silent success, and spot-
check a couple of the ingested PDFs actually opened correctly before
relying on it broadly.

---

## Already configured — no action needed

`GEMINI_API_KEY`, `GEMINI_MODEL`, and the GCP/Vertex identity vars
(`GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`,
`GCP_SERVICE_ACCOUNT_EMAIL`, workload-identity-federation vars) are
already wired for document OCR/classification and are out of scope here.

---

## After provisioning: how to confirm end to end

Every integration in this arc fails closed with a specific, greppable
error when its credentials are missing (e.g. `ETRAN_CREDENTIALS_MISSING`,
`CAIVRS_CREDENTIALS_MISSING`) rather than a generic 500 — so the fastest
way to confirm an item above is actually wired up is to trigger the
relevant flow on a test deal and watch that specific error disappear.
There is currently **no fully-populated SBA smoke deal in prod** (open
since ARC-00 Phase 1) — creating one, with a real borrower/owner/loan-
request/financials data set, is a prerequisite for meaningfully verifying
items 2-8 above end to end, and is worth doing before or alongside this
provisioning work.
