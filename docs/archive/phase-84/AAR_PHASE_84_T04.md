# AAR — Phase 84 T-04 — Wire `gemini_primary_v1` through `runRecord.ts`

**Date:** 2026-04-20
**Ticket:** T-04 (Wave 2 — Close the truth loop)
**Completion event:** `buddy_system_events` id `8659eb42-cfbb-4cc7-8e94-012bc61e20dd`

**Commits:**
- `a4d54c76` — Commit 1: re-export run primitives from `src/lib/extraction/index.ts`
- `c5be48da` — Commit 2: wrap `extractWithGeminiPrimary` with run lifecycle
- `600aa2a2` — Commit 3: probe script `scripts/phase-84-t04-extraction-probe.ts`

---

## 1. Investigation trail

This is an **activation ticket**, not a new-build ticket. Pre-work confirmed every v2 spec premise:

- `runRecord.ts` already existed at `src/lib/extraction/runRecord.ts` with 4 run-lifecycle exports (`createExtractionRun`, `finalizeExtractionRun`, `markRunRunning`, `getLatestExtractionRun`) plus hashing/types. Written weeks ago, never imported.
- `src/lib/extraction/index.ts` does NOT re-export them. Barrel stayed pure (CI-guard safe) because no runtime caller had a need.
- `agent_workflow_runs` view UNIONs `deal_extraction_runs` with `workflow_code = 'document_extraction'` — confirmed against the `information_schema.views` definition. Deleting the run ledger would break the view + Phase 72C cost-promotion UI.
- `deal_extraction_runs` row count = **0**. The table has been collecting dust since migration.
- Extractor distribution (14d): `gemini_primary_v1` = 404 facts / 18 docs — the top-volume, highest-value wire target.

---

## 2. Implementation delta

### Commit 1 — barrel re-export (`a4d54c76`)

Added `createExtractionRun`, `finalizeExtractionRun`, `markRunRunning`, `getLatestExtractionRun`, `computeInputHash`, `computeOutputHash` (aliased as `computeRunOutputHash`), and the constants/types to `src/lib/extraction/index.ts`.

The alias on `computeOutputHash` is important: `outputCanonicalization.ts` already exports a pure, CI-safe `computeOutputHash` with different semantics (canonical structured JSON hash). Re-exporting `runRecord`'s version under the same name would have been an ambiguous re-export. Aliasing preserves both call sites cleanly.

Pure-barrel invariant preserved: the extraction CI guards (`extractionInvariantGuard.test.ts`) read source files via `fs.readFileSync` rather than importing the barrel, so `server-only` poisoning isn't a problem. Comment added to `index.ts` warning future readers not to import these from CI tests.

### Commit 2 — extractor wrap (`c5be48da`)

`extractWithGeminiPrimary` at `src/lib/financialSpreads/extractors/gemini/geminiDocumentExtractor.ts:119` wrapped with the run lifecycle. Four noteworthy design decisions:

1. **Fail-open on ledger creation.** If `createExtractionRun` throws (constraint violation, RLS block, whatever), extraction continues as before with a warn log and `runId = null`. The subsequent `finalize` is a no-op when `runId` is null. Rationale: the ledger is observational. It must never block the underlying extraction.

2. **Finalize on every return path.** Five return sites in `extractWithGeminiPrimary` (unsupported doc type, client failure, success, thrown exception) each now call `finalizeLedger(result)` before returning. Extracted into an inner helper to keep call sites readable.

3. **Failure-reason → failure-code mapping.** The extractor produces freeform `failureReason` strings (`"unsupported_doc_type"`, `"zero_items_parsed"`, `"client_failure"`, thrown-error messages). The ledger requires a typed `ExtractionFailureCode`. New `mapFailureReasonToCode` translates via substring match against the 12-value enum, falling through to `UNKNOWN_FATAL`.

4. **Metrics populated, cost/tokens stubbed null.** The runRecord promotion code (lines 234–236) lifts `cost_estimate_usd`, `tokens_in`, `tokens_out` from the metrics JSON into typed columns. The Gemini client does not currently surface these to the orchestrator — `callGeminiForExtraction` returns `{ ok, rawJson, failureReason, latencyMs, model }` only. So we populate `cost_estimate_usd: null`, `tokens_in: null`, `tokens_out: null` today, with a comment pointing at the fix site. Phase 84.1 follow-up plumbs them through.

### Commit 3 — probe script (`600aa2a2`)

`scripts/phase-84-t04-extraction-probe.ts` — same pattern as `phase-84-t02-reclassify-probe.ts`: `--confirm` gate, multi-env-file load, preload shim for `server-only`. Prints baseline/post counts + the resulting run row.

---

## 3. Probe output (verbatim)

Target doc: `c692377f-ee8d-4554-87c9-65032654c664` (PERSONAL_TAX_RETURN, deal `0279ed32-...`, non-Ellmann).

