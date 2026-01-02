# Deal Readiness Analytics

## 📊 Canonical Metrics

All analytics derive from the **Deal Readiness invariant** (`ready_at`, `ready_reason`) and the **state-oriented ledger** (`stage`, `status`, `payload`).

---

## 🎯 Core Metric: Time to Ready

**Definition**: Time from deal creation to readiness

**SQL Query** (Supabase SQL Editor):

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
limit 50;
```

**Use Cases**:
- Benchmark deal velocity
- Identify slow-moving deals
- Measure automation impact

---

## 🚧 Blocker Analysis

**Definition**: What prevents deals from becoming ready?

**SQL Query** (Supabase SQL Editor):

```sql
select
  stage,
  status,
  payload->>'reason' as blocker,
  count(*) as frequency
from public.deal_pipeline_ledger
where status = 'blocked'
group by stage, status, blocker
order by frequency desc;
```

**Output Example**:
```
stage       status    blocker                           frequency
auto_seed   blocked   Uploads still processing          42
readiness   blocked   Checklist incomplete (2 items)    18
```

**Use Cases**:
- Prioritize automation investment
- Identify training gaps
- Surface systemic bottlenecks

---

## ⏱️ Stage Duration

**Definition**: Time spent in each pipeline stage

**SQL Query** (Supabase SQL Editor):

```sql
with stage_events as (
  select
    deal_id,
    stage,
    created_at,
    lead(created_at) over (partition by deal_id order by created_at) as next_at
  from public.deal_pipeline_ledger
)
select
  stage,
  avg(extract(epoch from (next_at - created_at))/3600) as avg_hours,
  count(*) as occurrences
from stage_events
where next_at is not null
group by stage
order by avg_hours desc;
```

**Use Cases**:
- Identify slow stages
- Measure checklist efficiency
- Track upload processing time

---

## 📈 Readiness Rate Over Time

**Definition**: % of deals ready within X days

**SQL Query** (Supabase SQL Editor):

```sql
select
  date_trunc('week', created_at) as week,
  count(*) as total_deals,
  count(ready_at) filter (where extract(epoch from (ready_at - created_at))/86400 <= 7) as ready_in_7_days,
  round(100.0 * count(ready_at) filter (where extract(epoch from (ready_at - created_at))/86400 <= 7) / count(*), 2) as ready_rate_pct
from public.deals
where created_at >= now() - interval '90 days'
group by week
order by week desc;
```

**Use Cases**:
- Track automation ROI
- Report to leadership
- Set SLAs

---

## 🔍 Current Backlog Health

**Definition**: Deals in progress, grouped by readiness reason

**SQL Query** (Supabase SQL Editor):

```sql
select
  ready_reason,
  count(*) as deals,
  avg(extract(epoch from (now() - created_at))/86400) as avg_age_days
from public.deals
where ready_at is null
  and submitted_at is null
group by ready_reason
order by deals desc;
```

**Output Example**:
```
ready_reason                               deals  avg_age_days
Checklist incomplete (1 items missing)     15     4.2
Uploads processing (2 remaining)           8      1.1
Checklist not initialized                  3      12.5
```

**Use Cases**:
- Daily standup context
- Identify stuck deals
- Surface configuration issues (e.g., checklist not auto-seeded)

---

## 🧠 ANALYTICS PRINCIPLES

1. **Ledger = Ground Truth**: All metrics derive from `deal_pipeline_ledger` + `deals` table
2. **No Aggregation Tables**: Query raw data (Postgres is fast enough)
3. **Human-Readable**: Queries should explain themselves
4. **Actionable**: Every metric should inform a decision

---

## 🔮 FUTURE METRICS (OPTIONAL)

- **Submission velocity**: Time from ready → submitted
- **Borrower response time**: Time between upload requests and first upload
- **Checklist accuracy**: % of items correctly auto-classified
- **Webhook reliability**: Success rate of outbound webhooks

---

## 📌 HOW TO USE

1. Copy query to Supabase SQL Editor
2. Run query
3. Export CSV or visualize in BI tool (Metabase, Retool, etc.)

**No code changes required** — these are read-only analytical queries.
