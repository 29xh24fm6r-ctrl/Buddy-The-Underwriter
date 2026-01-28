# Pulse Omega Prime × Buddy Observer Integration

## Overview

This document describes the Buddy → Pulse observability integration that enables Claude to debug Buddy workflows in real-time.

```
Buddy (telemetry + errors)
   └─► Pulse Ingestion Endpoint (Cloud Run)
         └─► Pulse Supabase (buddy_observer_events + buddy_deal_state)
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

### Buddy Environment Variables

```bash
# Required for observer events
PULSE_BUDDY_INGEST_URL=https://pulse-mcp-651478110010.us-central1.run.app/ingest/buddy
PULSE_BUDDY_INGEST_SECRET=<shared-secret>

# Optional (auto-detected from Vercel env if not set)
BUDDY_ENV=dev
BUDDY_RELEASE=
```

---

## Pulse Side (Implemented)

All Pulse-side code lives in `services/pulse-mcp/src/`.

### 1. Supabase Migrations

| Migration | Description |
|-----------|-------------|
| `202601280001_buddy_observability.sql` | Tables: `buddy_observer_events`, `buddy_deal_state`, `buddy_incidents` + indexes + RLS |
| `202601280002_buddy_error_fingerprint_summary.sql` | RPC: `buddy_error_fingerprint_summary(p_env, p_minutes, p_limit)` |

### 2. Secure Ingestion Endpoint

Location: `services/pulse-mcp/src/routes/ingestBuddy.ts`

- `POST /ingest/buddy` — accepts signed Buddy events
- Captures raw body via `express.json({ verify })` middleware for HMAC verification
- Uses `crypto.timingSafeEqual` on hex-decoded signature buffers
- Validates payload structure (product, env, type, severity, message, fingerprint)
- Inserts into `buddy_observer_events` (append-only)
- Upserts `buddy_deal_state` on deal-scoped events (fail-soft)

### 3. MCP Read-Only Tools

Location: `services/pulse-mcp/src/tools/buddy_observability.ts`

| Tool | Description |
|------|-------------|
| `buddy.list_recent_errors` | Recent error/fatal events (filterable by env, minutes) |
| `buddy.get_deal_timeline` | Full event history for a deal_id (chronological) |
| `buddy.get_deal_state` | Current state snapshot for a deal_id |
| `buddy.list_stuck_deals` | Deals with no events in N minutes (idle detection) |
| `buddy.list_incidents` | Open/ack/resolved incidents from automatic detection |
| `buddy.error_fingerprint_summary` | Top N error clusters grouped by fingerprint (RPC) |
| `buddy.get_fingerprint_samples` | Raw events for a specific fingerprint cluster |

All tools are registered in `services/pulse-mcp/src/tools/index.ts` and allowlisted as read-only in `services/pulse-mcp/src/allowlist.ts`.

### 4. Incident Detector

Location: `services/pulse-mcp/src/incidents/buddyDetector.ts`

- Runs on `/tick` (fail-soft, never throws)
- Groups recent errors by `env::fingerprint`
- Creates incident records when count >= threshold within window
- Respects cooldown to avoid duplicate notifications
- Controlled by env vars: `BUDDY_INCIDENTS_ENABLED`, `BUDDY_INCIDENT_THRESHOLD`, `BUDDY_INCIDENT_WINDOW_MIN`, `BUDDY_INCIDENT_COOLDOWN_MIN`

### Pulse Environment Variables

```bash
# Required
PULSE_BUDDY_INGEST_SECRET=<same value as Buddy's PULSE_BUDDY_INGEST_SECRET>

# Optional (incidents)
BUDDY_INCIDENTS_ENABLED=true
BUDDY_INCIDENT_THRESHOLD=10
BUDDY_INCIDENT_WINDOW_MIN=10
BUDDY_INCIDENT_COOLDOWN_MIN=60
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

## Claude Incident Response Loop

1. **Cluster scan:** `buddy.error_fingerprint_summary({ env:"prod", minutes:60, limit:10 })`
2. **Drill into cluster:** `buddy.get_fingerprint_samples({ fingerprint:"...", minutes:240, limit:50 })`
3. **Deal timeline:** `buddy.get_deal_timeline({ deal_id:"..." })` (from sample deal_ids)
4. **Current state:** `buddy.get_deal_state({ deal_id:"..." })`
5. **Stuck deals:** `buddy.list_stuck_deals({ env:"prod", stage:"underwriting", idleMinutes:1440 })`
6. **Propose fix** with evidence (stack traces, context, affected deals, release correlation)

---

## What This Enables

Claude can now:
- Detect new Buddy failures every tick
- Group errors by fingerprint
- Reconstruct deal timelines
- Query current deal state
- Detect stuck/idle deals
- Correlate failures with releases
- Auto-detect incident spikes
- Propose fixes as Omega Gate proposals
- Never silently mutate production

**Status:**
- Buddy emits events ✅
- Pulse ingestion endpoint ✅
- Deal state upsert on ingest ✅
- Fingerprint summary RPC ✅
- Read-only MCP tools (7 tools) ✅
- Incident detector ✅
- Claude can answer: "Why did Deal X fail and what changed right before?" ✅
- Claude can answer: "Top 10 error clusters in the last hour and which deals are affected?" ✅

**Remaining:**
- Apply Supabase migrations to Pulse DB
- Deploy Pulse MCP to Cloud Run with env vars
- Wire Buddy deal flow code to call telemetry helpers
