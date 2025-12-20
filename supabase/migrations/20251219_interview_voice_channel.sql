-- Migration: Add channel column to deal_interview_turns (if not exists)
-- This supports Step 4 voice interview system which needs to distinguish voice vs text turns

DO $$
BEGIN
  -- Check if channel column exists, add it if not
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'deal_interview_turns' 
      AND column_name = 'channel'
  ) THEN
    ALTER TABLE public.deal_interview_turns 
    ADD COLUMN channel TEXT DEFAULT 'text' CHECK (channel IN ('text', 'voice', 'upload'));
    
    COMMENT ON COLUMN public.deal_interview_turns.channel IS 'How this turn was captured: text (manual), voice (realtime), upload (audio file)';
  END IF;
END $$;
