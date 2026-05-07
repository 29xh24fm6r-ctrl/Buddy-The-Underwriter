# Doc Engine Upgrade — Stashed Work (paused for SPEC-FLOW-V1)

stash@{2}  doc-engine-upgrade WIP — primary (SPEC-00..05 work, audit log)
stash@{0}  doc-engine-upgrade WIP — SPEC-06 successor (post-audit, period-resolution race-window fix)

Both stashes belong to the same thread. Pop stash@{2} first, then stash@{0}
on top, when resuming doc-engine work post-SPEC-FLOW-V1.
Files in stash@{0} (per investigation 2026-05-08):
  - src/lib/financialSpreads/extractFactsFromDocument.ts (SPEC-06 race fix)
  - src/lib/financialSpreads/extractors/deterministic/commercialLeaseExtractor.ts
  - src/lib/financialSpreads/extractors/deterministic/creditMemoExtractor.ts
  - specs/doc-engine-upgrade/ (subset)
  - src/lib/documentEngineGolden/
  - src/lib/extract/__tests__/spec06PeriodResolutionGuard.test.ts
