# Pulse Omega Prime — Buddy State View Handler Spec

**Date:** April 14, 2026
**For:** Pulse implementation (Cloud Run service `pulse-mcp`)
**Buddy side:** Complete. This spec is the Pulse-side work only.

---

## What this spec covers

Buddy calls back into Pulse to retrieve Omega's reasoning about a deal.
The infrastructure for this is fully built on Buddy's side — the calls are
already being made. Pulse just needs to handle them.

Three JSON-RPC methods need to be implemented on the `/mcp` endpoint:
1. `omega://state/underwriting_case/{dealId}` — primary advisory state
2. `omega://confidence/evaluate` — confidence score + recommendation
3. `omega://traces/{sessionId}` — reasoning trace (optional, builder-only)

---

## How Buddy calls Pulse

Every Omega call from Buddy hits the same URL and same format:

**URL:** `POST https://pulse-mcp-651478110010.us-central1.run.app/mcp`

**Auth:** `Authorization: Bearer {OMEGA_MCP_API_KEY}`
(This is `PULSE_MCP_API_KEY` on the Cloud Run side — same key)

**Body (JSON-RPC 2.0):**
```json
{
  "jsonrpc": "2.0",
  "id": "buddy-1-abc123",
  "method": "omega://state/underwriting_case/ffcc9733-f866-47fc-83f9-7c08403cea71",
  "params": {}
}
```

**Expected success response:**
```json
{
  "jsonrpc": "2.0",
  "id": "buddy-1-abc123",
  "result": {
    "recommendation": "Deal shows adequate revenue trend but debt service coverage is tight...",
    "signals": ["Debt Service Capacity", "Balance Sheet Discrepancy"],
    "confidence": 0.72
  }
}
```

**Expected error response (if method unknown):**
```json
{
  "jsonrpc": "2.0",
  "id": "buddy-1-abc123",
  "error": {
    "code": -32601,
    "message": "Method not found: omega://state/underwriting_case/..."
  }
}
```

**Timeout budget:** Buddy waits 8 seconds (`OMEGA_MCP_TIMEOUT_MS=8000`).
The Cloud Run instance is now warm (min_instances=1) so this is comfortable.

---

## Step 1 — Add the `/mcp` endpoint

The Cloud Run service currently handles `POST /call` for MCP tool calls and
`POST /ingest/buddy` for event ingestion. Add `POST /mcp` for Omega JSON-RPC
queries. This is a separate path from `/call` — do not merge them.

```javascript
// Express route registration
app.post('/mcp', authenticateOmega, handleOmegaRpc);
```

**Auth middleware for `/mcp`:**
```javascript
function authenticateOmega(req, res, next) {
  const auth = req.headers.authorization ?? '';
  const apiKey = process.env.PULSE_MCP_API_KEY;
  if (!apiKey || auth !== `Bearer ${apiKey}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
