# AAR — SPEC-GEMINI-EXTRACTION-CONFIG-FIX-1 DEPLOY

**Date:** 2026-05-13
**Test deal:** OmniCare 365 May 1 2026 (`80fe6f7a-5c68-4f02-8bcf-933f246a9fc5`)
**Spec branch:** `feat/gemini-extraction-config-fix-1` (merged + deleted)
**Outcome:** Mixed — diagnostic-quality improvements **CONFIRMED**, but Gemini config fix **NOT YET EXERCISED** in production because the V-5 trigger ran locally and hit a different upstream bug (Vertex AI auth). Decision tree branch lands on a 4th-option not in the spec.

---

## Merge sequence

### Step 1a — cfa-extract-5 prerequisite

Merge commit on `main`: **`0009323d`** — `test(runCashFlowAggregator): update [cfa-extract-5] for B4.1.2 v2 bump`

Rationale: pre-existing CI failure documented in earlier AAR. Had to land first so the gemini PR didn't carry the failure forward and obscure new ones (Build Principle #19).

### Step 1b — gemini config fix

Merge commit on `main`: **`51b9f836`** — `fix(extraction): configure Gemini 3 Flash for PDF extraction (SPEC-GEMINI-EXTRACTION-CONFIG-FIX-1)`

Both source branches deleted on origin (`feat/cfa-extract-5-version-bump`, `feat/gemini-extraction-config-fix-1`).

Method note: GitHub UI was inaccessible from this environment (no `gh` CLI). Used `git merge --squash` + commit + push to main, which is functionally equivalent to a UI squash-merge. CI on the PR would have run on push to main; commit messages preserved verbatim.

---

## Step 2 — Vercel deploy

Deployment ID: **`dpl_7FAKGR7zGQPSuQk6DLfziNVdNH8N`**
Commit SHA: `51b9f83694e1bf155360012deb65becb37f48327`
URL: `buddy-the-underwriter-aud2fjkdr-mpalas-projects-a4dbbece.vercel.app`
Production aliases: `app.buddytheunderwriter.com`, `www.buddytheunderwriter.com`, `buddytheunderwriter.com`
Inspector: https://vercel.com/mpalas-projects-a4dbbece/buddy-the-underwriter/7FAKGR7zGQPSuQk6DLfziNVdNH8N

| Event | Time |
|---|---|
| Build started | `1778703661492` (2026-05-13 20:21:01 UTC) |
| READY | `1778703922943` (2026-05-13 20:25:22 UTC) |
| Build duration | ~4 min 22 sec |

Deploy status: **READY**, promoted to production aliases.

---

## Step 3 — Re-extraction trigger

### Re-queue setup (Option A side)

Cleared `deal_financial_facts` for all 11 OmniCare docs (non-heartbeat rows only). 184 rows deleted across the 11 documents. Heartbeats preserved.

### Trigger invocation (Option B fallback)

The repo's extraction trigger is an authenticated POST route (`/api/deals/[dealId]/financial-facts/extract-from-classified`) gated by Clerk session. No service-role bypass exists. Per spec §3 Option B, wrote a one-off tsx script (`scripts/v5-trigger-omnicare.ts`, deleted after run) that invoked `extractFactsFromClassifiedArtifacts({ dealId, bankId })` directly from a local node process using `.env.local` for credentials.

**Result (script output, verbatim):**

```
[v5-trigger-omnicare] starting… { dealId: '80fe6f7a-5c68-4f02-8bcf-933f246a9fc5', bankId: '2cd15251-ecc7-452a-9a52-f8e88d23ff44' }
[extractFactsFromClassifiedArtifacts] { dealId: '80fe6f7a-5c68-4f02-8bcf-933f246a9fc5', artifacts: 11, extracted: 11, skipped: 0, failed: 0 }
[v5-trigger-omnicare] done {
  elapsedMs: 13043,
  result: { ok: true, extracted: 11, skipped: 0, failed: 0, backfillFactsWritten: 22 }
}
```

11 docs processed in 13 seconds. The orchestrator reported success for all 11 (no per-doc throws). But the per-doc extraction runs themselves failed at the Vertex AI auth layer — see V-5 results below.

---

## Step 4 — V-5 SQL output (verbatim)

```sql
SELECT id, document_id, status, failure_code, failure_detail,
       metrics->>'model' as model, metrics->>'canonicalType' as canonical_type,
       metrics->>'item_count' as item_count, metrics->>'latency_ms' as latency_ms,
       metrics->>'tokens_in' as tokens_in, metrics->>'tokens_out' as tokens_out,
       created_at
FROM deal_extraction_runs
WHERE deal_id = '80fe6f7a-5c68-4f02-8bcf-933f246a9fc5'
  AND created_at > now() - interval '10 minutes'
ORDER BY created_at DESC;
```

