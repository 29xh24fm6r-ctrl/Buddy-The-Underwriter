# buddy-core-worker

Always-on Cloud Run service that bridges Buddy's durable outbox to Pulse MCP.

## What it does

1. **Heartbeat loop** — POSTs `mcp_tick` to Pulse every 15 s (exponential backoff on failure, max 60 s).
2. **Outbox forwarder** — Claims undelivered rows from `buddy_outbox_events` using `FOR UPDATE SKIP LOCKED`, forwards each to Pulse via `buddy_event_ingest` (with `event_id` for idempotency), marks delivered or bumps attempts.

## Required env vars

| Variable | Secret Manager Key | Description |
|---|---|---|
| `BUDDY_DB_URL` | `BUDDY_DB_URL` | Postgres connection string (Supabase pooler) |
| `PULSE_MCP_URL` | `PULSE_MCP_URL` | Base URL of Pulse MCP service |
| `PULSE_MCP_KEY` | `PULSE_MCP_KEY` | API key for Pulse MCP |

## Optional env vars

| Variable | Default | Description |
|---|---|---|
| `BUDDY_DB_SERVICE_KEY` | — | Plumbed for future use (not required for pg) |
| `WORKER_ENABLED` | `true` | Master kill-switch |
| `HEARTBEAT_INTERVAL_MS` | `15000` | Base heartbeat interval |
| `POLL_INTERVAL_MS` | `2000` | Outbox poll interval |
| `BATCH_SIZE` | `25` | Max rows per claim |
| `HTTP_TIMEOUT_MS` | `2000` | Pulse HTTP call timeout |
| `CLAIM_TTL_SECONDS` | `120` | Stale claim timeout (seconds) |
| `WORKER_ID` | `hostname-pid` | Unique worker instance identifier |

## RLS setup (required before first deploy)

The `buddy_outbox_events` table has RLS enabled with a **deny-all** default policy. The worker needs explicit access via a dedicated `buddy_worker` DB role.

**Migration:** `supabase/migrations/20260129_buddy_outbox_worker_role.sql`

### Steps

1. **Generate a strong password** for `buddy_worker` (e.g. `openssl rand -base64 32`)

2. **Run the role migration** in Supabase SQL editor (as `postgres`):
   - Open `supabase/migrations/20260129_buddy_outbox_worker_role.sql`
   - Replace `REPLACE_WITH_STRONG_PASSWORD` with the generated password
   - Execute

3. **Update `BUDDY_DB_URL` in Google Secret Manager** to use the new role:
   ```
   postgresql://buddy_worker:<PASSWORD>@db.<ref>.supabase.co:6543/postgres?sslmode=require
   ```

4. **Sanity test** (in SQL editor):
   ```sql
   -- As postgres, insert a test row
   insert into public.buddy_outbox_events (kind, deal_id, payload)
   values ('rls_smoke_test', gen_random_uuid(), '{}'::jsonb);

   -- Verify it appears
   select id, kind, created_at from buddy_outbox_events order by created_at desc limit 5;
   ```

### Why not just use postgres/service_role?

The `postgres` superuser bypasses RLS entirely, which works but violates least-privilege. The `buddy_worker` role is:
- Scoped to only `buddy_outbox_events` (SELECT, INSERT, UPDATE)
- Governed by an explicit permissive RLS policy
- Denied access to all other RLS-protected tables by default

## Deploy (DO NOT RUN IN CI)

```bash
gcloud run deploy buddy-core-worker \
  --source services/buddy-core-worker \
  --service-account buddy-core-worker@buddy-the-underwriter.iam.gserviceaccount.com \
  --min-instances 1 \
  --max-instances 2 \
  --cpu 1 \
  --memory 512Mi \
  --set-secrets \
    BUDDY_DB_URL=BUDDY_DB_URL:latest,\
    BUDDY_DB_SERVICE_KEY=BUDDY_DB_SERVICE_KEY:latest,\
    PULSE_MCP_URL=PULSE_MCP_URL:latest,\
    PULSE_MCP_KEY=PULSE_MCP_KEY:latest \
  --set-env-vars \
    NODE_ENV=production,\
    WORKER_ENABLED=true,\
    POLL_INTERVAL_MS=2000,\
    HEARTBEAT_INTERVAL_MS=15000,\
    BATCH_SIZE=25,\
    HTTP_TIMEOUT_MS=2000,\
    CLAIM_TTL_SECONDS=120 \
  --no-allow-unauthenticated
```

## Verify

```bash
# Tail logs
gcloud run services logs read buddy-core-worker --limit 200

# Expected log patterns:
#   [buddy-core-worker] starting { workerId, pulseUrl, ... }
#   [buddy-core-worker] database connected
#   [heartbeat] started { intervalMs: 15000 }
#   [outbox] started { pollMs: 2000, batchSize: 25, claimTtlSeconds: 120 }
#   [heartbeat] recovered after N failures  (on reconnection)
#   [outbox] forward error: <id> <msg>       (on Pulse failure)

# Check undelivered backlog
psql "$BUDDY_DB_URL" -c "select count(*) as undelivered from buddy_outbox_events where delivered_at is null;"
```

## Local dev

```bash
cd services/buddy-core-worker
npm install
npm run dev
```
