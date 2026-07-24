-- SPEC-BROKERAGE-SBA-READY-V1 principal-residence-certification follow-up.
--
-- SBA Procedural Notice 5000-876626 (eff. 2026-03-01): every direct/indirect
-- owner of an SBA applicant — not just non-citizens — must have their
-- principal residence (as defined by IRS Publication 523) in the US, its
-- territories, or possessions. This is distinct from citizenship_status,
-- which the code already captures; there was no field for this at all.
--
-- Additive only. Nullable (unset = not yet asked, fails closed downstream
-- in dealDataBuilder.ts's eligibility resolution, same convention as
-- citizenship_status).

ALTER TABLE public.ownership_entities
  ADD COLUMN IF NOT EXISTS principal_residence_in_us boolean;

COMMENT ON COLUMN public.ownership_entities.principal_residence_in_us IS
  'SBA Procedural Notice 5000-876626 (eff. 2026-03-01): true only if this owner''s principal residence (IRS Pub. 523 definition) is in the US/its territories/possessions. Distinct from citizenship_status — applies to citizens and nationals too, not just LPRs/non-citizens. Null = not yet asked (fails closed in eligibility resolution, same convention as citizenship_status).';
