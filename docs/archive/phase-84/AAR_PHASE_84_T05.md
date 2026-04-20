# AAR — Phase 84 T-05 — Checklist taxonomy audit

**Date:** 2026-04-20
**Ticket:** T-05 (Wave 2 — audit-only, not a build ticket)
**Completion event:** `buddy_system_events` id `6fdc13d7-aae8-43c9-a8a0-13ce7bb7f94f`
**Audit doc:** `docs/archive/phase-84/T05-checklist-taxonomy-audit.md`
**Migration:** `phase_84_t05_deprecate_legacy_checklist` (registered in Supabase; repo file `supabase/migrations/20260420160000_phase_84_t05_deprecate_legacy_checklist.sql`)

---

## 1. Decision

**Accept the dual-track system. Deprecate the legacy surface. Retire in Phase 84.1.**

Legacy `deal_checklist_items` remains in production as a "match propagation signal" — `create_checklist_match()` flips `missing → received` and writes `checklist_item_matches` rows consumed by match-review UIs. The canonical `deal_document_items` + `deal_document_snapshots` (Phase 66/67) carry the full `missing/received/satisfied` taxonomy and drive cockpit/readiness/lifecycle.

Retiring the legacy table requires migrating 51 production call sites (2 RPC callers, 10 writers across checklist/auto-seed/intake/underwrite/builder/cockpit-seed paths, 15 readers including lender/portal/admin/debug, plus comments). Too broad for mid-Wave T-05 scope. Clean candidate for 84.1.

---

## 2. Key evidence

### Data distribution (Query A)

```
legacy_satisfied:  0     ← zero. Structurally unreachable.
legacy_received:   180
legacy_missing:    1076
canon_satisfied:   20
canon_received:    44
canon_missing:     15
snapshot_count:    7
```

The v1 audit looked at `deal_checklist_items.status='satisfied'` to conclude "checklist stuck." The actual story: the legacy table never had a satisfied promotion path in code. Reading the `create_checklist_match()` body directly:

```sql
UPDATE public.deal_checklist_items
SET status = 'received', ...
WHERE status = 'missing';   -- monotonic, only promotes missing → received
```

No `received → satisfied` transition exists anywhere. That's why `legacy_satisfied = 0` and always has been.

### Reader dependence on `satisfied` on legacy (Query F)

One hit: `src/app/api/deals/[dealId]/intake/status/route.ts:163`:
```typescript
const receivedRequired = requiredRows.filter((r: any) =>
  ["received", "satisfied"].includes(String(r.status ?? "")),
).length;
```

The `"satisfied"` half is dead — the filter still returns correct counts because `"received"` covers what actually exists. **Not a live bug.** Latent assumption error that someone once expected legacy to track satisfied. Queued for cleanup in 84.1 alongside legacy retirement.

### Canonical wiring intact (Query D)

Three cockpit-facing reads confirmed on `deal_document_snapshots`:
- `src/app/api/deals/[dealId]/cockpit-state/route.ts:79,92`
- `src/app/api/deals/[dealId]/underwrite/state/route.ts:101`
- `src/app/api/deals/[dealId]/launch-underwriting/route.ts:88`

Phase 67 wiring intact — no regression. The user-visible ReadinessPanel is reading canonical truth.

---

## 3. What we named

**Buddy has a dual-track checklist system no one intentionally designed.** The legacy table was built for a 4-state per-item model (missing/requested/received/waived). Phase 66 introduced `deal_document_items` with a 3-state readiness model (missing/received/satisfied). Neither was retired; both kept getting written to by overlapping code paths. Today they serve different purposes:

| Surface | Table | Purpose |
|---|---|---|
| Legacy | `deal_checklist_items` | Auto-match propagation signal (artifact match → `received`) |
| Canonical | `deal_document_items` + `deal_document_snapshots` | Readiness truth (drives cockpit, lifecycle blockers, underwriting start) |

Both legitimately exist; neither is "broken." What's broken is the absence of documentation that made v1 audit mistake the legacy table for the canonical one.

---

## 4. Spec deviations

**None of material substance.** The v2 spec already scoped T-05 as audit-only and correctly predicted the "dual-track accepted" outcome as one of three candidate landings. Minor clarifications from execution:

1. **Reader count higher than v2 implied.** Spec implied a small number of readers; actual count is 15 readers + 10 writers across 51 total hits. Broader blast radius for eventual retirement; doesn't change T-05 decision.
2. **The `create_checklist_match()` signature was needed for `COMMENT ON FUNCTION`.** v2 spec's example used a simplified signature; actual signature is 9 arguments. Spec example updated inline at apply time.
3. **`intake/status/route.ts:163` surfaces as dead-code cleanup.** Not in v2 scope; surfaces naturally from Query F. Added to Phase 84.1 backlog, not fixed here (non-urgent; filter is functionally correct).

---

## 5. Acceptance

- [x] Audit file `docs/archive/phase-84/T05-checklist-taxonomy-audit.md` committed with all 6 query outputs.
- [x] Query A numbers + Query B triggers list present verbatim.
- [x] Query C legacy readers classified R/W/RPC/Type.
- [x] Query D canonical readers confirmed (cockpit-state, underwrite/state, launch-underwriting).
- [x] Decision recorded: deprecate + retire in 84.1, with concrete migration plan.
- [x] Deprecation comments attached to table + function via applied migration.
- [x] No production reader genuinely depends on `legacy.status = 'satisfied'`. The one hit is dead code.
- [x] Completion event written to `buddy_system_events`.

**Non-goals confirmed NOT done:**
- No `satisfied` promotion added to legacy table ✓
- No trigger bridging legacy ↔ canonical ✓
- No production reader rewritten in this ticket ✓

---

## 6. Phase 84.1 follow-ups

1. **Retire `deal_checklist_items` + `create_checklist_match()`.** Migrate the 2 RPC call sites (`processArtifact.ts:1187`, `checklist-key/route.ts:240`) to the canonical pipeline. Drop the table + function.
2. **Clean up `intake/status/route.ts:163` `"satisfied"` dead-code filter** alongside the retirement (or sooner — it's a 1-line change).
3. **Audit banker-facing components for legacy reads** before deletion. `src/components/` was included in the grep scope but returned no direct `.from("deal_checklist_items")` hits. Still, the banker-facing `/api/deals/[dealId]/checklist/status` and `/api/deals/[dealId]/checklist/set-status` routes have frontends; confirm those migrate to canonical before removing the routes.
4. **Match-review UI migration.** `checklist_item_matches` is currently populated by `create_checklist_match()`. Any retirement of that function needs the match-review UI to read from a canonical equivalent first.

---

## Next

T-04 (`runRecord` wire-through) — pre-work already run in parallel with this ticket. Extractor distribution confirms `gemini_primary_v1` is the top-volume path (404 facts / 18 docs in 14 days). `agent_workflow_runs` view still unions `deal_extraction_runs`. `deal_extraction_runs` row count = 0. `runRecord.ts` exports exist but are NOT re-exported from `index.ts` and NOT imported by any call site. Premise intact — proceed with implementation as specified.
