# Sprint 6B — Golden Deal Run (end-to-end pipeline execution)

**Procedure / spec.** Durable artifact. Re-runnable as a regression harness whenever a new release lands.

> **This run is expected to fail.** The goal is not success — it is to surface the true state of the pipeline. A run that completes Stage 12 with green checkmarks but vague evidence is less valuable than a run that halts at Stage 4 with sharp diagnostic findings. Operators should resist the natural pull to "make stages pass." If a producer doesn't fire, document precisely what happened and continue (or halt per matrix below). Don't fix inline. Don't paper over.

---

## Naming convention

| Artifact | Path | Frequency |
|---|---|---|
| **Spec (this file — the procedure)** | `specs/brokerage/sprint-06b-golden-deal-run.md` | Written once, evolves via amendments |
| **Run results (the trace)** | `specs/brokerage/golden-deal-run-YYYY-MM-results.md` | One file per run, dated, never overwritten |

Note on the "06b" suffix: there is already a `sprint-06-marketplace-and-pick.md` on `main` (the planned post-Sprint-5 marketplace + claim work). This spec is part of the **Sprint 6 audit cluster** introduced 2026-04:

- **Sprint 6A** — underwriting audit (read-only). Deliverable: `specs/brokerage/underwriting-audit-2026-04.md` (currently on PR #342, branch `audit/underwriting-2026-04`).
- **Sprint 6B** — Golden Deal Run (this spec). Read-write against a dedicated test deal.
- **Sprint 6C** — P0 fix sprint scoped against the Golden Deal Run's findings, not the audit's predictions.
- **Sprint 6D** — quality sprint for the P1s.

---

## Run metadata block (operator fills before starting)

Every run begins with the operator filling out this block. It anchors the run to a specific code state and environment.

```md
## Run Metadata
- Run ID: golden-deal-YYYY-MM-DD
- Environment: <preview-url-or-staging-url>
- Branch executed against: main (or fork name)
- Commit SHA: <git rev-parse HEAD>
- Operator: Claude Code / Matt / [other]
- Run start: <ISO timestamp>
- Run end: <ISO timestamp>
- Test deal name: Madison Bagel Co (Golden Run)
- Test deal ID: <captured at Stage 1>
```

If the run is restarted partway through (e.g., halted at Stage 4, fixed, resumed), the operator fills in a new block in the same results file with `Run ID: golden-deal-YYYY-MM-DD-resume-N`. Each block has its own start/end timestamps and SHA. Don't fold resumed-runs into the original metadata.

---

## Why this exists

The 2026-04-25 underwriting audit (`specs/brokerage/underwriting-audit-2026-04.md`, PR #342) revealed that the dev DB has never seen a deal flow end-to-end. 5 of 12 pipeline tables are globally empty. Six of the audit's 13 P0 findings were predictions about what would break, not observations of real failures, because the producers were never triggered.

The Golden Deal Run produces three artifacts:

1. **Baseline truth.** At every transition: what tables get written to, what their values look like, what fails. Captured in real time.
2. **Audit prediction validation.** Which P0s reproduce on a real run, which don't, and what new failures emerge that the audit missed.
3. **A fixture replacing the hand-seeded "ChatGPT Fix N" pattern.** The deal created by this run becomes the canonical "real flow" reference for future audits.

This is **not a smoke test**. A smoke verifies wiring works. The Golden Deal Run instruments the pipeline, captures state at every transition, and produces analysis. It's an integration audit with active driving.

---

## Pre-flight verification (HALT until all four pass)

Operator MUST NOT start the run until all four prerequisites are confirmed. Each is verifiable; no assumptions.

### 1. Fly gateway redeploy

The Sprint 2 voice gateway has not been redeployed since the merge. Until this happens, voice transcripts won't dispatch to `confirmed_facts`, and the run cannot exercise the voice path.

**Action (Matt):**
```bash
cd buddy-voice-gateway/
fly deploy -a buddy-voice-gateway
fly logs -a buddy-voice-gateway   # watch for clean startup
```

**Verification (operator):**
```bash
fly status -a buddy-voice-gateway
# Look for: Status=running, recent deployment timestamp (today or yesterday)
```

If status shows a deployment older than 5 days OR Status≠running, **HALT** and flag.

### 2. Sprint 5 PR #341 merged + SealPackageCard wired

Until merged, the Golden Deal Run cannot exercise sealing. Until SealPackageCard is wired into `/start`, the borrower-side sealing path doesn't have a UI surface.

**Action (Matt):** wire the one-line `<SealPackageCard dealId={dealId} />` into the appropriate `/start` client component, push, approve, merge.

**Verification (operator):**
```bash
gh pr view 341 --json state -q .state
# Expected: "MERGED"

git grep -l "SealPackageCard" src/components src/app
# Expected: at least one file in src/app/ in the result
```

If PR is not merged OR SealPackageCard is not imported anywhere in `src/app` or `src/components`, **HALT** and flag.

### 3. Vercel preview URL identified

The run executes against a real preview, not localhost. Production is off-limits.

**Action (Matt):** confirm a stable preview URL pointing at a recent main commit.

**Verification (operator):**
```bash
curl -sI https://<preview-url>/start | head -1
# Expected: HTTP/2 200
```

### 4. Pre-flight DB sanity check

Confirm the dev DB hasn't drifted further since the audit. The 5 globally-empty tables should still be empty (proving no stealth fixture was added between audit and this run).

```sql
SELECT
  CASE WHEN (SELECT count(*) FROM buddy_sba_scores) = 0 THEN '✓' ELSE '✗ unexpected scores' END AS scores,
  CASE WHEN (SELECT count(*) FROM buddy_trident_bundles) = 0 THEN '✓' ELSE '✗ unexpected bundles' END AS bundles,
  CASE WHEN (SELECT count(*) FROM buddy_validation_re