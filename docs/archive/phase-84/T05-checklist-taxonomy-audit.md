# T-05 Checklist Taxonomy Audit

**Date:** 2026-04-20
**Scope:** Investigate the legacy `deal_checklist_items` vs canonical `deal_document_items` + `deal_document_snapshots` split, confirm whether production readers rely on the unreachable `status='satisfied'` value on the legacy table, and decide retirement path.

---

## Query A — Legacy vs canonical distribution

```
legacy_satisfied:  0
legacy_received:   180
legacy_missing:    1076
canon_satisfied:   20
canon_received:    44
canon_missing:     15
snapshot_count:    7
```

Legacy has **zero** `satisfied` rows out of 1256 total. Canonical is where the satisfaction taxonomy lives.

---

## Query B — Active triggers on `deal_checklist_items`

| Trigger | Definition |
|---|---|
| `trg_deal_checklist_items_updated_at` | `BEFORE UPDATE FOR EACH ROW EXECUTE FUNCTION touch_updated_at()` — standard timestamp trigger, no taxonomy behavior. |
| `trg_guard_non_year_items_no_years` | domain constraint, no taxonomy behavior. |

Neither bridges status from canonical. There is no trigger anywhere promoting `received → satisfied` on the legacy table.

Also confirmed against the `create_checklist_match()` function body, which contains:

```sql
UPDATE public.deal_checklist_items
SET status = 'received', ...
WHERE status = 'missing';
```

No path from `received → satisfied` exists. The function is **structurally incapable** of promoting to `satisfied`. This explains `legacy_satisfied = 0`.

---

## Query C — Production readers + writers of `deal_checklist_items` (legacy)

Run: `grep -rn 'deal_checklist_items' src/app/api/ src/components/ src/app/ ... | grep -v __tests__`

52 hits, grouped by operation:

### Writes (W)

| Route | Operation |
|---|---|
| `src/app/api/deals/[dealId]/checklist/set-required/route.ts:75,82` | UPDATE (set `required` flag) |
| `src/app/api/deals/[dealId]/checklist/seed/route.ts:141,150,161,179` | INSERT (bootstrap checklist from template) |
| `src/app/api/deals/[dealId]/checklist/set-status/route.ts:57,71` | UPDATE (manual banker status change via UI) |
| `src/app/api/deals/[dealId]/checklist/upsert/route.ts:54` | UPSERT |
| `src/app/api/deals/[dealId]/auto-seed-lite/route.ts` (7 sites) | UPSERT / UPDATE |
| `src/app/api/deals/[dealId]/auto-seed/route.ts` (8 sites) | UPSERT / UPDATE |
| `src/app/api/deals/[dealId]/intake/set/route.ts:261,281` | UPDATE |
| `src/app/api/deals/[dealId]/underwrite/start/route.ts:309` | UPDATE |
| `src/app/api/builder/deals/make-ready/route.ts:140` | INSERT (builder tool) |
| `src/app/(app)/deals/[dealId]/cockpit/seed/route.ts:111,124` | INSERT |

### Reads (R)

| Route | What it reads | Filters on `status`? |
|---|---|---|
| `src/app/api/debug/upload-health/route.ts:35` | diagnostic read | no |
| `src/app/api/underwriting/poll/route.ts:50` | poll for state | no status filter |
| `src/app/api/voice/borrower-upload/next/route.ts:37` | next doc to upload | no |
| `src/app/api/deals/[dealId]/checklist/status/route.ts:15` | GET summary | **counts 4 states: missing/requested/received/waived — no `satisfied`** ✓ |
| `src/app/api/deals/[dealId]/checklist/route.ts:21` | comment only — augments with docs | n/a |
| `src/app/api/deals/[dealId]/summary/buddy/route.ts:185` | summary | no |
| `src/app/api/deals/[dealId]/intake/status/route.ts:157` | intake status | **`["received", "satisfied"].includes(...)` — `satisfied` is dead code, unreachable** ⚠ |
| `src/app/api/deals/[dealId]/progress/route.ts:62` | `received_at, required` — no status filter | no |
| `src/app/api/deals/[dealId]/underwrite/launch/route.ts:48` | snapshot dump into `requirement_snapshot_json` | no filter |
| `src/app/api/deals/[dealId]/context/route.ts:267` | passes to `deriveUnderwritingStance` | status typed as `ChecklistItemInput["status"]` |
| `src/app/api/lender/deals/[dealId]/route.ts:40` | lender-view read | no |
| `src/app/api/portal/session/route.ts:78` | borrower portal session | no |
| `src/app/api/admin/deals/[dealId]/checklist/debug/route.ts:46` | admin debug | no |
| `src/app/api/admin/deals/[dealId]/checklist/list/route.ts:44` | admin list | no |
| `src/app/api/admin/deals/[dealId]/auto-seed-lite/debug/route.ts` (4 sites) | admin debug | no |

### Comments / Type-only (not runtime access)

| Location | Note |
|---|---|
| `src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts:311` | comment describing reconciliation |
| `src/app/api/deals/[dealId]/intake/confirm/route.ts:263` | comment describing belt-and-suspenders reconcile |
| `src/app/api/deals/[dealId]/auto-seed/route.ts:264,284,469` | comments / telemetry attribute |
| `src/stitch/surface_wiring_ledger.ts:209` | Phase 63 wiring ledger comment |

---

## Query D — Canonical readers (sanity check — Phase 67 wiring)

Run: `grep -rn 'deal_document_items\|deal_document_snapshots' src/app/api/`