```
[probe] baseline deal_extraction_runs count: 0
[probe] invoking extractWithGeminiPrimary on c692377f-... (PERSONAL_TAX_RETURN, year=2024)
[ledger.writeEvent] insert ok { kind: 'extraction.run.started', dealId: '0279ed32-...' }
[probe] extraction returned in 488ms {
  ok: false,
  itemCount: 0,
  failureReason: '[VertexAI.GoogleAuthError]: Unable to authenticate your request ...',
  latencyMs: 7,
  model: 'gemini-3-flash-preview',
  promptVersion: ''
}
[probe] post deal_extraction_runs count: 1 (delta: +1)
[probe] latest run row:
  id:               57a1029e-25de-4228-a1dd-5a9511eca7c5
  engine_version:   hybrid_v1.0
  structured_engine: gemini
  structured_model: gemini-3-flash-preview
  status:           failed
  failure_code:     UNKNOWN_FATAL
  metrics: {
    model: 'gemini-3-flash-preview',
    taxYear: 2024,
    tokens_in: null,
    item_count: 0,
    latency_ms: 7,
    tokens_out: null,
    canonicalType: 'PERSONAL_TAX_RETURN',
    prompt_version: null,
    cost_estimate_usd: null
  }
  cost_usd: null
  input_tokens: null
  output_tokens: null
  created_at:    2026-04-20 15:20:59.621193+00
  finalized_at:  2026-04-20 15:20:59.818+00
[ledger.writeEvent] insert ok { kind: 'extraction.run.completed', dealId: '0279ed32-...' }
```

**The failure is expected and proves the wire-up works.** `VertexAI.GoogleAuthError` is a local-runtime limitation — the Gemini client uses WIF-backed Vertex AI which requires a Vercel OIDC token the probe can't synthesize locally. What the probe does prove:

