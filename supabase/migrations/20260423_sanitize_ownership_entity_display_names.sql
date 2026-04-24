-- STUCK-SPREADS Batch 2 (2026-04-23)
-- One-shot backfill: strip PDF label-bleed garbage from
-- ownership_entities.display_name (e.g. "MICHAEL NEWMARK\nTaxpayer address"
-- → "MICHAEL NEWMARK"). Idempotent — running it twice is a no-op.
-- Matches the sanitizer in src/lib/ownership/sanitizeEntityName.ts.

UPDATE ownership_entities
SET display_name = TRIM(
  REGEXP_REPLACE(
    SPLIT_PART(display_name, E'\n', 1),
    '\s+(taxpayer|spouse|filer|name|address|ssn|date)\b.*$',
    '',
    'i'
  )
)
WHERE display_name LIKE E'%\n%'
   OR display_name ~* 'taxpayer|spouse|filer'
   OR display_name LIKE '% address%';
