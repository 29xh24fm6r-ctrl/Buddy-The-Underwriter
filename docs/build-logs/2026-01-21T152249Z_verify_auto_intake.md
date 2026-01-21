
## Run: verify-auto-intake validation


- BASE: https://buddy-the-underwriter-43uxaoz4m-mpalas-projects-a4dbbece.vercel.app
- DEAL_ID: dc6ce3a1-491e-435e-b11b-14b47a74d409
- UTC: Wed Jan 21 15:22:49 UTC 2026

## 0) Preflight: builder token status

```bash
curl -sS "https://buddy-the-underwriter-43uxaoz4m-mpalas-projects-a4dbbece.vercel.app/api/builder/token/status" -H "x-buddy-builder-token: $BUDDY_BUILDER_VERIFY_TOKEN" | jq
```

```json
{"ok":true,"auth":true,"envPresent":true,"headerPresent":true,"tokenHash":"sha256:3dff47968113","envLenRaw":32,"envLenTrim":32,"headerLenRaw":32,"headerLenTrim":32,"envHashRaw":"sha256:3dff47968113","envHashTrim":"sha256:3dff47968113","headerHashRaw":"sha256:3dff47968113","headerHashTrim":"sha256:3dff47968113","authRaw":true,"authTrim":true}
```


## 1) Verify BEFORE (expected: checklist_incomplete missing required_checklist)

```bash
curl -sS "https://buddy-the-underwriter-43uxaoz4m-mpalas-projects-a4dbbece.vercel.app/api/_builder/verify/underwrite?dealId=dc6ce3a1-491e-435e-b11b-14b47a74d409" -H "x-buddy-builder-token: $BUDDY_BUILDER_VERIFY_TOKEN" | jq
```

```json
{"ok":false,"dealId":"dc6ce3a1-491e-435e-b11b-14b47a74d409","auth":true,"recommendedNextAction":"checklist_incomplete","diagnostics":{"dealId":"dc6ce3a1-491e-435e-b11b-14b47a74d409","lookedIn":["supabase.deals"],"foundIn":{"supabaseDeals":true},"bankId":"bedf308d-b3f8-4e97-a900-202dd5e27035","lifecycleStage":"collecting","lifecycleSource":"stage","dbError":null,"lifecycleError":null,"missing":["required_checklist"]},"ledgerEventsWritten":["deal.underwrite.verify"]}
```


## 2) UI Phase 1 — Clear badges


Open:
https://buddy-the-underwriter-43uxaoz4m-mpalas-projects-a4dbbece.vercel.app/deals/dc6ce3a1-491e-435e-b11b-14b47a74d409/cockpit

Do:
- Click “Rename” → set any name (remove NEEDS NAME)
- Borrower tab → attach/create borrower (remove “Borrower not set”)

Then run Phase 1 verify below.

## 3) Verify AFTER UI Phase 1



(run this after completing UI Phase 1; paste output into docs/build-logs/2026-01-21T152249Z_verify_auto_intake.md)

## 4) UI Phase 2 — Trigger auto-init intake


Do:
- Overview → click “I will upload docs"
- Documents tab should unlock

Then run Phase 2 verify below.

## 5) Verify AFTER UI Phase 2



(run this after completing UI Phase 2; paste output into docs/build-logs/2026-01-21T152249Z_verify_auto_intake.md)

## 6) UI Phase 3 — Upload any PDF


Do:
- Upload ANY PDF in Documents
- Wait for ingestion/checklist update
- Return to Overview

Then run Phase 3 verify below.

## 7) Verify AFTER UI Phase 3



(run this after completing UI Phase 3; paste output into docs/build-logs/2026-01-21T152249Z_verify_auto_intake.md)

## 8) Fallback (ONLY if needed) — builder seed-intake




Use ONLY if:
- Documents stays locked, OR
- verify continues to report missing required_checklist after Phase 2.

After fallback:
- Hard refresh cockpit
- Upload PDF again
- Rerun verify (Phase 3)

