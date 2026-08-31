-- SPEC-CRM-RELATIONSHIP-INTELLIGENCE-V1 — foundation.
--
-- The brokerage CRM already models a bank's credit box, the deal→bank
-- distribution ledger, tasks with assignees, and a 21-stage pipeline. Three
-- things stop that machinery from answering the questions the brokerage
-- actually asks:
--
--   1. Geography and industry appetite are stored as free prose
--      (crm_lender_profiles.geographies is a comma-split text[] holding
--      values like 'Nationwide' and 'GA'). Nothing reads them, and nothing
--      could: "which banks buy in TX" is not answerable against prose. This
--      migration adds the structured form alongside the prose columns —
--      additive per BUDDY_BUILD_RULES, the legacy columns stay for display
--      and are backfilled FROM, never dropped.
--
--   2. A relationship record is 16 identity columns with a single free-text
--      notes field. There is nowhere to record who owns the relationship,
--      how warm it is, or anything the brokerage knows that does not fit a
--      fixed column.
--
--   3. A manually loaded deal can take two different shapes depending on
--      which of two UI doors created it (a real deal with a borrower, or a
--      crm_tracking_only shadow row). deals.intake_mode names that fact once
--      so the pipeline can group by it instead of inferring it from a
--      boolean plus a free-text source string.
--
-- Also collapses the staleness-alert backlog: the referral_relationship_stale
-- automation dedupes per calendar day, so two stale contacts wrote 54 of the
-- 61 rows in crm_activities. src/lib/automation/triggers.ts changes the
-- dedupe key to the staleness episode in the same change; this cleans up the
-- rows that key already produced.

-- ── 1. Structured lender credit box ─────────────────────────────────────

alter table public.crm_lender_profiles
  add column if not exists geography_mode text not null default 'states',
  add column if not exists state_codes text[] not null default '{}',
  add column if not exists excluded_state_codes text[] not null default '{}',
  add column if not exists naics_codes text[] not null default '{}',
  add column if not exists excluded_naics_codes text[] not null default '{}';

alter table public.crm_lender_profiles
  drop constraint if exists crm_lender_profiles_geography_mode_check;
alter table public.crm_lender_profiles
  add constraint crm_lender_profiles_geography_mode_check
    check (geography_mode in ('nationwide', 'states'));

comment on column public.crm_lender_profiles.geography_mode is
  'nationwide = buys anywhere except excluded_state_codes; states = buys only in state_codes.';
comment on column public.crm_lender_profiles.state_codes is
  'Two-letter USPS codes this bank will lend in. Only meaningful when geography_mode = ''states''.';
comment on column public.crm_lender_profiles.excluded_state_codes is
  'Two-letter USPS codes this bank will never lend in. Applies in both geography modes.';
comment on column public.crm_lender_profiles.naics_codes is
  'NAICS prefixes (2-6 digits) this bank prefers. Empty means no stated industry preference.';
comment on column public.crm_lender_profiles.excluded_naics_codes is
  'NAICS prefixes this bank will not lend to. A prefix match here is a hard disqualifier.';

create index if not exists idx_crm_lender_profiles_state_codes
  on public.crm_lender_profiles using gin (state_codes);
create index if not exists idx_crm_lender_profiles_naics_codes
  on public.crm_lender_profiles using gin (naics_codes);

-- ── 2. Relationship record depth ────────────────────────────────────────

alter table public.crm_organizations
  add column if not exists state_code text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists relationship_tier text,
  add column if not exists owner_clerk_user_id text,
  add column if not exists how_we_met text,
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.crm_organizations
  drop constraint if exists crm_organizations_state_code_check;
alter table public.crm_organizations
  add constraint crm_organizations_state_code_check
    check (state_code is null or state_code ~ '^[A-Z]{2}$');

alter table public.crm_organizations
  drop constraint if exists crm_organizations_relationship_tier_check;
alter table public.crm_organizations
  add constraint crm_organizations_relationship_tier_check
    check (relationship_tier is null or relationship_tier in ('strategic', 'core', 'developing', 'dormant'));

comment on column public.crm_organizations.state_code is
  'Normalized two-letter USPS code. crm_organizations.state stays as the free-text display value.';
comment on column public.crm_organizations.tags is
  'Free-form labels the brokerage defines and filters on.';
comment on column public.crm_organizations.relationship_tier is
  'How much of the brokerage''s attention this relationship earns.';
comment on column public.crm_organizations.owner_clerk_user_id is
  'The teammate who owns this relationship. Distinct from a deal owner.';
comment on column public.crm_organizations.custom_fields is
  'Brokerage-defined key/value pairs that do not warrant a column.';

create index if not exists idx_crm_organizations_tags
  on public.crm_organizations using gin (tags);
