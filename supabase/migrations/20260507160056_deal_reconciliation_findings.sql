-- Reconstructed from live schema (supabase_migrations.schema_migrations) --
-- this migration was applied directly to the production project and never
-- committed to the repo. Captured verbatim for governance/reproducibility
-- (see CRM audit, 2026-07-16). Note: the "insert_service" policy below was
-- later tightened to service_role-only by
-- 20260716000000_fix_shadow_log_insert_policies_service_role_only.sql.

create table if not exists public.deal_reconciliation_findings (
  id uuid primary key default gen_random_uuid(),

  bank_id uuid not null,
  deal_id uuid not null,
  reconciliation_result_id uuid references public.deal_reconciliation_results(id),

  rule_key text not null,
  rule_version text not null default 'v2',

  severity text not null,
  status text not null default 'open',

  summary_status_contribution text,

  subject_type text,
  subject_id uuid,
  subject_label text,

  source_a_document_id uuid,
  source_a_fact_id uuid,
  source_a_fact_key text,
  source_a_value_num numeric,
  source_a_value_text text,
  source_a_period_start date,
  source_a_period_end date,

  source_b_document_id uuid,
  source_b_fact_id uuid,
  source_b_fact_key text,
  source_b_value_num numeric,
  source_b_value_text text,
  source_b_period_start date,
  source_b_period_end date,

  delta_num numeric,
  delta_pct numeric,
  tolerance_pct numeric,

  explanation text not null,
  evidence jsonb not null default '{}'::jsonb,

  reviewed_at timestamptz,
  reviewed_by text,
  resolution_status text,
  resolution_note text,

  created_at timestamptz not null default now(),

  constraint deal_reconciliation_findings_severity_check
    check (severity in ('info', 'warning', 'material', 'critical')),
  constraint deal_reconciliation_findings_status_check
    check (status in ('open', 'acknowledged', 'resolved', 'false_positive', 'ignored')),
  constraint deal_reconciliation_findings_summary_status_check
    check (summary_status_contribution is null or summary_status_contribution in ('FLAGS', 'CONFLICTS'))
);

create index if not exists idx_recon_findings_deal
  on public.deal_reconciliation_findings(deal_id, created_at desc);

create index if not exists idx_recon_findings_bank
  on public.deal_reconciliation_findings(bank_id, created_at desc);

create index if not exists idx_recon_findings_rule
  on public.deal_reconciliation_findings(rule_key, created_at desc);

create index if not exists idx_recon_findings_severity
  on public.deal_reconciliation_findings(severity, created_at desc);

create index if not exists idx_recon_findings_status
  on public.deal_reconciliation_findings(status, created_at desc);

create index if not exists idx_recon_findings_result
  on public.deal_reconciliation_findings(reconciliation_result_id);

alter table public.deal_reconciliation_findings enable row level security;

create policy "deal_reconciliation_findings_select_bank_scope"
on public.deal_reconciliation_findings
for select
using (
  can_access_deal(deal_id)
);

create policy "deal_reconciliation_findings_update_bank_scope"
on public.deal_reconciliation_findings
for update
using (
  can_access_deal(deal_id)
)
with check (
  can_access_deal(deal_id)
);

create policy "deal_reconciliation_findings_insert_service"
on public.deal_reconciliation_findings
for insert
with check (true);

create or replace view public.reconciliation_findings_daily_v1 as
select
  date_trunc('day', created_at)::date as day,
  bank_id,
  rule_key,
  severity,
  count(*) as findings,
  count(*) filter (where status = 'false_positive') as false_positives,
  count(*) filter (where status = 'resolved') as resolved,
  count(*) filter (where status = 'open') as open_findings,
  round(avg(delta_pct)::numeric, 4) as avg_delta_pct
from public.deal_reconciliation_findings
group by 1, 2, 3, 4;