## 9) Final — Start Underwriting (UI)


When verify returns ok=true:
- Overview → click “Start Underwriting"
If it blocks:
- Copy UI error text
- Paste it + latest verify JSON into this log

## BUDDY ITEM (fill after completing phases)


AUTO-INTAKE + VERIFY VALIDATION (preview)

- BASE:
- DEAL_ID:
- Token status: authTrim=?

Verify results:
- before: recommendedNextAction=..., missing=...
- after phase 1: ...
- after phase 2: ...
- after phase 3: ... (expect ok=true or final gate)

Fallback used? (yes/no):
- seed-intake response: ...

Underwriting:
- Start Underwriting: success/blocker text

Conclusion:
- Auto-init works (Docs unlock immediately after “I will upload docs”) ✅/❌
- Remaining blockers (if any): ...

### verify:terminal_before

```json
{
  "ok": false,
  "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
  "auth": true,
  "recommendedNextAction": "checklist_incomplete",
  "diagnostics": {
    "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
    "lookedIn": [
      "supabase.deals"
    ],
    "foundIn": {
      "supabaseDeals": true
    },
    "bankId": "bedf308d-b3f8-4e97-a900-202dd5e27035",
    "lifecycleStage": "collecting",
    "lifecycleSource": "stage",
    "dbError": null,
    "lifecycleError": null,
    "missing": [
      "required_checklist"
    ]
  },
  "ledgerEventsWritten": [
    "deal.underwrite.verify"
  ]
}
```

### seed-intake:terminal

```json
{
  "ok": true,
  "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
  "bankId": "bedf308d-b3f8-4e97-a900-202dd5e27035",
  "stage": "collecting",
  "diagnostics": {
    "steps": [
      {
        "name": "initialize_intake",
        "ok": true,
        "status": "initialized"
      },
      {
        "name": "ensure_borrower",
        "ok": true,
        "status": "already_attached"
      },
      {
        "name": "ensure_lifecycle_collecting",
        "ok": true,
        "status": "set_collecting_stage_only"
      },
      {
        "name": "ensure_financial_snapshot",
        "ok": true,
        "status": "already_present"
      }
    ]
  }
}
```

### verify:terminal_after_seed

```json
{
  "ok": false,
  "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
  "auth": true,
  "recommendedNextAction": "checklist_incomplete",
  "diagnostics": {
    "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
    "lookedIn": [
      "supabase.deals"
    ],
    "foundIn": {
      "supabaseDeals": true
    },
    "bankId": "bedf308d-b3f8-4e97-a900-202dd5e27035",
    "lifecycleStage": "collecting",
    "lifecycleSource": "stage",
    "dbError": null,
    "lifecycleError": null,
    "missing": [
      "required_checklist"
    ]
  },
  "ledgerEventsWritten": [
    "deal.underwrite.verify"
  ]
}
```

### builder:set_name

> NOTE: No builder set-name route found (or it failed).
> If verify shows missing_deal_name, we should add: PATCH /api/_builder/deals/:id/name

### builder:attach_borrower

> NOTE: No builder borrower attach route found (or it failed).
> If verify shows missing_borrower, we should add: POST /api/_builder/deals/:id/borrower/attach

### verify:terminal_after_prereqs

```json
{
  "ok": false,
  "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
  "auth": true,
  "recommendedNextAction": "checklist_incomplete",
  "diagnostics": {
    "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
    "lookedIn": [
      "supabase.deals"
    ],
    "foundIn": {
      "supabaseDeals": true
    },
    "bankId": "bedf308d-b3f8-4e97-a900-202dd5e27035",
    "lifecycleStage": "collecting",
    "lifecycleSource": "stage",
    "dbError": null,
    "lifecycleError": null,
    "missing": [
      "required_checklist"
    ]
  },
  "ledgerEventsWritten": [
    "deal.underwrite.verify"
  ]
}
```

## 10) Deterministic terminal validation (builder upload helper)

