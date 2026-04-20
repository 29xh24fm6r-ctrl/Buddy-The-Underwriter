-- Phase 84 T-05 — Deprecate legacy checklist taxonomy
--
-- Adds deprecation comments to the legacy `deal_checklist_items` table and its
-- writer function `create_checklist_match()`. Does not remove or alter either
-- — the 180 "received" rows are still consumed by production readers, and the
-- RPC still writes checklist_item_matches rows consumed by the match-review UI.
--
-- Canonical checklist truth is `deal_document_items` + `deal_document_snapshots`
-- (Phase 66/67). Cockpit, readiness, and lifecycle all read from canonical.
--
-- See docs/archive/phase-84/T05-checklist-taxonomy-audit.md for full audit.

COMMENT ON TABLE public.deal_checklist_items IS
  'DEPRECATED (Phase 84 T-05). The canonical checklist tables are deal_document_items + deal_document_snapshots. This table''s "satisfied" taxonomy is structurally unreachable — create_checklist_match() promotes only missing → received, never to satisfied. 1076 missing + 180 received rows reflect bootstrap and match-propagation state; no "satisfied" rows exist. Do NOT filter WHERE status=''satisfied'' on this table — it will always return zero. Retirement tracked in Phase 84.1.';

COMMENT ON FUNCTION public.create_checklist_match(uuid, uuid, uuid, text, numeric, text, text, integer, boolean) IS
  'DEPRECATED (Phase 84 T-05). Auto-applied matches promote only to received status on legacy deal_checklist_items; never to satisfied. Canonical satisfaction happens on deal_document_items via the checklist engine v2 path. Retain for now — still writes checklist_item_matches rows consumed by match-review UI. Retire in Phase 84.1 once match review migrates to canonical.';