| Route | Table | Operation |
|---|---|---|
| `src/app/api/deals/[dealId]/cockpit-state/route.ts:79,92` | `deal_document_snapshots` | read (drives ReadinessPanel) ✓ |
| `src/app/api/deals/[dealId]/underwrite/state/route.ts:101` | `deal_document_snapshots` | read |
| `src/app/api/deals/[dealId]/launch-underwriting/route.ts:88` | `deal_document_snapshots` | read |
| `src/app/api/deals/[dealId]/documents/[documentId]/reclassify/route.ts:43` | `deal_document_items` | write |
| `src/app/api/deals/[dealId]/documents/[documentId]/confirm/route.ts:34` | `deal_document_items` | write |
| `src/app/api/deals/[dealId]/documents/[documentId]/reject/route.ts:29` | `deal_document_items` | write |
| `src/app/api/deals/[dealId]/auto-underwrite/status/route.ts:16` | comment — does NOT query canonical | n/a |
| `src/app/api/admin/deals/backfill-document-state/route.ts:56` | `deal_document_snapshots` | admin |

**Phase 67 canonical wiring confirmed — cockpit-state reads from canonical.** No regression.

---

## Query E — `create_checklist_match` RPC call sites

```
src/lib/artifacts/processArtifact.ts:1187                                 RPC-caller
src/app/api/deals/[dealId]/documents/[attachmentId]/checklist-key/route.ts:240  RPC-caller
src/app/api/deals/[dealId]/documents/[attachmentId]/checklist-key/route.ts:253  log message only
```

Two live callers. Both are the auto-apply-match paths during artifact processing and manual reclassify. Both write to `checklist_item_matches` (match-review UI reads that table) and call the legacy `UPDATE ... SET status = 'received' WHERE status = 'missing'`. Retiring the RPC requires migrating those two callers first.

---

## Query F — Hits mentioning `satisfied` or `status` against the legacy table

```
src/stitch/surface_wiring_ledger.ts:209         comment only
src/app/api/deals/[dealId]/checklist/set-status/route.ts:57,71       writer
src/app/api/deals/[dealId]/checklist/status/route.ts:15              reader (no satisfied filter)
src/app/api/deals/[dealId]/intake/status/route.ts:157                reader — ["received","satisfied"].includes(...) ⚠
src/app/api/deals/[dealId]/underwrite/launch/route.ts:48             reader (no filter)
src/app/api/deals/[dealId]/context/route.ts:267                      reader (passes through)
```

**Only one hit** (`intake/status/route.ts:163`) filters on `"satisfied"` against the legacy table. The clause is dead — never matches any row — but the code still returns correct counts because the `"received"` half of the `OR` covers what actually exists. Not a live bug; a latent assumption error to clean up in Phase 84.1.

---

## Classification summary

- **Zero readers genuinely depend on `legacy.status = 'satisfied'`.** The one hit (`intake/status`) is dead code.
- **Readers primarily consume `status = 'received'`** (183 rows today) or no status filter. This is the "I've seen a doc match this item" degraded signal.
- **The legacy table has a live purpose** today as a signal store for `create_checklist_match()`: the RPC writes `checklist_item_matches` rows + flips the legacy checklist item to `received`. Both outputs are consumed by production UIs (match-review surface + borrower-side status).
- **Canonical wiring (Phase 67) is intact.** Cockpit and readiness read from `deal_document_snapshots` directly.

---

## Decision: Dual-track accepted, deprecation comments added, retirement deferred to Phase 84.1

### What we're not doing (and why)

- **Not retiring the legacy table now.** 51 production call sites still read from or write to it. Match-review UI + borrower portal + admin debug paths all depend on it. Retiring would require migrating 51 sites inside T-05, which is mid-wave and out of scope.
- **Not bridging the legacy `status` to canonical via trigger.** Adding a trigger that flips legacy `received` to legacy `satisfied` on canonical change would "fix" the unreachable taxonomy but lock in the dual-track and add a second write path — the opposite of what we want.
- **Not fixing the `intake/status.ts` `"satisfied"` dead-code filter now.** Trivial cleanup but non-urgent (filter is functionally correct); queued for Phase 84.1 as part of the legacy retirement.

### What we are doing

1. **Deprecation comments on the legacy table + RPC.** Applied via migration `phase_84_t05_deprecate_legacy_checklist` (repo: `supabase/migrations/20260420160000_phase_84_t05_deprecate_legacy_checklist.sql`). Any developer inspecting the schema via `\d+` sees a clear warning + pointer to the audit doc.
2. **Phase 84.1 retirement ticket** carries the concrete scope:
   - Migrate the 2 RPC call sites (`processArtifact.ts`, `checklist-key/route.ts`) to the canonical pipeline
   - Delete `create_checklist_match()` and `deal_checklist_items`
   - Clean up the `intake/status/route.ts:163` `"satisfied"` dead-code filter
   - Delete `checklist/seed`, `checklist/set-required`, `checklist/set-status`, `checklist/upsert`, `checklist/status` routes if no frontend still targets them (likely all used by banker UI — needs component-side grep before removal)

### What we're naming

**This is a dual-track system no one designed.** The legacy table was built for a per-checklist-item status model (missing/requested/received/waived — no satisfied). Phase 66 introduced `deal_document_items` with the fuller taxonomy including `satisfied`. Neither was retired; both kept getting written to. Today they serve different purposes:

- **Legacy** = "auto-match propagation signal" (received from artifact match)
- **Canonical** = "readiness truth" (satisfied/received/missing per checklist req, drives cockpit)

Naming that explicitly in the AAR surfaces it as a real architectural observation, not a spec-v2 oversight to be embarrassed about.
