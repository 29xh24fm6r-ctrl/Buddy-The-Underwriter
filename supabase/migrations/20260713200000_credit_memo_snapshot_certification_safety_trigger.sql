-- Credit Memo Snapshot Certification Safety Trigger
--
-- Audit finding: assertCommitteeMemoSafe() (src/lib/creditMemo/snapshot/
-- assertCommitteeMemoSafe.ts) is the guard that's supposed to guarantee no
-- incomplete/placeholder-laden memo can ever be certified. It is a PURE
-- IN-MEMORY JS FUNCTION with no DB-level equivalent, called only from
-- buildFloridaArmorySnapshot.ts, called only from submitCreditMemoToUnderwriting.ts.
-- Today that's the only writer of a non-draft credit_memo_snapshots row —
-- but that's a code-discipline guarantee, not a hard one: the existing
-- immutability trigger only fires BEFORE UPDATE, never BEFORE INSERT, and
-- credit_memo_snapshots_submission_required only requires submitted_by/
-- submitted_at/input_hash to be NON-NULL, never validates their content.
-- Any future INSERT that sets status directly to a certified value (e.g. a
-- backfill/admin script using the service-role client, which bypasses RLS
-- entirely) could produce a "certified" row that never touched
-- assertCommitteeMemoSafe.
--
-- This migration adds a DB-level backstop replicating the highest-value
-- structural checks from assertCommitteeMemoSafe (NOT a full reimplementation
-- — the DSCR-contradiction and AR-LOC-specific checks are intentionally left
-- to the application layer; they're narrow judgment calls not well suited to
-- a blanket DB trigger). It fires only on the TRANSITION into a certified
-- status (an INSERT whose status is already non-draft/banker_review, or an
-- UPDATE moving a row OUT of draft/banker_review) and requires:
--   - memo_output_json.schema_version === 'florida_armory_v1'
--   - memo_output_json.meta.render_mode === 'committee'
--   - memo_output_json.banker_submission.certification === true
--   - memo_output_json.diagnostics.readiness_contract.passed === true
--   - memo_output_json.diagnostics.warnings is an empty array
--   - no forbidden-placeholder string anywhere in memo_output_json's STRING
--     VALUES (never its object keys — see credit_memo_jsonb_string_values
--     below; a naive whole-document text scan would false-positive on the
--     real field name `pending_guarantor_items`, which legitimately exists
--     on every memo regardless of whether that array is empty)
--
-- Deliberately scoped to the transition only, NOT every subsequent status
-- change: confirmed via direct query before writing this migration that
-- production already has a real, currently in-flight banker_submitted
-- snapshot containing literal "Pending" values and a "⚠ Data unavailable —
-- financial spreads required" string (it predates the assertCommitteeMemoSafe
-- fix and the forbidden-phrase-list fix, both landed in this same change).
-- If this trigger re-validated content on every update, the next legitimate
-- operation on that real row (e.g. an underwriter recording their decision,
-- which UPDATEs status) would be permanently blocked with no way to fix
-- already-frozen memo_output_json. Since the immutability trigger already
-- guarantees memo_output_json can't change after the first certification,
-- re-validating on later transitions is both redundant for rows that passed
-- the JS check and actively harmful for rows that predate it.
--
-- The real submission pipeline already satisfies every one of these checks
-- (buildFloridaArmorySnapshot calls assertCommitteeMemoSafe before
-- returning), so this trigger should never fire against legitimate NEW
-- submissions — it only rejects a row that never went through that check.

-- ── Recursive string-leaf-value extractor ──────────────────────────────────
-- Walks a jsonb document and yields every STRING value found at any depth,
-- ignoring object keys and non-string scalars entirely. Using IF/ELSIF
-- branches (rather than a single UNION ALL query gated by WHERE) avoids
-- calling jsonb_array_elements()/jsonb_each() on a value of the wrong type,
-- which would raise "cannot extract elements from a scalar" instead of
-- simply filtering out that branch.
create or replace function credit_memo_jsonb_string_values(node jsonb)
returns setof text
language plpgsql
as $$
begin
  if node is null then
    return;
  elsif jsonb_typeof(node) = 'string' then
    return next node #>> '{}';
  elsif jsonb_typeof(node) = 'array' then
    return query
      select v
      from jsonb_array_elements(node) as elem
      cross join lateral credit_memo_jsonb_string_values(elem) as v;
  elsif jsonb_typeof(node) = 'object' then
    return query
      select v
      from jsonb_each(node) as kv
      cross join lateral credit_memo_jsonb_string_values(kv.value) as v;
  end if;
  return;
