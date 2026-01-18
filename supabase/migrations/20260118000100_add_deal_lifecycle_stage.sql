-- Add lifecycle_stage to deals
ALTER TABLE deals
ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'created';