```bash
curl -sS -X POST "$BASE/api/builder/deals/$DEAL_ID/seed-intake" -H "x-buddy-builder-token: $BUDDY_BUILDER_VERIFY_TOKEN" -H "content-type: application/json" -d '{}' | jq -c '.'
```

```json
{"ok":true,"dealId":"dc6ce3a1-491e-435e-b11b-14b47a74d409","bankId":"bedf308d-b3f8-4e97-a900-202dd5e27035","stage":"collecting","diagnostics":{"steps":[{"name":"initialize_intake","ok":true,"status":"initialized"},{"name":"ensure_borrower","ok":true,"status":"already_attached"},{"name":"ensure_lifecycle_collecting","ok":true,"status":"set_collecting_stage_only"},{"name":"ensure_financial_snapshot","ok":true,"status":"already_present"}]}}
```

```bash
curl -i -sS -X POST "$BASE/api/_builder/deals/$DEAL_ID/documents/upload" -H "x-buddy-builder-token: $BUDDY_BUILDER_VERIFY_TOKEN" -F "file=@/tmp/buddy_dummy.pdf;type=application/pdf" | head -n 25
```

```
HTTP/2 405 
cache-control: public, max-age=0, must-revalidate
content-disposition: inline; filename="500"
content-security-policy: frame-ancestors 'none'
content-type: text/html; charset=utf-8
date: Wed, 21 Jan 2026 16:15:01 GMT
permissions-policy: camera=(), microphone=(), geolocation=()
referrer-policy: strict-origin-when-cross-origin
server: Vercel
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-clerk-auth-reason: dev-browser-missing
x-clerk-auth-status: signed-out
x-content-type-options: nosniff
x-frame-options: DENY
x-matched-path: /500
x-next-error-status: 500
x-nextjs-rewritten-path: /api/builder/deals/dc6ce3a1-491e-435e-b11b-14b47a74d409/documents/upload
x-robots-tag: noindex
x-vercel-cache: BYPASS
x-vercel-id: iad1::cgtfp-1769012101293-14e5bb520878
```

```bash
curl -sS "$BASE/api/_builder/verify/underwrite?dealId=$DEAL_ID" -H "x-buddy-builder-token: $BUDDY_BUILDER_VERIFY_TOKEN" | jq -c '.'
```

```json
{"ok":false,"dealId":"dc6ce3a1-491e-435e-b11b-14b47a74d409","auth":true,"recommendedNextAction":"checklist_incomplete","diagnostics":{"dealId":"dc6ce3a1-491e-435e-b11b-14b47a74d409","lookedIn":["supabase.deals"],"foundIn":{"supabaseDeals":true},"bankId":"bedf308d-b3f8-4e97-a900-202dd5e27035","lifecycleStage":"collecting","lifecycleSource":"stage","dbError":null,"lifecycleError":null,"missing":["required_checklist"]},"ledgerEventsWritten":["deal.underwrite.verify"]}
```

> NOTE: Preview returned 405/500 for builder upload. The new route is not deployed on this preview yet.

## 11) Tests + typecheck

```bash
pnpm -s test:unit
```