end;
$$;

alter function credit_memo_jsonb_string_values(jsonb) set search_path = public;

comment on function credit_memo_jsonb_string_values(jsonb) is
  'Yields every string leaf value in a jsonb document at any depth (never object keys). Used by the credit_memo_snapshots certification-safety trigger to scan memo content for forbidden placeholder strings without false-positiving on field names like pending_guarantor_items.';

-- ── Trigger function ────────────────────────────────────────────────────────
create or replace function credit_memo_snapshots_enforce_certification_safety()
returns trigger
language plpgsql
as $$
declare
  bad_value text;
  entering_certified_status boolean;
begin
  -- Only validate the TRANSITION into a certified status, not every
  -- subsequent status change on an already-certified row. A row that is
  -- already banker_submitted/underwriter_review/etc. moving to another
  -- non-draft status (e.g. an underwriter recording a decision, or the
  -- supersede-on-resubmit flow) must not be re-validated here — the
  -- immutability trigger already guarantees memo_output_json can't change
  -- after certification, and re-validating would incorrectly block forward
  -- progress on any row certified before this trigger existed.
  entering_certified_status :=
    new.status not in ('draft', 'banker_review')
    and (tg_op = 'INSERT' or old.status in ('draft', 'banker_review'));

  if entering_certified_status then
    if new.memo_output_json is null then
      raise exception 'credit_memo_snapshots: memo_output_json is required once status leaves draft/banker_review';
    end if;

    if (new.memo_output_json->>'schema_version') is distinct from 'florida_armory_v1' then
      raise exception 'credit_memo_snapshots: memo_output_json.schema_version must be florida_armory_v1 for a certified snapshot (got %)', (new.memo_output_json->>'schema_version');
    end if;

    if (new.memo_output_json->'meta'->>'render_mode') is distinct from 'committee' then
      raise exception 'credit_memo_snapshots: memo_output_json.meta.render_mode must be committee for a certified snapshot (got %)', (new.memo_output_json->'meta'->>'render_mode');
    end if;

    if (new.memo_output_json->'banker_submission'->>'certification') is distinct from 'true' then
      raise exception 'credit_memo_snapshots: memo_output_json.banker_submission.certification must be true for a certified snapshot';
    end if;

    if (new.memo_output_json->'diagnostics'->'readiness_contract'->>'passed') is distinct from 'true' then
      raise exception 'credit_memo_snapshots: memo_output_json.diagnostics.readiness_contract.passed must be true for a certified snapshot';
    end if;

    if jsonb_typeof(new.memo_output_json->'diagnostics'->'warnings') is distinct from 'array'
       or jsonb_array_length(new.memo_output_json->'diagnostics'->'warnings') <> 0 then
      raise exception 'credit_memo_snapshots: memo_output_json.diagnostics.warnings must be an empty array for a certified snapshot';
    end if;

    select v into bad_value
    from credit_memo_jsonb_string_values(new.memo_output_json) as v
    where v like '%' || chr(9888) || '%'  -- ⚠ (U+26A0 WARNING SIGN)
       or lower(v) like '%pending%'
       or lower(v) like '%unknown%'
       or lower(v) like '%generating%'
       or lower(v) like '%unable to compute%'
       or lower(v) like '%conclusion pending%'
       or lower(v) like '%narrative generation unavailable%'
    limit 1;

    if bad_value is not null then
      raise exception 'credit_memo_snapshots: memo_output_json contains a forbidden placeholder value for a certified snapshot: %', left(bad_value, 80);
    end if;
  end if;

  return new;
end;
$$;

alter function credit_memo_snapshots_enforce_certification_safety() set search_path = public;

comment on function credit_memo_snapshots_enforce_certification_safety is
  'DB-level backstop for assertCommitteeMemoSafe() — rejects any INSERT/UPDATE that would certify (status not in draft/banker_review) a credit_memo_snapshots row whose memo_output_json is not schema-valid, uncertified, readiness-failed, warning-bearing, or placeholder-laden. The real application pipeline already satisfies all of this before it ever reaches the DB; this exists so a future bypass insert (e.g. a backfill/admin script) cannot silently certify an unsafe memo.';

drop trigger if exists trg_credit_memo_snapshots_certification_safety on credit_memo_snapshots;

create trigger trg_credit_memo_snapshots_certification_safety
  before insert or update on credit_memo_snapshots
  for each row
  execute function credit_memo_snapshots_enforce_certification_safety();
