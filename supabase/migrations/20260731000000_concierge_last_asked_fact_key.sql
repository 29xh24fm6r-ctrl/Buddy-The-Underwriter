-- SPEC-M5 CONVERSATIONAL-INTAKE-1
--
-- Tracks which BORROWER_FIELD_REGISTRY factPath the concierge's prompt told
-- the model to ask about on the most recent turn (computeNextCriticalField's
-- return value), distinct from the existing free-text last_question column.
-- Lets the route detect "is this turn asking about the same registry field
-- as last turn" precisely (by factPath) rather than by comparing the
-- model's free-text question wording, which can vary even when re-asking
-- about the same field — the precise signal recordFactRequest's
-- repeat-ask dedup needs.
alter table public.borrower_concierge_sessions
  add column if not exists last_asked_fact_key text;
