-- SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1
-- Persist the structured research-gate artifacts (Phases 3–6) so the research
-- flight deck can render section source statuses, the 8-check contradiction
-- checklist, evidence-lane scores, and the preliminary-vs-committee readiness
-- distinction. All columns are nullable / default-empty so existing rows and
-- pre-deploy gate writes remain valid.

ALTER TABLE public.buddy_research_quality_gates
  -- Phase 3: per-section preliminary-vs-committee source status
  ADD COLUMN IF NOT EXISTS section_source_statuses jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Phase 4: full 8-check adversarial contradiction checklist
  ADD COLUMN IF NOT EXISTS contradiction_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Phase 5: evidence-lane scores + coverage + present/missing items
  ADD COLUMN IF NOT EXISTS evidence_quality jsonb,
  -- Phase 6: readiness semantics
  ADD COLUMN IF NOT EXISTS preliminary_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS committee_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preliminary_basis text,
  ADD COLUMN IF NOT EXISTS committee_blockers jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.buddy_research_quality_gates.section_source_statuses IS
  'Phase 3: SectionSourceStatus[] — per-section committee/preliminary source status + evidence_basis.';
COMMENT ON COLUMN public.buddy_research_quality_gates.contradiction_checklist IS
  'Phase 4: ContradictionCheck[] — all 8 adversarial checks (clear/flagged/insufficient_evidence).';
COMMENT ON COLUMN public.buddy_research_quality_gates.evidence_quality IS
  'Phase 5: EvidenceQualityResult — public_web / loan_file / banker_certified lane scores + coverage.';
COMMENT ON COLUMN public.buddy_research_quality_gates.preliminary_basis IS
  'Phase 6: public_web | banker_certified_private_company | loan_file_evidence | null.';
COMMENT ON COLUMN public.buddy_research_quality_gates.committee_blockers IS
  'Phase 6: string[] — explicit blockers preventing committee-grade readiness.';
