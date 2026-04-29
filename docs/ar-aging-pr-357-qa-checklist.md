# PR #357 — AR Aging Classification: Manual QA Checklist

Pre-merge gate for PR #357. Validates that an AR aging document uploaded
to the preview deploy reliably classifies as `document_type = 'AR_AGING'`
(and `canonical_type = 'AR_AGING'`), and that negative controls (AP
aging, balance sheet with AR line item) do NOT classify as `AR_AGING`.

**Estimated time**: 10–15 minutes.

**Scope**: PR #357 only. Does not touch PR #356 (AR collateral processor),
does not touch the multi-section WIP on `hotfix/route-cap-demo-removal`.

---

## 0. Preconditions

- [ ] PR #357 preview deploy is **READY** in Vercel (look for the green check on the PR's preview comment).
- [ ] Tester can sign in to the preview as a banker (Clerk session valid).
- [ ] Tester has the **Omnicare AR Aging PDF** on hand. (The version that was previously classified as `OTHER` on `main`.)
- [ ] Tester has either:
  - Direct Supabase SQL access (SQL Editor or `psql`), **or**
  - Ability to paste back the `document_id` so someone with SQL access can run the queries below.
- [ ] Negative-control fixtures (optional but recommended):
  - A balance sheet PDF that contains "Accounts Receivable" as a line item but is NOT an aging report.
  - An AP aging / accounts payable aging PDF.

---

## 1. Manual UI steps

1. Open the PR #357 Vercel preview URL.
2. Sign in as the test banker.
3. Either pick an existing test deal in `docs_in_progress`/`collecting`, or create a fresh deal via the deals UI.
4. Open the deal's intake / documents tab.
5. **Upload the Omnicare AR Aging PDF.**
6. Wait for classification to complete (status badge transitions from `Uploaded` → `Pending Review` or `Auto-Confirmed`, typically 15–60 seconds).
7. Capture either the `document_id` (visible in the URL or row metadata in the intake panel) or the `deal_id` + filename so the SQL queries below can locate the row.
8. (Optional) Repeat upload for each negative-control fixture you have.

---

## 2. Supabase verification queries

All queries are read-only. Paste into Supabase SQL Editor.

### 2.A — Find the uploaded Omnicare document

```sql
select id, deal_id, original_filename,
       document_type, canonical_type,
       classification_tier, classification_version,
       classification_confidence, classification_reason,
       match_evidence,
       routing_class,
       intake_status,
       created_at, updated_at
from deal_documents
where original_filename ilike '%omnicare%'
order by created_at desc
limit 5;
```

Take the `id` from the most recent row → use as `<DOCUMENT_ID>` below.

### 2.B — Exact document verification by `document_id`

```sql
select id, original_filename,
       document_type, canonical_type,
       classification_tier, classification_version,
       classification_confidence, classification_reason,
       match_evidence,
       routing_class,
       intake_status
from deal_documents
where id = '<DOCUMENT_ID>';
```

### 2.C — Helper: list everything classified as AR_AGING in this deal

Sanity check that nothing unexpected has been mis-classified.

```sql
select id, original_filename, classification_tier,
       classification_confidence, classification_reason
from deal_documents
where deal_id = '<DEAL_ID>'
  and (document_type = 'AR_AGING' or canonical_type = 'AR_AGING')
order by created_at desc;
```

---

## 3. Expected result for Omnicare

