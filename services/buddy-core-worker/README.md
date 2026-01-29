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

### One-command deploy (recommended)

```bash
./scripts/gcp/worker-deploy.sh
```

Runs preflight checks (APIs, service account, secrets), then deploys via `gcloud run deploy --source`.

Override defaults with env vars: `PROJECT`, `REGION`, `SERVICE`, `SA`.

### Verify

```bash
./scripts/gcp/worker-verify.sh
```

Checks the service exists, tails recent logs, and fails if DB auth/RLS errors are detected.

### Expected log patterns

```
[buddy-core-worker] starting { workerId, pulseUrl, ... }
[buddy-core-worker] database connected
[heartbeat] started { intervalMs: 15000 }
[outbox] started { pollMs: 2000, batchSize: 25, claimTtlSeconds: 120 }
```

### Check undelivered backlog

```sql
select count(*) as undelivered from buddy_outbox_events where delivered_at is null;
```

### Raw deploy command (reference only)

```bash
gcloud run deploy buddy-core-worker \
  --source services/buddy-core-worker \
  --service-account buddy-core-worker@buddy-the-underwriter.iam.gserviceaccount.com \
  --min-instances 1 \
  --max-instances 2 \
  --cpu 1 \
  --memory 512Mi \
  --no-allow-unauthenticated \
  --set-secrets BUDDY_DB_URL=BUDDY_DB_URL:latest \
  --set-secrets PULSE_MCP_URL=PULSE_MCP_URL:latest \
  --set-secrets PULSE_MCP_KEY=PULSE_MCP_KEY:latest
```

## Local dev

```bash
cd services/buddy-core-worker
npm install
npm run dev
```
