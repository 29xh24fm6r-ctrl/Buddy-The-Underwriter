-- Conditions to Close Enhancement
-- Add intelligence fields for AI-orchestrated conditions tracking

ALTER TABLE public.conditions_to_close
ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'REQUIRED' CHECK (severity IN ('REQUIRED', 'IMPORTANT', 'FYI')),
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'SBA' CHECK (source IN ('SBA', 'BANK', 'AI', 'REGULATORY')),
ADD COLUMN IF NOT EXISTS ai_explanation TEXT,
ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS auto_resolved BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS resolution_evidence JSONB;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_conditions_severity ON conditions_to_close(severity);
CREATE INDEX IF NOT EXISTS idx_conditions_source ON conditions_to_close(source);
CREATE INDEX IF NOT EXISTS idx_conditions_evaluated ON conditions_to_close(last_evaluated_at DESC);

-- Add comment for documentation
COMMENT ON COLUMN conditions_to_close.severity IS 'REQUIRED: Must be satisfied before closing | IMPORTANT: Should be addressed | FYI: Informational only';
COMMENT ON COLUMN conditions_to_close.source IS 'SBA: From SBA requirements | BANK: Bank-specific | AI: AI-detected | REGULATORY: Other regulations';
COMMENT ON COLUMN conditions_to_close.ai_explanation IS 'AI-generated explanation of condition status and next steps';
COMMENT ON COLUMN conditions_to_close.auto_resolved IS 'Whether this condition was automatically resolved by the system';
COMMENT ON COLUMN conditions_to_close.resolution_evidence IS 'JSONB containing evidence that satisfied this condition';
