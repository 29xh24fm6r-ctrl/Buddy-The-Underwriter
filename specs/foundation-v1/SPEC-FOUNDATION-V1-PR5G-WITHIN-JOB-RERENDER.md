# SPEC-FOUNDATION-V1-PR5G — Within-Job GLOBAL_CASH_FLOW Re-Render

**Status:** Ready for Claude Code (small scope — 1 to 2 days)
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** opens against `feat/foundation-v1-pr5g-within-job-rerender`
**Depends on:** PR5f merged
**Governs under:** SPEC-BANKER-HOLY-SHIT-V1 Workstream B (OQ-2 closure)

## Problem

The GLOBAL_CASH_FLOW spread renders at chain step 2, before canonical fact writers populate the facts the spread depends on. The spread's DSCR/GCF_DSCR rows show null within the same job that just wrote correct values. PR5b's across-job trigger fixes this ~15 min later.

## Solution

Insert a second `renderSpread` call for GLOBAL_CASH_FLOW after `persistGlobalCashFlow` completes, before `triggerCanonicalRecompute`. Idempotent via upsert. Non-fatal. ~15 lines.

## Key design decisions

- Placement: AFTER persistGlobalCashFlow (so GCF facts are populated), BEFORE triggerCanonicalRecompute
- CAS bypass: deliberate — spread already in `ready` state owned by this job
- Guard: `completedTypes.has("GLOBAL_CASH_FLOW")` — skip if first render failed
- PR5b across-job trigger stays as defense-in-depth