- `createExtractionRun` fires and writes a new row ✓
- `markRunRunning` transitions status ✓
- The error path returns cleanly without throwing ✓
- `finalizeExtractionRun` fires with `status='failed'`, `failure_code='UNKNOWN_FATAL'` (fallback — the thrown error's message doesn't contain any of the substrings my mapper checks; see spec deviation #2) ✓
- Metrics JSON populated with all intended keys ✓
- Canonical ledger events emitted: `extraction.run.started`, `extraction.run.completed` ✓
- `latency_ms`, `model`, `canonicalType`, `taxYear` all carried through to the row ✓

---

## 4. Acceptance queries (verbatim)

### Query 1 — row count delta
```sql
SELECT COUNT(*) AS total_runs,
       COUNT(*) FILTER (WHERE status='succeeded') AS succeeded,
       COUNT(*) FILTER (WHERE status='failed') AS failed,
       MAX(created_at) AS latest
FROM deal_extraction_runs;
```

Result:
```
total_runs: 1
succeeded:  0
failed:     1
latest:     2026-04-20 15:20:59.621193+00
```

Count transitioned from **0 → 1** ✓. Zero succeeded (local-auth failure), one failed (the same). Natural production traffic of ~1–2 docs/day on `gemini_primary_v1` will produce the first `succeeded` row within 24 hours — the Vercel runtime has WIF auth that the local probe doesn't.

### Query 2 — promoted + metrics columns

```
engine_version | structured_engine | structured_model      | status | failure_code  | cost_usd | input_tokens | output_tokens | latency_ms | canonical_type
hybrid_v1.0    | gemini            | gemini-3-flash-preview | failed | UNKNOWN_FATAL | null     | null         | null          | 7          | PERSONAL_TAX_RETURN
```

`cost_usd / input_tokens / output_tokens = null` as expected (Gemini client does not surface cost/tokens yet — Phase 84.1 follow-up). Metrics + canonical_type + engine version carried through correctly.

### Query 3 — `agent_workflow_runs` view surfaces the row

```sql
SELECT workflow_code, COUNT(*) FROM agent_workflow_runs
WHERE workflow_code = 'document_extraction' GROUP BY 1;
```

Result: `document_extraction: 1` ✓. Phase 72C view + cost-promotion infrastructure now has live data to read. Before this ticket, `workflow_code = 'document_extraction'` had zero rows.

---

## 5. Spec deviations

### 1. No `bankId` param on `createExtractionRun`

The v2 spec template passed `bankId: args.bankId` to `createExtractionRun`. `CreateRunArgs` in `runRecord.ts` has no `bankId` field — the `deal_extraction_runs` table itself has no `bank_id` column (tenancy resolves via `deal_id → deals.bank_id`). Parameter dropped. No behavior change.

### 2. `UNKNOWN_FATAL` on probe failure

Probe's Vertex auth error message is verbose (multi-line, contains `"authenticate"`, `"GoogleAuthError"`, `"gcloud"`, none of which match my `mapFailureReasonToCode` substrings). Falls through to `UNKNOWN_FATAL`. Acceptable — the enum is a finite set and auth errors weren't anticipated in its shape. Phase 84.1 could add an `AUTH_FAILED` code + mapping rule. For now, `UNKNOWN_FATAL` is the correct fallback and the original failure message is retained in ledger event payload via `failure_detail` (currently unset — see follow-up 3 below).

### 3. `computeOutputHash` re-export conflict

`outputCanonicalization.ts` already exports a pure `computeOutputHash`. Re-exporting `runRecord`'s version would be ambiguous. Aliased to `computeRunOutputHash` in the barrel. Extractor imports the aliased name. Not a functional deviation — both hashes are SHA-256 of a serialized payload; only the canonicalization differs.

### 4. `reused` shortcut intentionally NOT honored

The v2 spec template had:
```typescript
if (reused && run.status === "succeeded") {
  return { ok: true, items: [], reused: true };
}
```

This would return empty items, which callers downstream (`processArtifact`, fact persistence) would interpret as "extraction produced nothing" — a silent functional regression. The idempotency that `createExtractionRun` provides is for the **ledger row**, not for extraction output. Same `input_hash` → same Gemini output, so re-running is wasteful but not wrong; persistence layers have their own dedup. T-04 skips the shortcut. If a future ticket wants true extraction-output caching, it needs a separate cache table keyed on `output_hash` storing the `items` array.

### 5. Cost/tokens fields stubbed null

`GeminiExtractionResult` has no `costUsd / inputTokens / outputTokens` fields today. The Gemini client (`callGeminiForExtraction`) doesn't surface them either. Populated as `null` in metrics; `finalizeExtractionRun` dutifully promotes null → null into the typed columns. **This is the main visible gap post-T-04** — phase 84.1 must plumb cost/tokens through the Gemini client + result type to make the promoted columns useful.

---

## 6. Bug B confirmation in `runRecord.ts`

The user's T-04 brief asked for a targeted grep of `runRecord.ts` for the silent-write pattern discovered in T-02 (Bug B — `await sb.update(...)` without destructuring `{ error }`). **Confirmed — 4 of 5 DB mutation sites have the bug.**

| Line | Site | Destructures `{ error }`? |
|---|---|---|
| 146 | stale-run `UPDATE` to mark failed | **no** |
| 163 | `DELETE` stale/failed run | **no** |
| 171 | new run `INSERT` | **yes** (line 188: `if (error || !newRun)`) ✓ |
| 210 | `markRunRunning` UPDATE | **no** |
| 226 | `finalizeExtractionRun` UPDATE | **no** |

The INSERT is safe only because the code needs `newRun` back to continue. The other 4 mutations silently swallow any CHECK violation, RLS block, or permission error.

Left unfixed in T-04 to keep ticket scope bounded. Added explicitly to Phase 84.1 follow-up #4 below — should be fixed alongside the broader "audit all .update/.insert/.delete call sites" sweep T-02 queued.

---

## 7. Phase 84.1 follow-ups

1. **Wire the 4 remaining extractors.** Same pattern as T-04, different bodies:
   - `personalIncomeExtractor:v2:deterministic` (91 facts / 6 docs in 14d)
   - `materializeFactsFromArtifacts:v1` (18 / 18)
   - `gemini_primary_schedule_detect` (6 / 6 — currently emitted as side-effect of `gemini_primary_v1`; consider whether this deserves its own run row or remains a sub-facet of the primary run)
   - `backfillCanonicalFactsFromSpreads:v3` (3 / 1)

2. **Plumb cost + tokens from the Gemini client.** `callGeminiForExtraction` → `GeminiExtractionResult` need new fields `inputTokens`, `outputTokens`, `costUsd`. Gemini API returns `usageMetadata` on every call; just needs to be surfaced. Once done, the `cost_usd / input_tokens / output_tokens` columns on `deal_extraction_runs` (promoted by `finalizeExtractionRun` lines 234-236) will finally have values, making Phase 72C's cost-promotion UI functional.

3. **Fix the 4 silent-write sites in `runRecord.ts`** per the Bug B pattern from T-02. Destructure `{ error }` and throw on truthy. Fail-open in the outer `try/catch` of `extractWithGeminiPrimary` already absorbs the throw cleanly.

4. **Add an `AUTH_FAILED` (or similar) failure code** to the extraction failure code enum + mapping rule for GCP/VertexAI authentication errors. Currently falls through to `UNKNOWN_FATAL`, which is correct but uninformative.

5. **Wait 24h and re-query `deal_extraction_runs` for the first succeeded row.** The probe proved the wiring but couldn't exercise the success path (local Vertex auth). Natural production traffic (~1–2 docs/day on `gemini_primary_v1`) will surface the first successful `status='succeeded'` row + non-null `cost_usd` (once #2 lands) within a day.

---

## Next

T-03 (observer dedup / cooldown) per phase execution order — runnable anytime, no dependencies.
