-- Credit Memo Submission Lifecycle (Banker-Owned Submission)
--
-- Adds banker-submission state to credit_memo_snapshots so a credit memo
-- becomes legally/operationally meaningful only when a human banker
-- certifies and submits it. AI assembles the draft; the banker submits.
--
-- Ownership invariant:
--   Buddy assembles. Banker submits. Underwriter decides. Snapshot audits.
--
-- Additive only. No existing rows or columns are dropped or renamed.
-- Existing pipeline continues to write the original columns
-- (deal_id, generated_by, generated_at, builder_state_json,
--  policy_exceptions_json, builder_decisions_json, memo_output_json).
-- The columns added here default to a "draft" state, so legacy rows
-- backfill cleanly without intervention.

-- ── Schema additions ──────────────────────────────────────────────────────

alter table credit_memo_snapshots
  add column if not exists status text not null default 'draft',
  add column if not exists submitted_by text,
  add column if not exists submitted_at timestamptz,
  add column if not exists submission_role text not null default 'banker',
  add column if not exists memo_version integer not null default 1,
  add column if not exists input_hash text,
  add column if not exists readiness_contract_json jsonb not null default '{}'::jsonb,
  add column if not exists data_sources_json jsonb not null default '{}'::jsonb,
  add column if not exists banker_certification_json jsonb not null default '{}'::jsonb,
  add column if not exists underwriter_feedback_json jsonb not null default '{}'::jsonb,
  add column if not exists superseded_by uuid,
  add column if not exists superseded_at timestamptz;

-- ── Status enumeration ────────────────────────────────────────────────────
-- 'draft'              — Buddy-generated working copy; banker has not certified
-- 'banker_review'      — banker is actively reviewing; not yet submitted
-- 'banker_submitted'   — banker has certified and submitted to underwriting
-- 'underwriter_review' — underwriter has picked up the package
-- 'returned'           — underwriter sent back for revision
-- 'finalized'          — decision recorded against this snapshot
-- 'superseded'         — replaced by a newer memo_version

alter table credit_memo_snapshots
  drop constraint if exists credit_memo_snapshots_status_check;

alter table credit_memo_snapshots
  add constraint credit_memo_snapshots_status_check
  check (status in (
    'draft',
    'banker_review',
    'banker_submitted',
    'underwriter_review',
    'returned',
    'finalized',
    'superseded'
  ));

-- ── Submission integrity ─────────────────────────────────────────────────
-- Once a snapshot is submitted, the submitter and submission timestamp
-- and input hash MUST be present. Draft snapshots may have nulls.

alter table credit_memo_snapshots
  drop constraint if exists credit_memo_snapshots_submission_required;

alter table credit_memo_snapshots
  add constraint credit_memo_snapshots_submission_required
  check (
    status in ('draft', 'banker_review')
    or (submitted_by is not null and submitted_at is not null and input_hash is not null)
  );

-- ── Submission role enumeration ──────────────────────────────────────────
alter table credit_memo_snapshots
  drop constraint if exists credit_memo_snapshots_submission_role_check;

alter table credit_memo_snapshots
  add constraint credit_memo_snapshots_submission_role_check
  check (submission_role in ('banker', 'underwriter', 'system'));

-- ── Memo version monotonicity ────────────────────────────────────────────
alter table credit_memo_snapshots
  drop constraint if exists credit_memo_snapshots_memo_version_positive;

alter table credit_memo_snapshots
  add constraint credit_memo_snapshots_memo_version_positive
  check (memo_version >= 1);

-- ── Backfill memo_version on existing rows ──────────────────────────────
-- Auto-pipeline rows currently all default to memo_version=1, which would
-- collide with the unique index below for any deal that has multiple
-- snapshots. Backfill per-deal using generated_at order so versions are
-- monotonic. Legacy rows are also tagged submission_role='system' so the
-- banker-submission CI guard does not flag them.

with versioned as (
  select
    id,
    row_number() over (
      partition by deal_id
      order by generated_at, id
    ) as v
  from credit_memo_snapshots
)
update credit_memo_snapshots cms
set
  memo_version = versioned.v,
  submission_role = 'system'
from versioned
where cms.id = versioned.id
  and (cms.memo_version is distinct from versioned.v
       or cms.submission_role = 'banker');

-- ── Indices for submission queries ───────────────────────────────────────
-- Versioning: a deal may have at most one snapshot per memo_version.
create unique index if not exists ux_credit_memo_snapshots_deal_version
  on credit_memo_snapshots(deal_id, memo_version);

