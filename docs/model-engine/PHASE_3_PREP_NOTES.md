# Model Engine V2 — Phase 3 Prep Notes

> Phase 3 was NOT executed in Phase 2. This document records preconditions only.

## Preconditions for Phase 3

1. **Phase 2 evidence complete** — All items in PHASE_2_CLOSEOUT.md evidence template checked off
2. **Parity results reviewed** — At least 4 archetype deals run through parity endpoint with no material differences (or explained exceptions)
3. **Staging deployment tested** — Model Engine V2 enabled (`USE_MODEL_ENGINE_V2=true`) on staging environment with no production side effects
4. **Rollback plan documented** — Clear procedure to disable V2 (set flag to false) with no data migration needed
5. **No production writes** — V2 model snapshots are opt-in (`?persist=true`) and isolated to `model_v2_snapshots` table; V1 pipeline unaffected
6. **Metric registry stable** — No new metric definitions added without parity re-validation