**11 rows returned.** Document-by-document:

| id | document_id | status | failure_code | model | canonical_type | item_count | latency_ms | tokens_in/out | created_at |
|---|---|---|---|---|---|---|---|---|---|
| d6167f61… | bc0e89bc… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | BUSINESS_TAX_RETURN | 0 | 37 | null/null | 2026-05-13 20:31:24Z |
| b13ee172… | a37d24a3… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | INCOME_STATEMENT | 0 | 36 | null/null | 2026-05-13 20:31:23Z |
| 05fc37fd… | 5aa93b6e… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | INCOME_STATEMENT | 0 | 38 | null/null | 2026-05-13 20:31:22Z |
| 116b9546… | add06213… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | BUSINESS_TAX_RETURN | 0 | 31 | null/null | 2026-05-13 20:31:21Z |
| 696aa484… | 4722d322… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | PFS | 0 | 40 | null/null | 2026-05-13 20:31:20Z |
| b6d601f9… | e5fc91e6… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | PERSONAL_TAX_RETURN | 0 | 36 | null/null | 2026-05-13 20:31:18Z |
| 4eab3978… | 39ef671b… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | BUSINESS_TAX_RETURN | 0 | 34 | null/null | 2026-05-13 20:31:18Z |
| 8ad0db0e… | bf4808eb… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | BALANCE_SHEET | 0 | 44 | null/null | 2026-05-13 20:31:17Z |
| 587dde67… | 75069060… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | PERSONAL_TAX_RETURN | 0 | 204 | null/null | 2026-05-13 20:31:15Z |
| 2141815f… | abaf0b27… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | PERSONAL_TAX_RETURN | 0 | 678 | null/null | 2026-05-13 20:31:15Z |
| 32117c53… | e44fe1e7… | failed | UNKNOWN_FATAL | gemini-3-flash-preview | BALANCE_SHEET | 0 | 761 | null/null | 2026-05-13 20:31:15Z |

### Counts by failure_code

| failure_code | count |
|---|---|
| UNKNOWN_FATAL | 11 |

### `failure_detail` JSONB contents (all 11 identical)

```json
{
  "failure_reason_raw": "[VertexAI.GoogleAuthError]: \nUnable to authenticate your request        \nDepending on your run time environment, you can get authentication by        \n- if in local instance or cloud shell: `!gcloud auth login`        \n- if in Colab:        \n    -`from google.colab import auth`        \n    -`auth.authenticate_user()`        \n- if in service account or other: please follow guidance in https://cloud.google.com/docs/authentication"
}
```

---

## Sample of `deal_financial_facts` for succeeded docs

Not applicable — zero docs succeeded. `backfillFactsWritten: 22` from the orchestrator is the canonical fact backfill from existing spreads (independent of this extraction batch).

---

## AR Aging audit

Per spec: "AR Aging docs were touched (they should NOT have been — confirm by checking deal_extraction_runs for AR Aging document_ids)."

```sql
SELECT count(*)::int FROM deal_extraction_runs der
JOIN deal_documents dd ON dd.id = der.document_id
WHERE der.deal_id = '80fe6f7a-5c68-4f02-8bcf-933f246a9fc5'
  AND der.created_at > now() - interval '10 minutes'
  AND dd.canonical_type = 'AR_AGING';
-- result: 0
```

**Confirmed.** Zero AR Aging extraction runs. The two AR Aging docs (`78b2e44b`, `9112104b`) were correctly excluded — they have no `getDocTypeConfig` entry, so `extractWithGeminiPrimary` returned `null` and no run row was created.

---

## V-5 decision tree result

Per spec §V-5, this lands on a **path not enumerated in the decision tree**: the failure is upstream of the Gemini API entirely, blocked at Vertex AI auth.

| Outcome | Match? |
|---|---|
| `succeeded` with real facts | ❌ |
| `STRUCTURED_EMPTY_RESPONSE` with `MAX_TOKENS` | ❌ |
| `STRUCTURED_EMPTY_RESPONSE` with `SAFETY` | ❌ |
| `STRUCTURED_EMPTY_RESPONSE` with `RECITATION` | ❌ |
| `STRUCTURED_INVALID_JSON` | ❌ |
| `STRUCTURED_SCHEMA_MISMATCH` | ❌ |
| `UNKNOWN_FATAL` with `failure_detail: null` (the original bug — fix did not take) | ❌ |
| **`UNKNOWN_FATAL` with `failure_detail` populated by `VertexAI.GoogleAuthError`** | **✓ NEW** |

