-- Bind each artifact review verdict to the content it actually reviewed.
--
-- acquire_trident_bundle_run inserts a fresh bundle row on every attempt, and
-- every resume path in the factory reads from that new, empty row. No
-- verification result was keyed by anything, so a business plan that passed
-- review on attempt N was regenerated and re-reviewed on attempt N+1 at a
-- fresh chance of failing. With three gates at a measured ~39% each, retries
-- re-rolled all three instead of accumulating: 916 runs, 0 published.
--
-- verification_input_hash records the hash of the exact (facts, sections)
-- pair the reviewer saw. When a later run assembles byte-identical content,
-- the stored verdict is reused instead of paying for a fresh non-deterministic
-- judgement on the same evidence.
--
-- Nullable and unbackfilled by design: existing rows have no recorded hash, so
-- they never match and always re-review. Fail-closed — an absent hash must
-- never read as "already approved".

alter table public.buddy_sba_packages
  add column if not exists verification_input_hash text;

alter table public.buddy_feasibility_studies
  add column if not exists verification_input_hash text;

comment on column public.buddy_sba_packages.verification_input_hash is
  'Hash of the (facts, sections) reviewed to produce verification_verdict. A later run with identical content reuses the verdict instead of re-reviewing. Null means never reviewed under this scheme; treat as not approved.';

comment on column public.buddy_feasibility_studies.verification_input_hash is
  'Hash of the (facts, sections) reviewed to produce verification_verdict. A later run with identical content reuses the verdict instead of re-reviewing. Null means never reviewed under this scheme; treat as not approved.';

-- Reused only on an exact content match for one artifact row, so the lookup is
-- always by primary key plus this column; a partial index keeps the non-null
-- rows cheap to filter without indexing the historical nulls.
create index if not exists idx_sba_packages_verification_hash
  on public.buddy_sba_packages (id, verification_input_hash)
  where verification_input_hash is not null;

create index if not exists idx_feasibility_verification_hash
  on public.buddy_feasibility_studies (id, verification_input_hash)
  where verification_input_hash is not null;
