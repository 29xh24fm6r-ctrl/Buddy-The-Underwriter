# Pulse Omega Prime × Buddy Observer Integration

## Overview

This document describes the Buddy → Pulse observability integration that enables Claude to debug Buddy workflows in real-time.

```
Buddy (telemetry + errors)
   └─► Pulse Ingestion Endpoint (Cloud Run)
         └─► Pulse Supabase (buddy_observer_events)
               └─► Pulse MCP (read-only tools)
                     └─► Claude (analysis + proposals only)
```

**Key rules:**
- Claude NEVER connects directly to Buddy prod
- Claude NEVER writes to Buddy prod
- Pulse is the single brain + gate
- All Buddy insight is append-only, auditable, replayable

---

## Buddy Side (Implemented)

### Telemetry Helper

Location: `src/lib/telemetry/observerEvents.ts`

```typescript
import {
  emitObserverEvent,
  captureException,
  emitDealTransition,
  emitDealError,
  emitServiceError
} from "@/lib/telemetry";
```

### Usage Examples

**Deal Transition:**
```typescript
await emitDealTransition({
  deal_id,
  from_stage: "intake",
  to_stage: "underwriting",
  context: { borrower_id },
});
```

**Deal Error:**
```typescript
try {
  await generateCreditMemo(deal);
} catch (err) {
  await emitDealError({
    deal_id,
    stage: "underwriting",
    error: err,
    context: { operation: "generateCreditMemo", borrower_id },
  });
  throw err;
}
```

**Generic Error Capture:**
```typescript
try {
  await riskyOperation();
} catch (err) {
  await captureException(err, {
    type: "integration.fail",
    stage: "ocr",
    context: { document_id, provider: "azure" },
  });
  throw err;
}
```

**Service Error:**
```typescript
await emitServiceError({
  service: "supabase",
  error: err,
  context: { operation: "insert", table: "deals" },
});
```

### Environment Variables

```bash
# Required for observer events
PULSE_INGEST_URL=https://pulse-mcp-651478110010.us-central1.run.app/ingest/buddy
PULSE_INGEST_SECRET=<shared-secret>
```

---

## Pulse Side (TODO)

### 1. Supabase Migration

```sql
create table if not exists public.buddy_observer_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  product text not null default 'buddy',
  env text not null, -- prod | preview | dev

  severity text not null, -- debug | info | warn | error | fatal
  type text not null,     -- deal.transition | deal.error | service.error | etc

  deal_id text null,
  stage text null,

  message text not null,
  fingerprint text not null,

  context jsonb not null default '{}'::jsonb,
  error jsonb null,

  trace_id text null,
  request_id text null,
  release text null
);

create index on public.buddy_observer_events (created_at desc);
create index on public.buddy_observer_events (deal_id, created_at desc);
create index on public.buddy_observer_events (severity, created_at desc);
create index on public.buddy_observer_events (fingerprint);

-- RLS: service role only
alter table public.buddy_observer_events enable row level security;
create policy "pulse_service_only" on public.buddy_observer_events for all using (false);
```

### 2. Ingestion Endpoint

Add to Pulse MCP server:

```typescript
// services/pulse-mcp/src/ingest/buddy.ts
import crypto from "crypto";
import { supabaseAdmin } from "../supabase";

export async function ingestBuddyEvent(req, res) {
  const raw = JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha256", process.env.PULSE_INGEST_SECRET!)
    .update(raw)
    .digest("hex");

  if (req.headers["x-pulse-signature"] !== expected) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const { error } = await supabaseAdmin
    .from("buddy_observer_events")
    .insert(req.body);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(202).json({ ok: true });
}

// Wire into MCP server
app.post("/ingest/buddy", ingestBuddyEvent);
```

### 3. MCP Read-Only Tools

```typescript
// buddy.list_recent_errors
export async function listRecentBuddyErrors({ minutes = 60 }) {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  return supabaseAdmin
    .from("buddy_observer_events")
    .select("*")
    .gte("created_at", since)
    .in("severity", ["error", "fatal"])
    .order("created_at", { ascending: false });
}

// buddy.get_deal_timeline
export async function getDealTimeline({ deal_id }) {
  return supabaseAdmin
    .from("buddy_observer_events")
    .select("*")
    .eq("deal_id", deal_id)
    .order("created_at", { ascending: true });
}

// buddy.search_events
export async function searchBuddyEvents({ query }) {
  return supabaseAdmin
    .from("buddy_observer_events")
    .select("*")
    .textSearch("message", query)
    .order("created_at", { ascending: false })
    .limit(100);
}
```

---

## Event Types

| Type | Description |
|------|-------------|
| `deal.transition` | Deal moved to new stage |
| `deal.error` | Error during deal processing |
| `service.error` | External service failure |
| `guard.fail` | Permission/validation guard failure |
| `integration.fail` | Third-party integration failure |
| `workflow.step` | Workflow step completed |
| `workflow.error` | Workflow step failed |

## Severity Levels

| Level | Description |
|-------|-------------|
| `debug` | Verbose debugging info |
| `info` | Normal operational events |
| `warn` | Potential issues |
| `error` | Errors that need attention |
| `fatal` | Critical failures |

---

## What This Enables

Claude can now:
- Detect new Buddy failures every tick
- Group errors by fingerprint
- Reconstruct deal timelines
- Correlate failures with releases
- Propose fixes as Omega Gate proposals
- Never silently mutate production

**MVP Complete When:**
- Buddy emits events ✅
- Pulse ingests them (TODO)
- Claude can answer: "Why did Deal X fail and what changed right before?"
