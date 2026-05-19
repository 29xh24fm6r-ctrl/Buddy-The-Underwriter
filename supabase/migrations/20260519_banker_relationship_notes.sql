-- SPEC-BANKER-NOTES-TRANSCRIPT-1 Part B
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS banker_relationship_notes text;

COMMENT ON COLUMN public.deals.banker_relationship_notes IS
'Free-form banker relationship notes. Available from deal creation, visible on cockpit at all stages. Pre-populates BorrowerStoryForm.banker_notes when deal reaches Memo Inputs.';
