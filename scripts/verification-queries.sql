-- verification-queries.sql
-- Run these in Supabase SQL Editor to verify reminder system health

-- 1. Run status summary (sent/skipped/error counts)
SELECT 
  status, 
  COUNT(*) as count,
  MAX(ran_at) as last_run
FROM deal_reminder_runs
GROUP BY status
ORDER BY count DESC;

-- 2. Recent runs (last 20)
SELECT 
  subscription_id,
  due_at,
  ran_at,
  status,
  error,
  meta
FROM deal_reminder_runs
ORDER BY ran_at DESC
LIMIT 20;

-- 3. Error rate last 24h
SELECT 
  status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM deal_reminder_runs
WHERE ran_at >= NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY count DESC;

-- 4. Subscriptions with recent errors
SELECT 
  drs.channel,
  drs.destination,
  COUNT(drr.id) as error_count,
  MAX(drr.ran_at) as last_error,
  MAX(drr.error) as last_error_message
FROM deal_reminder_runs drr
JOIN deal_reminder_subscriptions drs ON drs.id = drr.subscription_id
WHERE drr.status = 'error'
  AND drr.ran_at >= NOW() - INTERVAL '7 days'
GROUP BY drs.id, drs.channel, drs.destination
ORDER BY error_count DESC
LIMIT 20;

-- 5. Next 50 due subscriptions
SELECT 
  id,
  channel,
  destination,
  next_run_at,
  cadence_days,
  active
FROM deal_reminder_subscriptions
WHERE active = true
  AND next_run_at <= NOW() + INTERVAL '24 hours'
ORDER BY next_run_at ASC
LIMIT 50;

-- 6. Health check (subscriptions vs runs)
SELECT 
  (SELECT COUNT(*) FROM deal_reminder_subscriptions WHERE active = true) as active_subscriptions,
  (SELECT COUNT(*) FROM deal_reminder_runs WHERE ran_at >= NOW() - INTERVAL '24 hours') as runs_last_24h,
  (SELECT COUNT(*) FROM deal_reminder_runs WHERE status = 'error' AND ran_at >= NOW() - INTERVAL '24 hours') as errors_last_24h;
