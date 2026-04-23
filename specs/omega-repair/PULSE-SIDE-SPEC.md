# Spec OMEGA-REPAIR — Pulse-Side Companion (Deal-Scoped Advisory Tools)

**Date:** 2026-04-23
**Sibling to:** `specs/omega-repair/SPEC.md` (Buddy-side)
**Repo this applies to:** `29xh24fm6r-ctrl/PulseMasterrepo` (the deployed Pulse MCP)
**Executor:** Matt (or a Pulse-side agent with PulseMasterrepo write access)
**Estimated effort:** 1–2 days of Pulse-side design + implementation + deploy
**Blocks:** Buddy's follow-up PR to lift the read kill-switch

---

## Why this exists

Buddy's cockpit needs deal-scoped advisory reads — "what does Pulse think about deal X?" The currently deployed Pulse MCP exposes only user-scoped read tools (`state_inspect`, `state_confidence`, `observer_query`) which cannot answer that question. This spec captures the three purpose-built tools that Pulse needs to expose so Buddy's read path can work as designed.

Buddy-side rev 3 repair (companion spec) kill-switches the read path with explicit `pulse_advisory_tools_not_yet_available` error until these tools ship.

## Three new Pulse tools required

### `buddy_advisory_for_deal`

**Purpose:** return Pulse's synthesized advisory for a specific Buddy deal — the text that renders in `OmegaAdvisoryPanel`.

**Proposed input schema:**
```ts
{
  deal_id: z.string().min(1),              // Buddy deal UUID
  target_user_id: z.string().min(10).optional(),  // optional; server injects default
}
```

**Proposed output shape (inside `{summary, artifacts}` ToolResult envelope):**
```ts
artifacts: [{
  deal_id: string;
  advisory_text: string;                   // short natural-language advisory
  risk_emphasis: string[];                 // e.g., ["industry cyclicality", "guarantor concentration"]
  last_analyzed_at: string | null;         // ISO timestamp; null if Pulse has not analyzed this deal
  source_events_count: number;             // how many buddy_ledger_events informed this advisory
}]
```

**Implementation sketch:** query `buddy_ledger_events` where `deal_id = ?`, aggregate/synthesize into advisory text. Behavior when no events exist for the deal: return `{artifacts: [{advisory_text: "", risk_emphasis: [], last_analyzed_at: null, source_events_count: 0}]}` — do NOT throw.

### `buddy_confidence_for_deal`

**Purpose:** return Pulse's confidence score for a specific deal — drives `OmegaConfidenceBadge`.

**Proposed input schema:**
```ts
{
  deal_id: z.string().min(1),
  target_user_id: z.string().min(10).optional(),
}
```

**Proposed output:**
```ts
artifacts: [{
  deal_id: string;
  confidence: number;                      // 0-100 integer, -1 if unanalyzed
  basis: "events" | "synthesis" | "none";  // what the score is based on
  last_calibrated_at: string | null;
}]
```

### `buddy_traces_for_deal`

**Purpose:** return Pulse's reasoning traces for a specific deal — drives `OmegaTraceDrawer` in builder mode.

**Proposed input schema:**
```ts
{
  deal_id: z.string().min(1),
  target_user_id: z.string().min(10).optional(),
  limit: z.number().int().min(1).max(200).default(50),
}
```

**Proposed output:**
```ts
artifacts: Array<{
  trace_id: string;
  deal_id: string;
  event_type: string;
  summary: string;
  evidence: Record<string, unknown>;
  created_at: string;
}>
```

## Implementation notes

### Where to place the files

```
PulseMasterrepo/
└── services/
    └── pulse-mcp/
        └── src/
            └── tools/
                └── buddy/
                    ├── advisory_for_deal.ts    (new)
                    ├── confidence_for_deal.ts  (new)
                    ├── traces_for_deal.ts      (new)
                    └── (existing ledger.ts, which is fine as-is)
```

