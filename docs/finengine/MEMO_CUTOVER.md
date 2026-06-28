# Finengine Memo Cutover — Runbook

**Spec:** SPEC-FINENGINE-MEMO-CUTOVER-1 · **Mode:** gate-first, flip-last, default-OFF, instant-revert.

The finengine credit memo can replace the legacy `classicSpread` renderer **per tenant**, behind a flag that defaults OFF. The legacy renderer stays in place as the instant-revert fallback (NG2). No legacy code is deleted.

## The flag
- Per-tenant: `MEMO_ENGINE_CUTOVER_TENANTS` — a comma-separated allowlist of `bank_id`s for whom the engine is live.
- Resolved by `resolveMemoCutoverFlags(env)` → `isMemoEngineCutOver(bankId, flags)` / `memoRenderSource(bankId, flags)`.
- **Absent / not listed ⇒ `legacy`** (every tenant today). Add a `bank_id` to flip ON; remove it to revert instantly. No deploy of code, no data migration.

## What ON changes
1. **Submission gate (live now).** `POST /api/deals/[dealId]/credit-memo/submit` runs the cutover gate for a flipped-on tenant: it loads the deal's certified facts, computes + validates the spread (selection-layer guard + decision-metric goldens + audited anchors), and **blocks finalization (HTTP 409 `finengine_cutover_blocked`) if any decision metric is UNEXPECTED** vs the independent golden. A blocked memo is resolved by fixing the source data or registering the divergence as INTENDED. For a legacy tenant this branch is skipped entirely — submission is byte-for-byte unchanged (V4.1).
2. **Memo assembly.** `loadFinengineMemo(dealId, { bankId, signals })` builds the engine-backed memo package (`buildFinengineMemoPackage`): every financial section (risk rating, covenants, stress, global cash flow, collateral, the explained multi-period spread) is computed by the engine modules; the borrower label resolves `display_name ?? borrower_name ?? name` (G5). The render route consumes this when ON.

## Go-live sequence (per tenant)
1. **Parity diff.** Run the read-only `scripts/finengine-full-spread.ts` for the tenant's deals; render both legacy and finengine memos and diff section-by-section. Some differences are **intended improvements** — e.g. the +$200,925 EBITDA correction (SPEC-FINENGINE-LIVE-SPREAD-1) — and are pre-registered, not regressions. Any *unexplained* difference is a stop.
2. **Confirm the gate is clean.** `validateSpread(...).cutoverBlocked === false` for the tenant's deals (0 UNEXPECTED), or every divergence is a registered INTENDED.
3. **Flip ON.** Add the `bank_id` to `MEMO_ENGINE_CUTOVER_TENANTS`.
4. **Watch.** Submissions now enforce the gate. A 409 means the spread diverged — investigate before overriding.
5. **Revert** anytime by removing the `bank_id` — instant, legacy path resumes.

## Invariants (V4)
- **V4.1** — flag OFF reproduces the legacy memo byte-for-byte (the route's existing path is untouched; the finengine branch is only entered when ON).
- **V4.2** — flag ON produces the complete engine memo and blocks finalization on any UNEXPECTED decision metric.
- **V4.3** — parity diff documented; intended improvements registered; no unexplained regression.
- **V4.4** — read-only: the render/submit path writes no canonical fact; `guard:all` + `tsc` green.

## Files
- `src/lib/finengine/featureFlags.ts` — `isMemoEngineCutOver`, default OFF.
- `src/lib/finengine/memo/loadFinengineMemo.ts` — `memoRenderSource`, `resolveMemoCutoverFlags`, `loadFinengineMemo` (injectable loaders; DB imported lazily).
- `src/lib/finengine/memo/finengineMemoPackage.ts` — `buildFinengineMemoPackage`, `memoGate`, `assertCutoverClean`, `enforceMemoSubmission`.
- `src/app/api/deals/[dealId]/credit-memo/submit/route.ts` — the gated enforcement wire.
- Legacy (unchanged, the fallback): `src/app/api/deals/[dealId]/classic-spread/route.ts`, `src/lib/classicSpread/*`.