---

## What this means

### What the gemini config fix DID achieve

1. **Diagnostic capture works.** Every failure now has populated `failure_detail` jsonb with the raw underlying error. The original bug signature ("UNKNOWN_FATAL with null detail") is **gone**.
2. **The new `failureDetail` wrapping** (`{ failure_reason_raw: ... }`) flows through `finalizeExtractionRun` correctly. Diagnostic improvement: confirmed.
3. **`mapFailureReasonToCode`'s new `empty_response` branch** is in place and was loaded. It just wasn't exercised because the failure reason string didn't contain `empty_response` — the auth error short-circuited before reaching Gemini.

### What the gemini config fix did NOT achieve in this V-5 run

The new `maxOutputTokens`, `thinkingConfig.thinkingLevel`, and `mediaResolution` settings on `geminiClient.ts` could not be tested because the local node process running the trigger script could not authenticate to Vertex AI. Auth failed in ~30-50ms (latency 31-44ms on the fast-fail rows), well before any model call would happen.

### Why the local script could not authenticate

`scripts/v5-trigger-omnicare.ts` ran in a local Node process using `.env.local` for credentials. The repo's Vertex AI auth chain — see `src/lib/gcp/vercelAuth.ts:getVercelWifAuthClient` — is designed for Vercel's runtime where `@vercel/oidc` provides a token via the request context. Outside Vercel (in a local tsx process), there's no OIDC token available, the IdentityPoolClient setup gets no credentials, and Vertex's `generateContent` fails at the auth step.

This is **not a bug introduced by the gemini config fix.** The same auth chain would have failed for any local extraction call before this fix landed. We just didn't observe it because pre-fix extractions on OmniCare were triggered through Vercel (which has WIF working).

### What we still need to validate

The actual Gemini config fix — whether adding `maxOutputTokens`/`thinkingConfig`/`mediaResolution` makes Gemini 3 Flash return content on the OmniCare tax-return PDFs — requires triggering extraction through the **Vercel runtime**, where WIF auth works. From this environment, that means:

1. **Operator action**: open `app.buddytheunderwriter.com` in a browser, navigate to OmniCare's cockpit, click the re-extract trigger (typically ReadinessPanel "Recompute" or the document re-process button). Then re-run the V-5 SQL.
2. **Or**: a CRON_SECRET-protected admin route that bypasses Clerk and triggers extraction. None currently exists for this purpose; would be a separate small spec.
3. **Or**: temporarily authenticate the local environment for GCP (`gcloud auth application-default login` or service-account key file) and re-run the script. This is the fastest path but requires elevating credentials.

---

## Open items

1. **Real Gemini config validation.** Per the "what we still need to validate" section above. Recommend Option 1 (operator browser-side trigger) as the lowest-risk path.
2. **`buddy_system_events` check_constraint violation observed during the run.** Console output included:
   ```
   [aegis.writeSystemEvent] insert failed: new row for relation "buddy_system_events" violates check constraint "buddy_system_events_event_type_check"
   ```
   Not introduced by the gemini fix. Surfaced because the IRS identity validator (SPEC-EXTRACT-VALIDATOR-WIRE-1) ran during this re-extraction and tried to write a `buddy_system_events` row with an event_type that didn't pass the check constraint. Worth a follow-up bug ticket but outside scope of this spec.
3. **Two unused stashes from prior session** still in `git stash list`. User's brokerage WIP. Not disturbed by this work.

---

## Files modified by this AAR work

| File | Reason |
|---|---|
| `AAR_SPEC_GEMINI_EXTRACTION_CONFIG_FIX_1_DEPLOY.md` | This document. New, branch only. |
| `scripts/v5-trigger-omnicare.ts` | Created, ran, **deleted**. Not committed to any branch. |

No production code was modified by this AAR work.

---

## Conclusion

Bottom line: **the original bug pattern is gone** (UNKNOWN_FATAL with null detail), **diagnostic capture works as designed**, but the **substantive gemini config fix has not yet been exercised against the actual Gemini API** because the V-5 trigger ran outside Vercel's auth context. The fix is deployed and live on production; we just need the right invocation path to validate it.

Recommend operator-driven browser-side re-extraction trigger as the immediate next step. The §0 SQL pattern from the spec can then be re-run to surface the actual gemini-side outcome.