| Field | Expected value |
|---|---|
| `document_type` | `AR_AGING` |
| `canonical_type` | `AR_AGING` |
| `routing_class` | `GEMINI_STANDARD` |
| `classification_confidence` | `>= 0.80` (most likely **0.89** if Tier 2's `AR_AGING_KEYWORD_AND_TABLE` pattern hit) |
| `classification_tier` | one of `rules`, `gemini`, or `docai` (Spine maps `tier2_structural` → legacy `rules`) — populated, not null |
| `classification_version` | populated (Spine version string, e.g. `v2.2`) |
| `classification_reason` | references AR aging — e.g. `"Tier 2 structural pattern accepted (confidence 0.89)"` |
| `match_evidence` | JSONB array. At least one entry should have `anchorId` matching one of `AR_AGING_KEYWORD_AND_TABLE`, `AR_AGING_TABLE_STRUCTURE`, or `AR_AGING_KEYWORD_ONLY`, and `matchedText` should reference: |
| | • a keyword (e.g. `keyword:A/R aging`, `keyword:accounts receivable aging`, `keyword:aging summary`) |
| | • aging buckets (e.g. `bucket:current`, `bucket:1-30`, `bucket:31-60`, `bucket:61-90`, `bucket:>90`) |
| | • optional: a customer column (`customer_column:customer (column header)`) |

A passing `match_evidence` shape will look like:
```json
[
  { "type": "structural_match", "anchorId": "AR_AGING_KEYWORD_AND_TABLE",
    "matchedText": "keyword:A/R aging", "confidence": 0.89 },
  { "type": "structural_match", "anchorId": "AR_AGING_KEYWORD_AND_TABLE",
    "matchedText": "bucket:current",   "confidence": 0.89 },
  { "type": "structural_match", "anchorId": "AR_AGING_KEYWORD_AND_TABLE",
    "matchedText": "bucket:1-30",      "confidence": 0.89 },
  ...
]
```

---

## 4. Negative controls

### 4.A — Balance sheet with "accounts receivable" line item

Upload a balance sheet PDF that lists Accounts Receivable as an asset
line item but is NOT an aging report. Then run:

```sql
select id, original_filename, document_type, canonical_type,
       classification_tier, classification_confidence, classification_reason
from deal_documents
where original_filename ilike '%balance%sheet%'
   or original_filename ilike '%bs%'
order by created_at desc
limit 5;
```

**Expected**:
- `document_type` is **NOT** `AR_AGING` (likely `BALANCE_SHEET` or `FINANCIAL_STATEMENT`).
- `canonical_type` is **NOT** `AR_AGING`.

### 4.B — AP aging / accounts payable aging

Upload an AP aging or vendor aging PDF. Then run:

```sql
select id, original_filename, document_type, canonical_type,
       classification_tier, classification_confidence, classification_reason,
       match_evidence
from deal_documents
where original_filename ilike '%payable%'
   or original_filename ilike '%ap%aging%'
   or original_filename ilike '%vendor%'
order by created_at desc
limit 5;
```

**Expected**:
- `document_type` is **NOT** `AR_AGING` (likely `OTHER` — there is no `AP_AGING` type today).
- `canonical_type` is **NOT** `AR_AGING`.
- `match_evidence` should NOT contain any `anchorId` starting with `AR_AGING_`.

### 4.C — Sanity sweep: nothing else accidentally became AR_AGING

```sql
-- Anything classified as AR_AGING on this deal that doesn't have
-- "aging" or "receivable" in its filename is suspicious.
select id, original_filename, document_type, canonical_type,
       classification_confidence, classification_reason
from deal_documents
where deal_id = '<DEAL_ID>'
  and (document_type = 'AR_AGING' or canonical_type = 'AR_AGING')
  and not (
    original_filename ilike '%aging%' or
    original_filename ilike '%ageing%' or
    original_filename ilike '%receivable%' or
    original_filename ilike '%a/r%' or
    original_filename ilike '%ar_aging%' or
    original_filename ilike '%ar-aging%'
  );
-- Expect: 0 rows.
```

---

## 5. Pass / fail criteria

**PASS** — merge PR #357 if **all four** are true:

1. ✅ Omnicare's `document_type = 'AR_AGING'`.
2. ✅ Omnicare's `canonical_type = 'AR_AGING'` (this is the load-bearing one — PR #356 keys off canonical_type).
3. ✅ At least one negative control (4.A or 4.B, whichever was tested) does **NOT** classify as `AR_AGING`.
4. ✅ Sanity sweep (4.C) returns 0 rows.

**FAIL** — block merge of PR #357 if **any** are true:

1. ❌ Omnicare's `document_type` is `OTHER` (regression — same bug PR #357 was meant to fix).
2. ❌ Omnicare's `canonical_type` is `OTHER` (Tier 2 detected it but `docTypeRouting` collapsed it — different bug).
3. ❌ AP aging document was classified as `AR_AGING` (negative gate broken — would feed PR #356's processor with payables data).
4. ❌ Balance sheet was classified as `AR_AGING` ("current" / "accounts receivable" false-positive).
5. ❌ Sanity sweep (4.C) returns ≥1 row that shouldn't have been classified as AR_AGING.

**INCONCLUSIVE** — request re-test if:
- Classification pipeline didn't complete (still `Uploaded` after 5 minutes — investigate ingest queue, then re-run).
- `match_evidence` is null but `document_type='AR_AGING'` (acceptance with no audit trail — surface, then re-test).

---

## 6. Tester report template

Paste this filled-in into the PR #357 review thread.

```
Preview URL:               https://...vercel.app
Deal ID:                   <UUID>
Omnicare document ID:      <UUID>
Omnicare document_type:    <value>
Omnicare canonical_type:   <value>
Confidence:                <0.xx>
Tier / Version:            <tier> / <version>
Reason:                    <classification_reason>
Evidence (anchor IDs hit): <list of patternIds from match_evidence>
Evidence (sample matched): <2-3 matchedText entries>

Negative control 4.A (balance sheet):
  filename:                <name>
  document_type:           <value>          ← must NOT be AR_AGING
  canonical_type:          <value>          ← must NOT be AR_AGING

Negative control 4.B (AP aging):
  filename:                <name>
  document_type:           <value>          ← must NOT be AR_AGING
  canonical_type:          <value>          ← must NOT be AR_AGING

Sanity sweep 4.C row count: <n>             ← must be 0

PASS / FAIL:               <PASS|FAIL>
Recommendation:            <merge | do not merge>
Notes:                     <free text, especially if FAIL>
```

---

## Out of scope (do NOT validate here)

- PR #356 (AR collateral processor / borrowing-base) — separate validation after PR #357 merges.
- Multi-section package work (`hotfix/route-cap-demo-removal` WIP) — separate QA checklist already exists at `docs/multi-section-package-qa-checklist.md`.
- AR Aging extraction / fact writes — PR #357 only validates **classification**. Extracting facts from AR aging documents is downstream work covered by PR #356 + future work.
