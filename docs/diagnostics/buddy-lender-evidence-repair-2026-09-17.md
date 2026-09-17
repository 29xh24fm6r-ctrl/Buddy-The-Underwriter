# Lender evidence repair — 2026-09-17

## Production evidence

PR 1097 production run `d1f56a3d-71f4-490c-96ef-e7ce81980760` on synthetic deal `d4b7104f-7f4b-4ae8-ac39-c2dbbdad3562` completed and bound all six nonempty artifacts. Stored narratives still omitted confirmed terms and management, mislabeled combined debt service as proposed debt service, and lacked precise feasibility citations. Structural grading reported 98/100. This established generation success, not lender readiness.

## Repairs

- Expose the existing projection engine's retained, proposed-loan and seller debt-service components. Send those outputs, confirmed revenue/cost/working-capital/financing assumptions and the governed threshold to both narrative generation and review. No second calculator or additional AI call.
- Supplement missing memo terms and management with confirmed borrower assumptions. Keep lender pricing and dedicated management records authoritative. Conflicting request terms or priced rates require assumption review. A modeled rate is explicitly labeled as pending lender pricing.
- Pass management qualifications and cash-flow provenance to the same memo generator/reviewer contract. Distinguish Five Cs from the recommendation risk-grade scale. Missing adjustment support remains an evidence gap, not an invented cash-flow bridge.
- Persist structured memo review findings in the existing metadata column. Quality grading requires review for missing terms/management, pending lender pricing, differing historical/underwriting cash-flow bases and preliminary coverage. This is an underwriter review cue, not a semantic certification of prose.
- Recompute feasibility citation attribution after text repair. Missing precise citations require review even when synthetic generation is allowed. No sources are fabricated for synthetic research.
- Hide an old failure once a new run is accepted, refresh server status, and retain the new run's own polling/errors. Label the numeric grade as structural completeness.
- Include confirmed management in memo freshness inputs and advance the memo evidence hash version so old cached narratives regenerate.

## Validation

Behavioral regressions cover term/rate conflicts, zero rates, draft exclusion, management propagation, cash-flow review findings, debt-component reconciliation including seller payoff and existing-debt payoff, projection facts reaching both model calls, citation invalidation after repair, and quality gating despite long prose. Existing unit and react-server suites are run before handoff; exact final results are recorded in the PR.

No database migration or production data changes are required. `canonical_memo_narratives.metadata_json` was verified to exist as JSONB. The application continues to require the existing authenticated generation permissions.

## Deployment acceptance

Regenerate the synthetic deal after deployment. Verify term 120 months, modeled rate 10.5%, supplied management experience, total debt service split into its model-calculated components, and all six run-bound output paths. An unverified historical-to-underwriting cash-flow bridge and synthetic research citations must remain visible review requirements; a synthetic successful run is not proof of a signed lender-ready loan.

Production outputs have not yet been generated with this repair. Actual downloaded PDF/XLSX layout, microphone capture, signatures and lender handoff remain unverified. Browser storage-download policy prevents automated opening of the production files in this session; no alternate download path was used.
