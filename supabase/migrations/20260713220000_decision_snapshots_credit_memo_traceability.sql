-- Traceability link: decision_snapshots -> credit_memo_snapshots.
--
-- decision_snapshots and credit_memo_snapshots are deliberately SEPARATE
-- document types (see docs/audits/f31b0feb-credit-memo-system-boundaries.md)
-- — the decision is computed independently from financial_snapshots, not
-- derived from the certified credit memo. But today there is no way to look
-- at a decision_snapshots row and see which certified credit memo (if any)
-- was on file when the decision was proposed, which makes it impossible to
-- audit "did the committee's decision agree with the memo's DSCR at the
-- time?" after the fact.
--
-- Both columns are populated ONLY at proposal/INSERT time (see
-- generateDecisionSnapshot.ts) — never backfilled onto an existing row —
-- because trg_block_final_snapshot_updates (20251229000002) rejects ANY
-- update once status='final'. Nullable and FK-optional: a decision snapshot
-- proposed before any credit memo was certified for the deal (or for a deal
-- type that never produces one) must still be insertable.

alter table public.decision_snapshots
  add column if not exists credit_memo_snapshot_id uuid null references public.credit_memo_snapshots(id) on delete set null,
  add column if not exists credit_memo_dscr numeric null;

comment on column public.decision_snapshots.credit_memo_snapshot_id is
  'The certified credit_memo_snapshots row (Florida Armory) on file for this deal at the moment this decision was proposed, if any. Populated at INSERT time only — the row becomes immutable once status=final.';

comment on column public.decision_snapshots.credit_memo_dscr is
  'canonical_memo.financial_analysis.dscr.value read from the credit memo snapshot referenced by credit_memo_snapshot_id, captured at proposal time for quick cross-referencing without a join.';

create index if not exists decision_snapshots_credit_memo_snapshot_id_idx
  on public.decision_snapshots(credit_memo_snapshot_id);