create index if not exists idx_crm_organizations_owner
  on public.crm_organizations (bank_id, owner_clerk_user_id)
  where owner_clerk_user_id is not null;
create index if not exists idx_crm_organizations_state_code
  on public.crm_organizations (bank_id, state_code)
  where state_code is not null;

-- ── 3. One name for how a deal arrived ──────────────────────────────────

alter table public.deals
  add column if not exists intake_mode text;

alter table public.deals drop constraint if exists deals_intake_mode_check;
alter table public.deals add constraint deals_intake_mode_check
  check (intake_mode is null or intake_mode in
    ('self_sourced', 'referred', 'inbound_portal', 'tracking_only'));

comment on column public.deals.intake_mode is
  'How this deal reached the brokerage. tracking_only mirrors crm_tracking_only = true (an off-platform record kept for distribution tracking only); the other three are working deals.';

create index if not exists idx_deals_intake_mode
  on public.deals (bank_id, intake_mode)
  where intake_mode is not null;

-- ── 4. Backfills ────────────────────────────────────────────────────────

-- 4a. Organization state → state_code. Handles both the two-letter form
--     already in use and the full state names production also contains
--     ('New York'). Anything unrecognised stays null rather than guessing.
update public.crm_organizations o
set state_code = m.code
from (values
  ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),
  ('california','CA'),('colorado','CO'),('connecticut','CT'),('delaware','DE'),
  ('district of columbia','DC'),('florida','FL'),('georgia','GA'),('hawaii','HI'),
  ('idaho','ID'),('illinois','IL'),('indiana','IN'),('iowa','IA'),('kansas','KS'),
  ('kentucky','KY'),('louisiana','LA'),('maine','ME'),('maryland','MD'),
  ('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),('mississippi','MS'),
  ('missouri','MO'),('montana','MT'),('nebraska','NE'),('nevada','NV'),
  ('new hampshire','NH'),('new jersey','NJ'),('new mexico','NM'),('new york','NY'),
  ('north carolina','NC'),('north dakota','ND'),('ohio','OH'),('oklahoma','OK'),
  ('oregon','OR'),('pennsylvania','PA'),('puerto rico','PR'),('rhode island','RI'),
  ('south carolina','SC'),('south dakota','SD'),('tennessee','TN'),('texas','TX'),
  ('utah','UT'),('vermont','VT'),('virginia','VA'),('washington','WA'),
  ('west virginia','WV'),('wisconsin','WI'),('wyoming','WY')
) as m(full_name, code)
where o.state_code is null
  and o.state is not null
  and lower(btrim(o.state)) = m.full_name;

update public.crm_organizations
set state_code = upper(btrim(state))
where state_code is null
  and state is not null
  and btrim(state) ~ '^[A-Za-z]{2}$';

-- 4b. Legacy prose geographies → structured. 'Nationwide' / 'National' / 'US'
--     become geography_mode = 'nationwide'; anything that parses as a
--     two-letter code becomes a state_codes entry. Unparseable prose is left
--     alone in the legacy column for a human to reconcile in the UI.
update public.crm_lender_profiles
set geography_mode = 'nationwide'
where geography_mode = 'states'
  and exists (
    select 1 from unnest(geographies) as g
    where lower(btrim(g)) in ('nationwide', 'national', 'us', 'usa', 'all', 'all states')
  );

update public.crm_lender_profiles p
set state_codes = sub.codes
from (
  select id, array_agg(distinct upper(btrim(g))) as codes
  from public.crm_lender_profiles, unnest(geographies) as g
  where btrim(g) ~ '^[A-Za-z]{2}$'
  group by id
) as sub
where p.id = sub.id
  and cardinality(p.state_codes) = 0;

-- 4c. Existing deals → intake_mode.
update public.deals
set intake_mode = 'tracking_only'
where intake_mode is null and crm_tracking_only = true;

update public.deals
set intake_mode = 'self_sourced'
where intake_mode is null
  and external_deal_source = 'brokerage_self_sourced_package';

update public.deals
set intake_mode = 'inbound_portal'
where intake_mode is null
  and origin in ('brokerage_anonymous', 'brokerage_claimed');

-- ── 5. Collapse the staleness-alert backlog ─────────────────────────────
-- Keeps the most recent alert per target and deletes the repeats. The
-- trigger's dedupe key changes in the same change so this cannot regrow.

delete from public.crm_activities a
using public.crm_activities keep
where a.kind = 'system'
  and a.title = 'Referral relationship has gone stale — reach out'
  and keep.kind = a.kind
  and keep.title = a.title
  and keep.bank_id = a.bank_id
  and keep.target_person_id is not distinct from a.target_person_id
  and keep.target_organization_id is not distinct from a.target_organization_id
  and (keep.happens_at > a.happens_at
       or (keep.happens_at = a.happens_at and keep.id > a.id));