Register each in `services/pulse-mcp/src/tools/index.ts`. Note: the in-repo `tools/index.ts` currently registers 9 `pulse.*` tools but the deployed service exposes 40 tools. The registration path for new tools must follow whatever pattern the deployed service actually uses — if `tools/index.ts` is stale, find the real registration file in the live deployment config (Dockerfile entrypoint, env, or wherever the 40-tool list is actually assembled).

### Auth and authz

- Auth: same `x-pulse-mcp-key` pattern as existing tools. No new secret needed.
- Authz: each tool should call `assertViewerCanReadTarget(target_user_id)` from `auth.ts` before returning deal data. Single-tenant setup today (viewer === target); future multi-tenant work would extend `pulse_mcp_viewers` table.

### Data source

`buddy_ledger_events` in Pulse's own Postgres — the table populated by Buddy's outbox via `buddy_ledger_write` calls. Per Phase 2 findings, the deployed service writes here; this is where the advisory synthesis reads from.

### Synthesis vs storage

Two valid architectures:

**A. On-demand synthesis.** Each call aggregates events from `buddy_ledger_events` and produces an advisory text in real time. Simpler but latency-bound by event volume.

**B. Precomputed cache.** A worker synthesizes advisory per deal on ingest, stores in a `buddy_deal_advisory` table, tools just read. Faster but needs a background job.

Recommendation: start with A (on-demand) for the three tools. Measure latency. Move to B if p95 latency exceeds ~500ms at realistic event volumes.

## Buddy follow-up work

After Pulse ships these three tools, the Buddy-side follow-up PR is minimal:

1. In `src/lib/omega/invokeOmega.ts`, update `translateResourceToToolCall` to map:
   - `omega://state/underwriting_case/{dealId}` → `buddy_advisory_for_deal({deal_id: dealId, target_user_id})`
   - `omega://confidence/evaluate` → `buddy_confidence_for_deal({deal_id: ?, target_user_id})` — note: payload must now include `deal_id`; upstream caller needs to pass it
   - `omega://traces/{dealId}` → `buddy_traces_for_deal({deal_id: dealId, target_user_id})`
2. Update `OmegaAdvisoryAdapter.ts` to read the new response shapes (`artifacts[0].advisory_text`, `artifacts[0].confidence`, etc.).
3. Remove the kill-switch error path (`pulse_advisory_tools_not_yet_available`).
4. Update tests to reflect the new happy paths.

Estimated: 30 minutes to 1 hour of Buddy-side work once the Pulse tools are live.

## Verification once deployed

After Pulse ships:

```bash
curl -sS -X POST https://pulse-mcp-651478110010.us-central1.run.app/ \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"verify","method":"tools/list"}' | \
  jq '.result.tools[] | select(.name | startswith("buddy_")) | .name'
```

Expected: the list includes `buddy_advisory_for_deal`, `buddy_confidence_for_deal`, `buddy_traces_for_deal` alongside existing `buddy_ledger_*` tools.

Then probe each with a real deal ID from Buddy's test deal (`d65cc19e-b03e-4f2d-89ce-95ee69472cf3`) and confirm the output shape matches this spec's proposal.

## Non-goals of this spec

- **Not specifying the synthesis algorithm.** How Pulse converts events into advisory text is a Pulse-internal design choice.
- **Not specifying cross-tenant read access.** Single-tenant for now; multi-tenant is future work via `pulse_mcp_viewers`.
- **Not specifying eventing/webhooks.** Pulse-as-driver architectural rethink is a separate future spec; this spec keeps the request-response model.

## Open questions for Matt

1. Is the on-demand vs precomputed-cache choice (A vs B above) obvious from Pulse's existing architecture? If Pulse already has a compute pipeline for user-scoped advisory, the deal-scoped variant might slot in cleanly.
2. Does `last_analyzed_at` need to distinguish "never analyzed" from "analyzed but nothing found"? The spec currently uses `null` for the former; the latter would be a timestamp with empty advisory.
3. Should `confidence` return `-1` for unanalyzed deals or `null`? Current Buddy adapter expects `-1` sentinel; changing to `null` would require adapter work.

No blocker — answer during implementation.
