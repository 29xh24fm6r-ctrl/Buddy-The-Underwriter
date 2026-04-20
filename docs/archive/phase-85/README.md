# Phase 85 — Borrower Intake Experience

Phase directory for the borrower intake experience build.

## Sub-phases

- **T-85-PROBE-1** — SBA forward model canary run (pre-execution validation)
- **85A** — Intake route foundation (route group, shell, Step 1, token resolution)
- **85B** — Business profile + owners + auto-fill (Steps 2–3)
- **85C** — Document checklist integration (Step 4)
- **85-BPG-A** — Assumption interview UI (Step 3.5 conversational)
- **85-BPG-B** — Live projection dashboard (real-time recalculation)
- **85-BPG-C** — Business plan narrative generation (10-section plan, PDF)
- **85D** — Review, submit, status (Steps 5–6)
- **85E** — Polish, mobile, route migration

## Related specs

- `specs/phase-85-borrower-intake-architecture.md` (Phase 85 blueprint)
- `specs/phase-85-bpg-business-plan-generator.md` (BPG sub-phase spec)

## Key dependency

Phase 85-BPG-A/B/C depend on the SBA forward model (`lib/sba/sbaForwardModelBuilder.ts`, `lib/sba/sbaPackageOrchestrator.ts`) being proven to produce sane output against production data shapes. That validation is the scope of T-85-PROBE-1, which runs before Phase 85A begins.