```

Note: `/mcp` uses `PULSE_MCP_API_KEY` for auth. `/ingest/buddy` uses
`BUDDY_INGEST_TOKEN`. These are different keys for different callers.

---

## Step 2 — JSON-RPC method router

The method field contains the full omega:// URI. Route by prefix:

```javascript
async function handleOmegaRpc(req, res) {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0' || !method || !id) {
    return res.status(400).json({
      jsonrpc: '2.0', id: id ?? null,
      error: { code: -32600, message: 'Invalid request' }
    });
  }

  try {
    let result;

    if (method.startsWith('omega://state/underwriting_case/')) {
      const dealId = method.replace('omega://state/underwriting_case/', '');
      result = await getUnderwritingCaseState(dealId, params);

    } else if (method === 'omega://confidence/evaluate') {
      result = await evaluateConfidence(params);

    } else if (method.startsWith('omega://traces/')) {
      const sessionId = method.replace('omega://traces/', '');
      result = await getTraces(sessionId, params);

    } else {
      return res.json({
        jsonrpc: '2.0', id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });
    }

    return res.json({ jsonrpc: '2.0', id, result });

  } catch (err) {
    console.error('[omega-rpc] error:', err);
    return res.json({
      jsonrpc: '2.0', id,
      error: { code: -32603, message: String(err?.message ?? err) }
    });
  }
}
```

---

## Step 3 — `getUnderwritingCaseState(dealId)` implementation

This is the primary handler. It queries `buddy_ledger_events` for all events
on the deal and synthesizes a structured advisory.

### Data available in Pulse

The `buddy_ledger_events` table (Pulse Supabase) has these fields:
```
id             UUID
user_id        UUID
created_at     TIMESTAMPTZ
event_type     TEXT   -- e.g. "checklist_reconciled", "readiness_recomputed"
status         TEXT   -- always "success" in current data
deal_id        UUID
payload        JSONB  -- event-specific data
expected_outcome  TEXT
actual_outcome    TEXT
```

**Actual event types flowing from Buddy (last 48h):**
```
checklist_reconciled         — document checklist reconciled after upload
readiness_recomputed         — deal readiness score updated
artifact_processed           — document extracted/processed
deal.intake.retrying         — intake pipeline retrying
manual_override              — banker manually overrode something
gatekeeper.needs_review.inline — deal flagged for review
ocr.completed                — OCR finished on a document
documents.upload_completed   — document uploaded
upload_commit                — upload committed to storage
upload.received              — upload started
deal.underwrite.verify       — underwriting verification run
deal.lifecycle.advanced      — lifecycle stage changed
deal.checklist.seeded        — checklist populated
deal.ignited                 — deal created/launched
deal.created                 — deal record created
```

### Query pattern

```javascript
async function getUnderwritingCaseState(dealId, params) {
  // Fetch all events for this deal, most recent first
  const { data: events, error } = await supabase
    .from('buddy_ledger_events')
    .select('event_type, status, payload, created_at')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !events || events.length === 0) {
    return {
      recommendation: 'Insufficient event history to generate advisory.',
      signals: [],
      confidence: 0.0,
      event_count: 0,
      stale: true,
    };
  }

  return synthesizeAdvisory(dealId, events);
}
```

### Synthesis algorithm

```javascript
function synthesizeAdvisory(dealId, events) {
  const counts = {};
  for (const e of events) {
    counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
  }

  const signals = [];
  const parts = [];
  let confidence = 0.5;

  // === Positive signals ===

  if (counts['artifact_processed'] >= 3) {
    signals.push('Document Coverage');
    parts.push(`${counts['artifact_processed']} documents processed.`);
    confidence += 0.05;
  }

  if (counts['deal.underwrite.verify'] >= 1) {
    parts.push('Underwriting verification has run.');
    confidence += 0.10;
  }

  if (counts['checklist_reconciled'] >= 5) {
    confidence += 0.05;
  }

  // === Risk signals ===

  const manualOverrides = counts['manual_override'] ?? 0;
  if (manualOverrides >= 2) {
    signals.push('Multiple Manual Overrides');
    parts.push(`${manualOverrides} manual overrides logged — review banker intervention pattern.`);
    confidence -= 0.10;
  }

  const reviewFlags = counts['gatekeeper.needs_review.inline'] ?? 0;
  if (reviewFlags >= 1) {
    signals.push('Flagged for Review');
    parts.push('Deal was flagged for gatekeeper review.');
    confidence -= 0.10;
  }

  const intakeRetries = counts['deal.intake.retrying'] ?? 0;
  if (intakeRetries >= 3) {
    signals.push('Intake Instability');
    parts.push(`Intake pipeline retried ${intakeRetries} times — document quality may be low.`);
    confidence -= 0.08;
  }

  const readinessRecomputes = counts['readiness_recomputed'] ?? 0;
  if (readinessRecomputes >= 1) {
    // Check if readiness is high or low from most recent payload
    const latestReadiness = events.find(e => e.event_type === 'readiness_recomputed');
    const score = latestReadiness?.payload?.readiness_score;
    if (typeof score === 'number') {
      if (score >= 0.8) {
        parts.push(`Deal readiness is strong (${Math.round(score * 100)}%).`);
        confidence += 0.08;
      } else if (score < 0.5) {
        signals.push('Low Readiness Score');
        parts.push(`Deal readiness is low (${Math.round(score * 100)}%).`);
        confidence -= 0.08;
      }
    }
  }

  // === Lifecycle context ===

  const lifecycleEvent = events.find(e => e.event_type === 'deal.lifecycle.advanced');
  if (lifecycleEvent?.payload?.to) {
    parts.push(`Current lifecycle stage: ${lifecycleEvent.payload.to}.`);
  }

  // === Build advisory text ===

  const eventCount = events.length;
  const ageHours = events.length > 0
    ? Math.round((Date.now() - new Date(events[events.length - 1].created_at).getTime()) / 3600000)
    : null;

  const header = signals.length > 0
    ? `Omega is watching ${signals.length} signal${signals.length > 1 ? 's' : ''} on this deal.`
    : `Omega has observed ${eventCount} events on this deal with no critical flags.`;

  const body = parts.length > 0 ? parts.join(' ') : 'Pipeline activity looks normal.';

  const footer = ageHours !== null && ageHours > 72
    ? ` Earliest event is ${ageHours}h old — consider whether historical context remains relevant.`
    : '';

  const recommendation = `${header} ${body}${footer}`.trim();

  // Clamp confidence to [0, 1]
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    recommendation,
    signals,
    confidence,
    event_count: eventCount,
    stale: false,
    generated_at: new Date().toISOString(),
  };
}
```

---

## Step 4 — `evaluateConfidence(params)` implementation

Buddy sends:
```json
{
  "entity_uri": "omega://entity/underwriting_case/ffcc9733-...",
  "constraint_namespaces": ["buddy/underwriting", "buddy/model_governance"]
}
```

Extract the deal ID from the entity URI and delegate to `synthesizeAdvisory`:

```javascript
async function evaluateConfidence(params) {
  const entityUri = params?.entity_uri ?? '';

  // Extract dealId from URI
  const match = entityUri.match(/underwriting_case\/([a-f0-9-]{36})/);
  if (!match) {
    return { confidence: 0.5, recommendation: 'proceed', explanation: 'Entity URI not recognized.' };
  }

  const dealId = match[1];
  const state = await getUnderwritingCaseState(dealId, {});

  // Map advisory to proceed/clarify/block recommendation
  const recommendation =
    state.confidence >= 0.7 ? 'proceed' :
    state.confidence >= 0.4 ? 'clarify' :
    'block';

  return {
    confidence: state.confidence,
    recommendation,
    explanation: state.recommendation,
  };
}
```

---

## Step 5 — `getTraces(sessionId)` implementation

For now, return an empty trace list. This is only used in builder/debug mode.

```javascript
async function getTraces(sessionId, params) {
  // Phase 1: return empty — no trace store implemented yet
  return [];
}
```

This will cause `traceRef` to be null in the Buddy surface (expected behavior).

---

## Response field reference (what Buddy extracts)

Buddy's `OmegaAdvisoryAdapter.ts` extracts these fields from the state response.
Your response must include at minimum `recommendation` and `signals`:

```
result.recommendation  → string  → advisory text shown in cockpit panel
result.signals         → string[] → risk signal chips shown in cockpit panel
result.confidence      → number 0.0–1.0 → confidence badge (0-100 after normalization)
```

Buddy's confidence evaluation extracts:
```
result.confidence      → number 0.0–1.0
result.recommendation  → "proceed" | "clarify" | "block"
result.explanation     → string (optional)
```

**Important:** Return `confidence` as a decimal `0.0–1.0`, not a percentage.
Buddy's adapter normalizes: if value is ≤ 1.0, it multiplies by 100 for display.

---

## Env vars (already set on Cloud Run)

| Var | Purpose |
|---|---|
| `PULSE_MCP_API_KEY` | Bearer token for `/mcp` auth — must equal `OMEGA_MCP_API_KEY` in Vercel |
| `SUPABASE_URL` | Pulse Supabase project URL for querying `buddy_ledger_events` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for Supabase queries |

---

## Acceptance Criteria

- [ ] `POST /mcp` returns 401 with wrong token, 400 with malformed JSON-RPC
- [ ] `POST /mcp` with method `omega://state/underwriting_case/{any-uuid}` that has no events returns `{ result: { recommendation: "...", signals: [], confidence: 0.0, stale: true } }`
- [ ] `POST /mcp` with method `omega://state/underwriting_case/ffcc9733-f866-47fc-83f9-7c08403cea71` returns `stale: false` and non-empty `recommendation` (Samaritus has events in the ledger)
- [ ] `POST /mcp` with method `omega://confidence/evaluate` and a Samaritus entity URI returns `{ confidence, recommendation: "proceed"|"clarify"|"block", explanation }`
- [ ] `POST /mcp` with unknown method returns JSON-RPC error `-32601`
- [ ] Response time under 3 seconds for a deal with 200 events (Supabase query is indexed on `deal_id`)
- [ ] Cloud Run logs show `/mcp` requests appearing (verify via `gcloud logging read`)

