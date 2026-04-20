# 📊 BUDDY ANALYTICS — INEVITABLE DEAL METRICS

**Purpose:** Measure system convergence performance and identify blockers.

**Principle:** All metrics derive from the canonical state (deals.ready_at, pipeline ledger).

---

## 🎯 CORE METRICS

### 1. Time to Ready (TTR)

**Definition:** Hours from deal creation to ready_at timestamp.

```sql
select
  id,
  borrower_name,
  created_at,
  ready_at,
  extract(epoch from (ready_at - created_at))/3600 as hours_to_ready
from public.deals
where ready_at is not null
order by ready_at desc
limit 100;
```

**Target:** < 24 hours median TTR.

---

### 2. Readiness Rate

**Definition:** % of deals that become ready within 7 days.

```sql
with cohort as (
  select
    id,
    created_at,
    ready_at,
    ready_at is not null and ready_at <= created_at + interval '7 days' as ready_within_7d
  from public.deals
  where created_at >= now() - interval '30 days'
)
select
  count(*) as total_deals,
  count(*) filter (where ready_within_7d) as ready_within_7d,
  round(100.0 * count(*) filter (where ready_within_7d) / count(*), 1) as readiness_rate_pct
from cohort;
```

**Target:** > 80% readiness rate.

---

### 3. Blocker Breakdown

**Definition:** Most common reasons deals fail to converge.

```sql
select
  ready_reason,
  count(*) as deal_count,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from public.deals
where ready_at is null
  and created_at >= now() - interval '30 days'
group by ready_reason
order by deal_count desc
limit 10;
```

**Use:** Identify systematic upload/checklist issues.

---

### 4. Convergence Velocity (by Bank)

**Definition:** Median TTR by bank_id.

```sql
select
  b.name as bank_name,
  count(*) as deals_ready,
  round(percentile_cont(0.5) within group (
    order by extract(epoch from (d.ready_at - d.created_at))/3600
  ), 1) as median_hours_to_ready
from public.deals d
join public.banks b on d.bank_id = b.id
where d.ready_at is not null
  and d.created_at >= now() - interval '30 days'
group by b.id, b.name
order by median_hours_to_ready asc;
```

**Use:** Compare bank performance, identify training gaps.

---

## 📈 CONVERGENCE FUNNEL

**Definition:** Where do deals get stuck?

```sql
with deal_status as (
  select
    id,
    case
      when ready_at is not null then 'ready'
      when ready_reason ilike '%upload%' then 'uploads_processing'
      when ready_reason ilike '%checklist%' then 'checklist_incomplete'
      else 'other_blocked'
    end as status
  from public.deals
  where created_at >= now() - interval '7 days'
)
select
  status,
  count(*) as deal_count,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from deal_status
group by status
order by deal_count desc;
```

---

## 🚨 PIPELINE HEALTH MONITORS

### 5. Stuck Deals (> 48h Not Ready)

```sql
select
  id,
  borrower_name,
  created_at,
  ready_reason,
  extract(epoch from (now() - created_at))/3600 as hours_stuck
from public.deals
where ready_at is null
  and created_at < now() - interval '48 hours'
order by created_at asc;
```

**Alert:** Manual review if > 10 stuck deals.

---

### 6. Ledger Event Volume (Convergence Activity)

```sql
select
  stage,
  status,
  count(*) as event_count,
  max(created_at) as last_seen
from public.deal_pipeline_ledger
where created_at >= now() - interval '24 hours'
group by stage, status
order by event_count desc;
```

**Use:** Detect if auto-seed/reconcile stopped running.

---

## 🎁 WEBHOOK DELIVERY HEALTH

```sql
select
  event,
  count(*) as total_attempts,
  count(*) filter (where error is null and response_status < 400) as successful,
  round(100.0 * count(*) filter (where error is null and response_status < 400) / count(*), 1) as success_rate_pct
from public.webhook_deliveries
where delivered_at >= now() - interval '7 days'
group by event
order by total_attempts desc;
```

**Target:** > 95% webhook success rate.

---

## 📊 DASHBOARD QUERIES

### One-Stop System Health

```sql
with metrics as (
  select
    count(*) as total_deals,
    count(*) filter (where ready_at is not null) as ready_deals,
    round(percentile_cont(0.5) within group (
      order by extract(epoch from (ready_at - created_at))/3600
    ), 1) as median_ttr_hours,
    count(*) filter (where created_at < now() - interval '48 hours' and ready_at is null) as stuck_deals
  from public.deals
  where created_at >= now() - interval '7 days'
)
select
  total_deals,
  ready_deals,
  round(100.0 * ready_deals / nullif(total_deals, 0), 1) as readiness_rate_pct,
  median_ttr_hours,
  stuck_deals
from metrics;
```

---

## 🎯 USAGE NOTES

**Frequency:**
- Run daily: TTR, Readiness Rate, Stuck Deals
- Run weekly: Blocker Breakdown, Convergence Velocity
- Run on-demand: Webhook Health, Ledger Activity

**Export:**
- Superset / Metabase dashboards
- Daily Slack digest (via webhook)
- CSV export for stakeholder reports

**Alerts:**
- Median TTR > 48h → Investigate auto-seed
- Readiness rate < 70% → User training issue
- Stuck deals > 10 → Manual review needed
- Webhook success < 90% → Check lender integrations

---

**This is the complete analytics spec for the Inevitable Deal system.**