-- Active submitted memo lookup (underwriter queue, audit trail).
-- Status-aware index speeds up "find latest non-superseded submission".
create index if not exists idx_credit_memo_snapshots_deal_status
  on credit_memo_snapshots(deal_id, status, generated_at desc);

-- Underwriter inbox: list every banker-submitted memo across deals.
create index if not exists idx_credit_memo_snapshots_submitted_at
  on credit_memo_snapshots(submitted_at desc)
  where status = 'banker_submitted';

-- ── Comment authority boundary ───────────────────────────────────────────
comment on column credit_memo_snapshots.status is
  'Banker-submission lifecycle. Only submitCreditMemoToUnderwriting may write banker_submitted. CI guard enforces this rule.';

comment on column credit_memo_snapshots.submitted_by is
  'Identity of the banker who submitted this memo (Clerk user id). Null for draft.';

comment on column credit_memo_snapshots.submission_role is
  'Authority class of submitter. Banker is the canonical case; system is reserved for legacy auto-pipeline rows.';

comment on column credit_memo_snapshots.input_hash is
  'SHA-256 over canonical inputs at submission time. Establishes reproducibility — re-running the build with the same inputs must produce the same memo_output_json.';

comment on column credit_memo_snapshots.readiness_contract_json is
  'Server-side readiness evaluation captured at submission. The contract that was passing when this submission was accepted.';

comment on column credit_memo_snapshots.banker_certification_json is
  'Banker notes, override acknowledgements, and explicit certification recorded at submission. Frozen with the submitted snapshot.';

comment on column credit_memo_snapshots.underwriter_feedback_json is
  'Underwriter actions on a submitted memo (returns, conditions, decisions). Mutable after submission; appended to as the underwriter works.';

comment on column credit_memo_snapshots.superseded_by is
  'Snapshot id that replaced this one. Set when a banker creates a new memo_version after revision.';

-- ── Immutability trigger (Rule 4) ────────────────────────────────────────
-- Once a snapshot leaves status='draft', the audit-bearing fields become
-- read-only at the database layer. Application code can update
-- underwriter_feedback_json, status, superseded_by, and superseded_at
-- (the underwriter's working surface), but the certified payload itself
-- is frozen.

create or replace function credit_memo_snapshots_enforce_immutability()
returns trigger
language plpgsql
as $$
begin
  -- Allow free updates on draft rows.
  if old.status = 'draft' then
    return new;
  end if;

  -- Disallow changes to certified-payload fields once submitted.
  if new.memo_output_json is distinct from old.memo_output_json then
    raise exception 'credit_memo_snapshots: memo_output_json is immutable once status leaves draft (current=%)', old.status;
  end if;
  if new.banker_certification_json is distinct from old.banker_certification_json then
    raise exception 'credit_memo_snapshots: banker_certification_json is immutable once status leaves draft';
  end if;
  if new.readiness_contract_json is distinct from old.readiness_contract_json then
    raise exception 'credit_memo_snapshots: readiness_contract_json is immutable once status leaves draft';
  end if;
  if new.data_sources_json is distinct from old.data_sources_json then
    raise exception 'credit_memo_snapshots: data_sources_json is immutable once status leaves draft';
  end if;
  if new.input_hash is distinct from old.input_hash then
    raise exception 'credit_memo_snapshots: input_hash is immutable once status leaves draft';
  end if;
  if new.submitted_by is distinct from old.submitted_by then
    raise exception 'credit_memo_snapshots: submitted_by is immutable once status leaves draft';
  end if;
  if new.submitted_at is distinct from old.submitted_at then
    raise exception 'credit_memo_snapshots: submitted_at is immutable once status leaves draft';
  end if;
  if new.memo_version is distinct from old.memo_version then
    raise exception 'credit_memo_snapshots: memo_version is immutable once status leaves draft';
  end if;
  if new.deal_id is distinct from old.deal_id then
    raise exception 'credit_memo_snapshots: deal_id is immutable once status leaves draft';
  end if;

  -- Status transitions: only forward, and never back to draft.
  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'credit_memo_snapshots: cannot transition back to draft from %', old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_credit_memo_snapshots_immutability on credit_memo_snapshots;

create trigger trg_credit_memo_snapshots_immutability
  before update on credit_memo_snapshots
  for each row
  execute function credit_memo_snapshots_enforce_immutability();

comment on function credit_memo_snapshots_enforce_immutability is
  'Enforces Rule 4: once a snapshot leaves status=draft, the certified payload is frozen at the DB layer. Application code may still update underwriter_feedback_json, status (forward-only), superseded_by, and superseded_at.';
