-- Phase 79: Research Trust Hardening — Memo → Evidence Drillthrough
--
-- Adds research_trace_json to canonical_memo_narratives so every memo
-- section can trace back to the evidence rows that support it.

ALTER TABLE public.canonical_memo_narratives
  ADD COLUMN IF NOT EXISTS research_trace_json JSONB DEFAULT NULL;

-- Also add research_trust_grade so the memo records the trust grade
-- at the time of generation (immutable audit trail).
ALTER TABLE public.canonical_memo_narratives
  ADD COLUMN IF NOT EXISTS research_trust_grade TEXT DEFAULT NULL;

COMMENT ON COLUMN public.canonical_memo_narratives.research_trace_json IS
  'Phase 79: Per-section evidence trace — { sections: [{ section_key, claim_ids, evidence_ids }] }';

COMMENT ON COLUMN public.canonical_memo_narratives.research_trust_grade IS
  'Phase 79: Trust grade at memo generation time — committee_grade | preliminary | manual_review_required | research_failed';