```
✔ builder deal core can mint and make ready (3.770841ms)
✔ buildBuilderTokenStatus reports env/header presence without leaking token (6.281159ms)
✔ buildBuilderTokenStatus marks auth false when header missing (0.652368ms)
✔ mustBuilderToken throws on missing token (3.265809ms)
✔ builder upload rejects missing token (30.430753ms)
✔ builder upload rejects missing file (115.775172ms)
✔ builder upload accepts pdf and calls ingest (14.906325ms)
✔ /workspaces/Buddy-The-Underwriter/src/lib/__tests__/computeNextStep.test.ts (330.008383ms)
✔ intakeDeepLinkForMissing routes cockpit anchors (1.459125ms)
✔ intakeDeepLinkForMissing routes loan terms anchors (0.266017ms)
✔ intakeDeepLinkForMissing defaults to intake cockpit (0.211204ms)
✔ builder verify and meta routes are registered (1.529036ms)
✔ seedIntakePrereqsCore materializes required checklist items (3.339588ms)
✔ required Stitch surfaces reference StitchSurface (1.62795ms)
✔ missing deal name blocks complete_intake (2.298041ms)
✔ missing deal returns deal_not_found with diagnostics (1.078443ms)
✔ missing borrower blocks complete_intake (0.402902ms)
✔ partial lifecycle blocks complete_intake (0.423891ms)
✔ valid deal returns ok (7.819583ms)
✔ missing pricing quote blocks pricing_required (2.435468ms)
✔ ensureUnderwritingActivated is idempotent when already underwriting (1.959099ms)
✔ ensureUnderwritingActivated blocks when required items missing (0.486198ms)
✔ selectBestFact prefers MANUAL over SPREAD over DOC_EXTRACT (1.490173ms)
✔ selectBestFact prefers most recent as_of_date (within same source_type) (0.37526ms)
✔ buildSnapshotFromFacts does not silently merge as_of_dates (0.929045ms)
✔ diffSnapshots returns changed metrics (1.626116ms)
✔ computeFinancialStress calculates base and stressed DSCR (1.659259ms)
✔ computeFinancialStress applies rate up scenario (0.445782ms)
✔ banker upload ignites deal (27.749346ms)
✔ borrower upload blocked pre-ignite (0.36405ms)
✔ invite ignites deal (2.45786ms)
✔ underwrite route blocked before underwriting (0.25188ms)
✔ underwrite start gate blocks on verify or lifecycle (0.350515ms)
✔ underwrite start gate allows when ready (0.229819ms)
✔ Rent roll column registry is deterministic (1.970048ms)
✔ Rent roll rows sort deterministically by unit_id then tenant_name (nulls last) (35.225767ms)
✔ Rent roll totals compute and occupancy/vacancy pct when sqft available (1.431052ms)
✔ Rent roll occupancy/vacancy pct is null when sqft missing (0.972896ms)
✔ WALT_YEARS edge cases: null when vacant; zero when lease already ended (1.412006ms)
✔ T12 formulas compute per-column (3.982653ms)
✔ T12 template renders deterministic registries (34.496415ms)
```

## 12) Route probe (builder upload)

```bash
BASE="$BASE" DEAL_ID="$DEAL_ID" node scripts/tests/probe-builder-upload.mjs
```

```json
{
  "url": "https://buddy-the-underwriter-43uxaoz4m-mpalas-projects-a4dbbece.vercel.app/api/builder/deals/dc6ce3a1-491e-435e-b11b-14b47a74d409/documents/upload",
  "status": 404,
  "allow": null,
  "matched": "/_not-found",
  "ct": "text/html; charset=utf-8",
  "body_prefix": "<!DOCTYPE html><html lang=\"en\" class=\"dark\"><head><meta charSet=\"utf-8\"/><meta name=\"viewport\" content=\"width=dev"
}
```

```json
{
  "url": "https://buddy-the-underwriter-43uxaoz4m-mpalas-projects-a4dbbece.vercel.app/api/_builder/deals/dc6ce3a1-491e-435e-b11b-14b47a74d409/documents/upload",
  "status": 404,
  "allow": null,
  "matched": "/_not-found",
  "ct": "text/html; charset=utf-8",
  "body_prefix": "<!DOCTYPE html><html lang=\"en\" class=\"dark\"><head><meta charSet=\"utf-8\"/><meta name=\"viewport\" content=\"width=dev"
}
```

## 13) New preview URL (post-push) + build state

```text
BASE=https://buddy-the-underwriter-i01dtrlxt-mpalas-projects-a4dbbece.vercel.app
```

```bash
curl -i -sS "$BASE/api/_builder/deals/latest" -H "x-buddy-builder-token: $BUDDY_BUILDER_VERIFY_TOKEN" | head -n 12
```

```
HTTP/2 200
content-type: text/html; charset=utf-8
x-matched-path: /[[...slug]]
... (Deployment is building)
```