**Verification curl (use real PULSE_MCP_API_KEY value):**
```bash
curl -s -X POST \
  https://pulse-mcp-651478110010.us-central1.run.app/mcp \
  -H "Authorization: Bearer YOUR_PULSE_MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "test-1",
    "method": "omega://state/underwriting_case/ffcc9733-f866-47fc-83f9-7c08403cea71",
    "params": {}
  }' | jq .
```

Expected:
```json
{
  "jsonrpc": "2.0",
  "id": "test-1",
  "result": {
    "recommendation": "...",
    "signals": [...],
    "confidence": 0.65,
    "event_count": 47,
    "stale": false
  }
}
```

Once this curl returns the expected shape, the Buddy cockpit will automatically
switch from the local `ai_risk_runs` fallback to live Omega data — no further
Buddy changes required.

---

## End-to-end flow after implementation

```
Banker opens deal
  → Buddy calls GET /api/deals/{dealId}/state
    → getBuddyCanonicalState() — Buddy DB
    → getOmegaAdvisoryState() — calls Pulse /mcp
        → POST /mcp { method: "omega://state/underwriting_case/{dealId}" }
        → Pulse queries buddy_ledger_events WHERE deal_id = {dealId}
        → Pulse synthesizes advisory from event patterns
        → Returns { recommendation, signals, confidence }
    → State route returns { state, omega, explanation, omegaExplanation, nextActions }
  → Cockpit renders OmegaAdvisoryPanel with omega.advisory + omega.riskEmphasis
  → Banker sees: canonical facts (Buddy) + Omega reasoning (Pulse) unified in one view
```

Buddy never sends financial data to Pulse. Pulse reasons from event patterns only.
The credit decision authority stays entirely with Buddy and the banker.
