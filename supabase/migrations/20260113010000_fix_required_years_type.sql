-- Fix incorrect column types for year-aware checklist
-- Some environments ended up with required_years as int (int4) instead of int[] (_int4)
-- This migration is idempotent and attempts safe conversions.

DO $$
DECLARE
  req_udt text;
  sat_udt text;
BEGIN
  SELECT c.udt_name
    INTO req_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'deal_checklist_items'
    AND c.column_name = 'required_years';

  SELECT c.udt_name
    INTO sat_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'deal_checklist_items'
    AND c.column_name = 'satisfied_years';

  -- required_years
  IF req_udt = 'int4' THEN
    -- Convert single int year -> int[]
    ALTER TABLE public.deal_checklist_items
      ALTER COLUMN required_years
      TYPE int[]
      USING CASE
        WHEN required_years IS NULL THEN NULL
        ELSE ARRAY[required_years]
      END;
  ELSIF req_udt = 'text' THEN
    -- Convert string like "[2024,2023,2022]" -> int[]
    ALTER TABLE public.deal_checklist_items
      ALTER COLUMN required_years
      TYPE int[]
      USING CASE
        WHEN required_years IS NULL OR btrim(required_years) = '' THEN NULL
        ELSE regexp_split_to_array(
          regexp_replace(required_years, '^\\s*\\[|\\]\\s*$', '', 'g'),
          '\\s*,\\s*'
        )::int[]
      END;
  END IF;

  -- satisfied_years (defensive)
  IF sat_udt = 'int4' THEN
    ALTER TABLE public.deal_checklist_items
      ALTER COLUMN satisfied_years
      TYPE int[]
      USING CASE
        WHEN satisfied_years IS NULL THEN NULL
        ELSE ARRAY[satisfied_years]
      END;
  ELSIF sat_udt = 'text' THEN
    ALTER TABLE public.deal_checklist_items
      ALTER COLUMN satisfied_years
      TYPE int[]
      USING CASE
        WHEN satisfied_years IS NULL OR btrim(satisfied_years) = '' THEN NULL
        ELSE regexp_split_to_array(
          regexp_replace(satisfied_years, '^\\s*\\[|\\]\\s*$', '', 'g'),
          '\\s*,\\s*'
        )::int[]
      END;
  END IF;
END $$;
