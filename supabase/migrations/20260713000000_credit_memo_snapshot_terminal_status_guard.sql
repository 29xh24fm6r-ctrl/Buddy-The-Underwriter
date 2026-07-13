-- Credit Memo Snapshot Terminal Status Guard
--
-- Audit finding: credit_memo_snapshots_enforce_immutability() only blocks
-- reverting to status='draft'. Nothing at the DB layer stops other backward
-- transitions — e.g. finalized -> banker_submitted, or superseded -> any
-- other status. 'finalized' (a decision has been recorded) and 'superseded'
-- (replaced by a newer memo_version) are meant to be permanent audit-trail
-- endpoints; today they're only enforced as terminal by one application call
-- site (recordUnderwriterDecision.ts), not by the database. A direct SQL
-- update or a future code path could silently reopen a decided or superseded
-- memo. This migration closes that gap at the DB layer.
--
-- Additive only — extends the existing trigger function, no schema changes.

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

  -- Terminal states never transition out, to any other status (including
  -- to themselves is fine — Postgres row triggers still fire on no-op
  -- updates, so a same-value write must not be treated as a violation).
  if old.status in ('finalized', 'superseded') and new.status is distinct from old.status then
    raise exception 'credit_memo_snapshots: cannot transition out of terminal status % (attempted %)', old.status, new.status;
  end if;

  return new;
end;
$$;

comment on function credit_memo_snapshots_enforce_immutability is
  'Enforces Rule 4: once a snapshot leaves status=draft, the certified payload is frozen at the DB layer. Application code may still update underwriter_feedback_json, status (forward-only, never back to draft, never out of a terminal state), superseded_by, and superseded_at.';
