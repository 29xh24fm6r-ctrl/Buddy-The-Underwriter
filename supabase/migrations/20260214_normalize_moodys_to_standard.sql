-- Normalize legacy "MOODYS" spread_type to "STANDARD" across all tables.
-- One-shot migration: no ongoing compat code needed after this runs.
-- Defense-in-depth: spreadTypeCompat.ts + render-diff .in() remain as fallback.

-- 1. deal_spreads: rename spread_type column value
UPDATE public.deal_spreads
SET spread_type = 'STANDARD', updated_at = NOW()
WHERE spread_type = 'MOODYS';

-- 2. deal_spread_jobs: replace in TEXT[] array column
UPDATE public.deal_spread_jobs
SET requested_spread_types = array_replace(requested_spread_types, 'MOODYS', 'STANDARD'),
    updated_at = NOW()
WHERE 'MOODYS' = ANY(requested_spread_types);

-- 3. deal_spread_line_items: rename spread_type if present
UPDATE public.deal_spread_line_items
SET spread_type = 'STANDARD'
WHERE spread_type = 'MOODYS';
