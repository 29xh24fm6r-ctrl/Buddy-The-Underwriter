-- Extend credit_memo_snapshots_enforce_certification_safety() with the two
-- checks the prior migration deliberately left to the application layer:
-- DSCR-contradiction and AR-LOC-borrowing-base-analysis. On reflection these
-- are portable enough (same regex logic as assertCommitteeMemoSafe.ts, just
-- translated to Postgres's regex dialect) to be worth mirroring as a DB-level
-- backstop too — the whole point of this trigger is defense against a bypass
-- INSERT that never touched the JS check at all, and these two checks are as
-- much a part of that guarantee as the others already mirrored.
--
-- Still fires only on the transition into a certified status (see the prior
-- migration's comment for why: a real production row predates these checks
-- and must not be re-validated on its next legitimate status change).

create or replace function credit_memo_snapshots_enforce_certification_safety()
returns trigger
language plpgsql
as $$
declare
  bad_value text;
  entering_certified_status boolean;
  canonical_memo jsonb;
  arloc_product_haystack text;
  is_ar_loc boolean;
  section_narratives text;
  arloc_support_haystack text;
  has_borrowing_base boolean;
  has_ar_aging boolean;
  has_eligible_ar boolean;
  dscr_value text;
  recommendation_surfaces text;
begin
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

    -- ── DSCR contradiction (mirrors hasDscrContradiction in assertCommitteeMemoSafe.ts) ──
    canonical_memo := new.memo_output_json->'canonical_memo';
    dscr_value := canonical_memo->'financial_analysis'->'dscr'->>'value';
    if dscr_value is not null and canonical_memo->'recommendation' is not null then
      recommendation_surfaces := lower(
        coalesce(canonical_memo->'recommendation'->>'headline', '') || ' ' ||
        coalesce((select string_agg(elem, ' ') from jsonb_array_elements_text(coalesce(canonical_memo->'recommendation'->'rationale', '[]'::jsonb)) as elem), '') || ' ' ||
        coalesce((select string_agg(elem, ' ') from jsonb_array_elements_text(coalesce(canonical_memo->'recommendation'->'key_drivers', '[]'::jsonb)) as elem), '')
      );
      if length(trim(recommendation_surfaces)) > 0
         and recommendation_surfaces ~ 'dscr[^.]{0,40}(missing|unavailable|unknown|not\s+available|pending)' then
        raise exception 'credit_memo_snapshots: memo_output_json recommendation contradicts a computed DSCR value (says DSCR missing/unavailable while dscr.value is non-null)';
      end if;
    end if;

    -- ── AR LOC must include borrowing-base / AR aging / eligible AR (mirrors
    -- isArLineOfCreditMemo + arLocHasBorrowingBaseAnalysis) ──
    arloc_product_haystack := lower(
      coalesce(canonical_memo->'transaction_overview'->'loan_request'->>'product', '') || ' ' ||
      coalesce(canonical_memo->'proposed_terms'->>'product', '') || ' ' ||
      coalesce(canonical_memo->'transaction_overview'->'loan_request'->>'purpose', '')
    );

    is_ar_loc := length(trim(arloc_product_haystack)) > 0 and (
      arloc_product_haystack ~ '\y(a/?r|accounts\s+receivable|receivables?)[^\n]{0,80}(loc|line\s+of\s+credit)'
      or arloc_product_haystack ~ '\y(loc|line\s+of\s+credit)[^\n]{0,80}(a/?r|accounts\s+receivable)'
      or arloc_product_haystack ~ 'asset[-\s]based[^\n]{0,40}(loc|line\s+of\s+credit)'
      or arloc_product_haystack ~ 'receivables?[-\s](backed|secured)'
    );

    if is_ar_loc then
      select string_agg(coalesce(sec.value->>'narrative', ''), ' ')
      into section_narratives
      from jsonb_each(coalesce(new.memo_output_json->'sections', '{}'::jsonb)) as sec;

      arloc_support_haystack := lower(
        coalesce(canonical_memo->'collateral'->>'property_description', '') || ' ' ||
        coalesce(canonical_memo->'financial_analysis'->>'income_analysis', '') || ' ' ||
        coalesce((select string_agg(elem, ' ') from jsonb_array_elements_text(coalesce(canonical_memo->'financial_analysis'->'repayment_notes', '[]'::jsonb)) as elem), '') || ' ' ||
        coalesce(canonical_memo->'financial_analysis'->>'projection_feasibility', '') || ' ' ||
        coalesce((select string_agg(elem, ' ') from jsonb_array_elements_text(coalesce(canonical_memo->'recommendation'->'rationale', '[]'::jsonb)) as elem), '') || ' ' ||
        coalesce(section_narratives, '')
      );

      has_borrowing_base := arloc_support_haystack ~ 'borrowing\s+base';
      has_ar_aging := arloc_support_haystack ~ '(a/?r|accounts\s+receivable)\s+aging';
      has_eligible_ar := arloc_support_haystack ~ 'eligible\s+(a/?r|accounts\s+receivable|receivables)';

      if not (has_borrowing_base and has_ar_aging and has_eligible_ar) then
        raise exception 'credit_memo_snapshots: AR line-of-credit memo is missing borrowing-base/AR-aging/eligible-AR analysis';
      end if;
    end if;
  end if;

  return new;
end;
$$;

alter function credit_memo_snapshots_enforce_certification_safety() set search_path = public;

comment on function credit_memo_snapshots_enforce_certification_safety is
  'DB-level backstop for assertCommitteeMemoSafe() — validates ONLY the transition into a certified status (not subsequent status changes on an already-certified row, to avoid blocking forward progress on rows that predate this trigger). Mirrors schema/render-mode/certification/readiness/warnings/placeholder-scan plus DSCR-contradiction and AR-LOC-borrowing-base checks. The real application pipeline already satisfies all of this before it ever reaches the DB; this exists so a future bypass insert (e.g. a backfill/admin script) cannot silently certify an unsafe memo.';