> NOTE: New preview still building; API routes return HTML until deploy completes. Re-run probe + terminal validation after build finishes.
✔ buildT12Columns produces 12 months + aggregates (1.901761ms)
✔ matchLenders filters by DSCR and LTV (1.579209ms)
✔ borrower upload satisfies multiple checklist items (1.490973ms)
✔ borrower cannot upload after underwriting start (0.248533ms)
✔ underwriting CTA disabled until ready (0.370602ms)
✔ buddy narration emitted on borrower upload/checklist update/underwriting start (0.346658ms)
✔ buildPortfolioSummary computes weighted DSCR (1.91195ms)
✔ evaluateSbaEligibility returns conditional when missing fields (1.522382ms)
✔ evaluateSbaEligibility flags ineligible entity types (0.314256ms)
✔ evaluateSbaEligibility flags low DSCR (0.269534ms)
✔ buildSbaForm1919 marks missing required fields (1.768282ms)
✔ buildSbaForm1920 maps dscr and ltv (0.470178ms)
✔ computeDealScore favors strong DSCR and stress (1.893847ms)
✔ sms send module uses lazy Twilio import (1.491725ms)
✔ findExistingDocBySha returns latest match (6.065546ms)
✔ sanitizeFilename removes separators and collapses whitespace (14.415342ms)
✔ sanitizeFilename preserves extension with length cap (3.81701ms)
✔ buildGcsObjectKey uses canonical path (1.836078ms)
✔ gcs sign-upload response shape (1.521891ms)
ℹ tests 60
ℹ suites 0
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3435.508309
```

```bash
pnpm -s typecheck
```

```
(no output, exit 0)
```

### builder:upload_dummy_pdf

> NOTE: No builder upload route found (or it failed). If verify remains checklist_incomplete, add: POST /api/_builder/deals/:id/documents/upload

### verify:terminal_final

```json
{
  "ok": false,
  "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
  "auth": true,
  "recommendedNextAction": "checklist_incomplete",
  "diagnostics": {
    "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
    "lookedIn": [
      "supabase.deals"
    ],
    "foundIn": {
      "supabaseDeals": true
    },
    "bankId": "bedf308d-b3f8-4e97-a900-202dd5e27035",
    "lifecycleStage": "collecting",
    "lifecycleSource": "stage",
    "dbError": null,
    "lifecycleError": null,
    "missing": [
      "required_checklist"
    ]
  },
  "ledgerEventsWritten": [
    "deal.underwrite.verify"
  ]
}
```

## preview:build_gate:start

```
BASE=https://buddy-the-underwriter-i01dtrlxt-mpalas-projects-a4dbbece.vercel.app\nUTC=Wed Jan 21 16:28:35 UTC 2026\ntries=60 sleep=5s
```

## preview:build_gate:ready

```
HTTP/2 200 
ct=application/json
matched=/api/builder/token/status
body={"ok":true,"auth":true,"envPresent":true,"headerPresent":true,"tokenHash":"sha256:3dff47968113","envLenRaw":32,"envLenTrim":32,"headerLenRaw":32,"headerLenTrim":32,"envHashRaw":"sha256:3dff47968113","envHashTrim":"sha256:3dff47968113","headerHashRaw":"sha256:3dff47968113","headerHashTrim":"sha256:3dff47968113","authRaw":true,"authTrim":true}
```

## probe:builder_upload:command

```
BASE=https://buddy-the-underwriter-i01dtrlxt-mpalas-projects-a4dbbece.vercel.app DEAL_ID=dc6ce3a1-491e-435e-b11b-14b47a74d409 node scripts/tests/probe-builder-upload.mjs
```

## probe:builder_upload:output

```
{
  "url": "https://buddy-the-underwriter-i01dtrlxt-mpalas-projects-a4dbbece.vercel.app/api/builder/deals/dc6ce3a1-491e-435e-b11b-14b47a74d409/documents/upload",
  "status": 204,
  "allow": "OPTIONS, POST",
  "matched": "/api/builder/deals/[dealId]/documents/upload",
  "ct": null,
  "body_prefix": ""
}
{
  "url": "https://buddy-the-underwriter-i01dtrlxt-mpalas-projects-a4dbbece.vercel.app/api/_builder/deals/dc6ce3a1-491e-435e-b11b-14b47a74d409/documents/upload",
  "status": 204,
  "allow": "OPTIONS, POST",
  "matched": "/api/builder/deals/[dealId]/documents/upload",
  "ct": null,
  "body_prefix": ""
}
```

## validation:terminal:command

```
BASE=https://buddy-the-underwriter-i01dtrlxt-mpalas-projects-a4dbbece.vercel.app BUDDY_BUILDER_VERIFY_TOKEN=*** node scripts/tests/run-terminal-validation.mjs
```

## validation:terminal:output

```
deals/latest: {
  "status": 200,
  "json": {
    "ok": true,
    "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
    "createdAt": "2026-01-18T19:33:16.873+00:00",
    "name": "Hellmans Mayonaise"
  }
}
seed-intake: {
  "status": 200,
  "json": {
    "ok": true,
    "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
    "bankId": "bedf308d-b3f8-4e97-a900-202dd5e27035",
    "stage": "collecting",
    "diagnostics": {
      "steps": [
        {
          "name": "initialize_intake",
          "ok": true,
          "status": "initialized"
        },
        {
          "name": "materialize_required_checklist",
          "ok": true,
          "status": "materialized_6"
        },
        {
          "name": "ensure_borrower",
          "ok": true,
          "status": "already_attached"
        },
        {
          "name": "ensure_lifecycle_collecting",
          "ok": true,
          "status": "set_collecting_stage_only"
        },
        {
          "name": "ensure_financial_snapshot",
          "ok": true,
          "status": "already_present"
        }
      ]
    }
  }
}
verify(after_seed): {
  "status": 200,
  "json": {
    "ok": false,
    "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
    "auth": true,
    "recommendedNextAction": "checklist_incomplete",
    "diagnostics": {
      "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
      "lookedIn": [
        "supabase.deals"
      ],
      "foundIn": {
        "supabaseDeals": true
      },
      "bankId": "bedf308d-b3f8-4e97-a900-202dd5e27035",
      "lifecycleStage": "collecting",
      "lifecycleSource": "stage",
      "dbError": null,
      "lifecycleError": null,
      "missing": [
        "PFS_CURRENT",
        "IRS_PERSONAL_3Y",
        "IRS_BUSINESS_3Y",
        "FIN_STMT_PL_YTD",
        "FIN_STMT_BS_YTD",
        "PROPERTY_INSURANCE"
      ]
    },
    "ledgerEventsWritten": [
      "deal.underwrite.verify"
    ]
  }
}
upload: {
  "status": 500,
  "ct": "",
  "matched": "/api/builder/deals/[dealId]/documents/upload",
  "body_prefix": ""
}
verify(after_upload): {
  "status": 200,
  "json": {
    "ok": false,
    "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
    "auth": true,
    "recommendedNextAction": "checklist_incomplete",
    "diagnostics": {
      "dealId": "dc6ce3a1-491e-435e-b11b-14b47a74d409",
      "lookedIn": [
        "supabase.deals"
      ],
      "foundIn": {
        "supabaseDeals": true
      },
      "bankId": "bedf308d-b3f8-4e97-a900-202dd5e27035",
      "lifecycleStage": "collecting",
      "lifecycleSource": "stage",
      "dbError": null,
      "lifecycleError": null,
      "missing": [
        "PFS_CURRENT",
        "IRS_PERSONAL_3Y",
        "IRS_BUSINESS_3Y",
        "FIN_STMT_PL_YTD",
        "FIN_STMT_BS_YTD",
        "PROPERTY_INSURANCE"
      ]
    },
    "ledgerEventsWritten": [
      "deal.underwrite.verify"
    ]
  }
}
```
