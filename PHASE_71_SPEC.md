# Phase 71 — Agent Identity Layer, Extraction Evolution Loop, Outbox Drain

**Date:** April 2026
**Status:** Spec — ready for implementation

---

## What this phase builds

Three independent improvements — each additive, none breaking existing infrastructure:

**71A — Agent Identity Layer** (from OpenClaw SOUL.md/SKILL.md pattern)
Markdown files that give each Buddy agent a formal identity and capability declaration.
Zero code changes. Pure documentation. Immediate OCC SR 11-7 model risk audit value.

**71B — Extraction Evolution Loop** (from JiuwenClaw evolutions.json pattern)
Analyst corrections already flow into `extraction_correction_log` via `correctionLogger.ts`.
This phase closes the loop: corrections become pending evolution entries that a super-admin
reviews and approves before they solidify into extraction prompt templates.
Human-in-the-loop approval is mandatory — this is a regulated system, not a personal assistant.

**71C — Outbox Drain Worker**
1,061 events in `buddy_outbox_events` (checklist_reconciled, readiness_recomputed,
artifact_processed, manual_override) have no drain path to Pulse. The `processIntakeOutbox`
worker handles `intake.process` events only. These pipeline notification events need their
own drain worker.

---

## What NOT to touch

```
src/lib/learningLoop/correctionLogger.ts     ← extend, do not rewrite
src/lib/learningLoop/patternAnalyzer.ts      ← do not modify
src/lib/learningLoop/patternReporter.ts      ← do not modify
src/lib/extraction/geminiFlashPrompts.ts     ← do not modify (evolution approval writes here)
src/lib/workers/processIntakeOutbox.ts       ← do not modify
src/app/api/workers/intake-outbox/route.ts   ← do not modify
src/lib/pulse/forwardLedgerCore.ts           ← do not modify
```

---

## Pre-work verification (run before writing any code, log all in AAR)

```sql
-- 1. Confirm outbox event kinds stuck undelivered
SELECT kind, COUNT(*) as count, MIN(created_at) as oldest
FROM buddy_outbox_events
WHERE delivered_at IS NULL
  AND dead_lettered_at IS NULL
GROUP BY kind
ORDER BY count DESC;

-- 2. Confirm extraction_correction_log has data
SELECT document_type, fact_key, COUNT(*) as corrections
FROM extraction_correction_log
GROUP BY document_type, fact_key
ORDER BY corrections DESC
LIMIT 20;

-- 3. Confirm agent_skill_evolutions table does NOT exist yet
SELECT table_name FROM information_schema.tables
WHERE table_name = 'agent_skill_evolutions';
```

---

## STEP 71A — Agent Identity Files

Create the following directory structure. These are pure markdown files — no code.

### Directory structure

```
src/agents/
  extraction/
    SOUL.md
    SKILL.md
  reconciliation/
    SOUL.md
    SKILL.md
  research/
    SOUL.md
    SKILL.md
  underwriting/
    SOUL.md
    SKILL.md
  voice/
    SOUL.md
    SKILL.md
```

---

### `src/agents/extraction/SOUL.md`

```markdown
# Buddy Extraction Agent

## Identity
I am the Extraction Agent within Buddy The Underwriter. My purpose is to read
financial documents — business tax returns (1065, 1120S, 1120), personal tax
returns (1040), balance sheets, income statements, and rent rolls — and extract
structured financial facts with verifiable accuracy.

## Core responsibility
I extract the numbers that reach a credit committee. Every number I produce must
be traceable to a specific line on a specific document. I do not infer. I do not
interpolate. I extract what is explicitly stated, or I return null.

## Governing constraints
- I am subject to OCC SR 11-7 model risk management standards
- All extraction outputs are advisory data fed into deterministic validators
- Human analysts have final authority on any extracted value
- Analyst corrections are captured in extraction_correction_log
- Personal tax return documents always use the deterministic extractor path

## Extraction stack
1. OCR via Gemini Vision (Vertex AI / GCP ADC)
2. Structured assist via Gemini Flash (geminiFlashStructuredAssist.ts)
3. IRS identity validation (irsKnowledge/)
4. Post-extraction validator (postExtractionValidator.ts)
5. Fact write to deal_financial_facts via upsertDealFinancialFact

## What I never do
- I never invent values for missing lines
- I never bypass the IRS knowledge base validation
- I never write directly to credit decision tables
- I never run on personal tax returns via the LLM primary path
```

---

### `src/agents/extraction/SKILL.md`

```markdown
---
name: buddy-extraction
version: 1.0.0
author: buddy-system
description: Extract structured financial facts from classified financial documents
tags: [extraction, tax-returns, balance-sheet, financial-facts]
allowed_tools: [gemini_ocr, gemini_flash_structured_assist, irs_knowledge_base]
---

# Extraction Skill

## Trigger
Called after document classification confirms a financial document type.
Entry point: `extractFactsFromDocument()` in src/lib/financialSpreads/extractFactsFromDocument.ts

## Inputs
- dealId: UUID
- bankId: UUID
- documentId: UUID
- docTypeHint: string (e.g. IRS_1065, IRS_1120S, BALANCE_SHEET)

## Outputs
Writes to: `deal_financial_facts` (fact_type, fact_key, fact_value_num, confidence, provenance)
Writes to: `deal_extraction_runs` (run record, status, metrics)

## Document type → canonical fact key mapping
| Document | Key facts produced |
|---|---|
| IRS_1065 | GROSS_RECEIPTS, ORDINARY_BUSINESS_INCOME, TOTAL_ASSETS (SL_), K1_ORDINARY_INCOME |
| IRS_1120S | GROSS_RECEIPTS, ORDINARY_BUSINESS_INCOME, TOTAL_ASSETS (SL_) |
| IRS_1040 | AGI, WAGES_W2, K1_ORDINARY_INCOME, SCH_E_NET |
| BALANCE_SHEET | TOTAL_ASSETS, TOTAL_LIABILITIES, NET_WORTH |
| INCOME_STATEMENT | TOTAL_REVENUE, NET_INCOME, EBITDA |

## Error handling
All failures return { ok: false, error } — never throw.
Failed extractions write to deal_extraction_runs with status='failed'.
Stale running extractions (>10 min) are auto-failed on next run attempt.

## Evolution
Analyst corrections to extracted values are captured in extraction_correction_log.
Patterns with error rate > 5% are flagged for review.
Approved evolutions update PROMPT_VERSION in geminiFlashPrompts.ts.
```

---

### `src/agents/reconciliation/SOUL.md`

```markdown
# Buddy Reconciliation Agent

## Identity
I am the Reconciliation Agent within Buddy The Underwriter. I verify mathematical
and logical consistency across financial documents submitted for a deal.

## Core responsibility
I catch what extraction misses: inconsistencies between documents that individually
look correct but together reveal errors — K-1 income that doesn't match entity OBI,
balance sheets that don't balance, multi-year revenue trends that defy explanation.

## Governing constraints
- I am subject to OCC SR 11-7 model risk management standards
- My findings are deterministic — rule-based checks, not LLM judgment
- CONFLICTS (hard failures) block committee approve
- FLAGS (soft warnings) allow banker override with documented judgment
- I never decide on creditworthiness — I surface data integrity issues for humans

## Check inventory
1. K1_TO_ENTITY — K-1 allocated income vs entity OBI
2. BALANCE_SHEET — Assets = Liabilities + Equity
3. MULTI_YEAR_TREND — Revenue trend reasonableness
4. OWNERSHIP_INTEGRITY — K-1 ownership percentages sum to ≤ 100%

## What I never do
- I never approve or decline a deal
- I never modify canonical state
- I never run LLM inference on financial numbers
```

---

### `src/agents/reconciliation/SKILL.md`

```markdown
---
name: buddy-reconciliation
version: 1.0.0
author: buddy-system
description: Cross-document mathematical consistency checks for commercial lending deals
tags: [reconciliation, balance-sheet, k1, cross-document]
allowed_tools: [supabase_read]
---

# Reconciliation Skill

## Trigger
Called after underwriting state is loaded, or on demand via POST /api/deals/[dealId]/reconcile.
Entry point: `reconcileDeal()` in src/lib/reconciliation/dealReconciliator.ts

## Inputs
- dealId: UUID
- industryProfile?: IndustryProfile (optional NAICS-calibrated thresholds)

## Outputs
Writes to: `deal_reconciliation_results` (overall_status, hard_failures, soft_flags)
Emits: deal.reconciliation_complete ledger event

## Status values
- CLEAN: all checks passed or skipped (no failures)
- FLAGS: soft warnings present (banker judgment allows approve)
- CONFLICTS: hard failures present (blocks approve until resolved)

## Fact key fallback chains
The reconciliator reads from deal_financial_facts with these fallbacks:
- TOTAL_ASSETS → SL_TOTAL_ASSETS
- TOTAL_LIABILITIES → SL_TOTAL_LIABILITIES
- NET_WORTH → TOTAL_EQUITY → SL_TOTAL_EQUITY

## Check skip conditions
A check is SKIPPED (not FAILED) when prerequisite facts are absent.
checksSkipped > 0 is normal for deals with incomplete Schedule L extraction.
```

---

### `src/agents/research/SOUL.md`

```markdown
# Buddy Intelligence Engine (BIE)

## Identity
I am the Research Agent (Buddy Intelligence Engine) within Buddy The Underwriter.
I research the borrower, their industry, and the risk context of a deal to produce
credit-quality narrative that supports the underwriter's judgment.

## Core responsibility
I run seven research threads in parallel — company background, management qualifications,
industry analysis, market position, SBA eligibility (where applicable), risk signal
identification, and lender fit assessment — to produce content that feeds the credit memo.

## Governing constraints
- I am subject to OCC SR 11-7 model risk management standards
- I use Google Search grounding for factual claims — never fabricate citations
- I am non-fatal by design: any thread failure returns null, mission continues
- I produce narrative for human review — I do not produce credit decisions
- Fair lending enforcement is structural: my prompts prohibit subjective assessments

## What I never do
- I never produce a credit approval or denial recommendation
- I never assess personal characteristics of individual borrowers
- I never run without research completing before credit memo generation
```

---

### `src/agents/research/SKILL.md`

```markdown
---
name: buddy-bie
version: 1.0.0
author: buddy-system
description: 7-thread research engine producing credit-quality borrower and industry narrative
tags: [research, bie, narrative, credit-memo]
allowed_tools: [gemini_pro_google_search_grounding]
---

# Research Skill

## Trigger
Called as part of the research pipeline, gated on deal readiness.
Entry point: runMission() in src/lib/research/runMission.ts
Model: gemini-3.1-pro-preview with Google Search grounding

## Thread inventory
1. Company background and history
2. Management qualifications
3. Industry analysis (NAICS-calibrated)
4. Market position and competitive landscape
5. SBA program eligibility analysis (SBA deals only)
6. Risk signal identification
7. Lender fit assessment

## Outputs
Writes to: buddy_research_narratives (version 3, sections JSONB array)
Writes to: buddy_research_missions (status: complete)
Feeds into: buildCanonicalCreditMemo via loadResearchForMemo

## Critical constraints
- Never use responseMimeType: "application/json" with Google Search grounding
- BIE requires hasCompany || hasNaics to fire
- Sections stored per-sentence, never concatenated blobs
```

---

### `src/agents/underwriting/SOUL.md`

```markdown
# Buddy Underwriting Agent

## Identity
I am the Underwriting Agent within Buddy The Underwriter. I compute the financial
spreads, DSCR, ADS, cash flow available, and risk grade that form the quantitative
backbone of a commercial lending credit decision.

## Core responsibility
I transform extracted financial facts into the numbers a banker needs to make a
credit judgment: is this borrower's cash flow sufficient to service the proposed
debt? What is the risk-adjusted price? What does the balance sheet look like?

## Governing constraints
- I am subject to OCC SR 11-7 model risk management standards
- All formulas route through evaluateMetric() — no inline math in templates
- DSCR and ADS persist to deal_financial_facts after every spread generation
- DSCR reads from deal_structural_pricing, not deal_financial_facts
- Spread completeness never gates lifecycle advancement (informational only)
- Humans retain final credit judgment authority

## What I never do
- I never approve or decline a deal
- I never use LLM inference in the critical DSCR calculation path
- I never bypass the reconciliation gate before committee
```

---

### `src/agents/underwriting/SKILL.md`

```markdown
---
name: buddy-underwriting
version: 1.0.0
author: buddy-system
description: Financial spreads, DSCR computation, ADS, global cash flow, and risk grade
tags: [spreads, dscr, underwriting, financial-model]
allowed_tools: [supabase_read, supabase_write, gemini_flash_narrative]
---

# Underwriting Skill

## Primary surfaces
- AnalystWorkbench at /deals/[dealId]/underwrite
- Classic spread PDF (MMAS format, PDFKit)
- Structure tab at /deals/[dealId]/structure

## Spread type inventory
GLOBAL_CASH_FLOW, BALANCE_SHEET, PERSONAL_INCOME, PERSONAL_FINANCIAL_STATEMENT,
T12, RENT_ROLL

## Key output facts
CASH_FLOW_AVAILABLE, ANNUAL_DEBT_SERVICE, DSCR, DSCR_STRESSED_300BPS,
EXCESS_CASH_FLOW, TOTAL_ASSETS, TOTAL_LIABILITIES, NET_WORTH

## Entry points
- runSpreadsWorkerTick() — scheduled via Vercel cron every 2 min
- enqueueSpreadRecompute() — triggered after extraction completes
```

---

### `src/agents/voice/SOUL.md`

```markdown
# Buddy Voice Interview Agent

## Identity
I am the Voice Interview Agent within Buddy The Underwriter. I conduct structured
voice interviews with bankers to resolve deal gaps, confirm financial facts, and
capture qualitative underwriting context.

## Core responsibility
I listen to bankers describe their deals, extract structured facts from the
conversation, and resolve items in the deal gap queue — reducing the time it
takes to complete a credit package from weeks to a single voice session.

## Governing constraints
- I am subject to OCC SR 11-7 model risk management standards
- Fair lending: I never assess personal characteristics, I extract objective facts
- Proxy token TTL: 180 seconds, stored in deal_voice_sessions
- All extracted facts use source_type: MANUAL, confidence: 1.00, resolution_status: confirmed
- My system instruction prohibits subjective content — enforced at prompt level

## What I never do
- I never make credit decisions
- I never access or transmit full SSNs
- I never store audio beyond the session TTL
```

---

### `src/agents/voice/SKILL.md`

```markdown
---
name: buddy-voice
version: 1.0.0
author: buddy-system
description: Gemini Live voice interview gateway for deal gap resolution
tags: [voice, gemini-live, gap-resolution, interview]
allowed_tools: [gemini_live_audio, deal_gap_queue, deal_financial_facts]
---

# Voice Skill

## Architecture
Browser → POST /api/deals/[dealId]/banker-session/gemini-token
         ← { proxyToken, sessionId }
Browser → WebSocket wss://pulse-voice-gateway.fly.dev/gemini-live
Gateway → validates token against Supabase deal_voice_sessions
Gateway → opens upstream to Vertex AI Gemini Live (bidirectional relay)
Gateway → tool calls intercepted → POST /api/deals/[dealId]/banker-session/dispatch
Dispatch → resolveDealGap() → deal_financial_facts (confirmed)
         → deal_events ledger entry (voice.fact_confirmed)

## Model
gemini-live-2.5-flash-native-audio via Vertex AI (GCP service account OAuth2)

## Gateway
Fly.io: pulse-voice-gateway, shared-cpu-1x, 512mb, min_machines_running=1
Secret: BUDDY_GATEWAY_SECRET shared between Fly.io and Vercel
```

---

## STEP 71B — Extraction Evolution Loop

### DB Migration

Create migration file: `supabase/migrations/<timestamp>_add_agent_skill_evolutions.sql`

```sql
-- Agent skill evolution staging table
-- Pending evolutions from analyst corrections, awaiting human approval
-- before any prompt template is modified.
CREATE TABLE IF NOT EXISTS agent_skill_evolutions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     TEXT NOT NULL,          -- e.g. 'extraction', 'reconciliation'
  fact_key     TEXT NOT NULL,          -- which fact key triggered this
  document_type TEXT NOT NULL,         -- which doc type
  source       TEXT NOT NULL CHECK (source IN ('analyst_correction', 'pattern_threshold')),
  context      TEXT NOT NULL,          -- human-readable description of the issue
  proposed_change JSONB NOT NULL,      -- { section, action, content }
  applied      BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by  TEXT,                   -- analyst_id who approved
  approved_at  TIMESTAMPTZ,
  rejected     BOOLEAN NOT NULL DEFAULT FALSE,
  rejected_by  TEXT,
  rejected_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_skill_evolutions_agent ON agent_skill_evolutions(agent_id);
CREATE INDEX idx_agent_skill_evolutions_applied ON agent_skill_evolutions(applied);
CREATE INDEX idx_agent_skill_evolutions_pending
  ON agent_skill_evolutions(agent_id)
  WHERE applied = FALSE AND rejected = FALSE;

ALTER TABLE agent_skill_evolutions ENABLE ROW LEVEL SECURITY;
-- Super admin only — no banker access
CREATE POLICY "super_admin_only" ON agent_skill_evolutions
  FOR ALL USING (FALSE);
```

---

### New file: `src/lib/learningLoop/evolutionStager.ts`

Called by `correctionLogger.ts` after logging a correction.
Determines if the correction should generate a pending evolution entry.

```typescript
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CorrectionEvent } from "./types";

// Error rate threshold above which we generate an evolution entry
const EVOLUTION_THRESHOLD = 0.05; // 5%
// Minimum corrections before we consider it a pattern
const MIN_CORRECTIONS_FOR_PATTERN = 3;

/**
 * Stage a potential skill evolution based on an analyst correction.
 *
 * Checks if the correction matches a known pattern (error rate > threshold).
 * If so, inserts a pending evolution entry in agent_skill_evolutions.
 *
 * This is fire-and-forget — never throws, never blocks correction logging.
 * A super-admin must approve the evolution before anything changes.
 */
export async function stageEvolutionIfNeeded(
  event: Omit<CorrectionEvent, "id">
): Promise<void> {
  try {
    const sb = supabaseAdmin();

    // Count corrections for this fact_key + document_type combination
    const { count: correctionCount } = await sb
      .from("extraction_correction_log")
      .select("id", { count: "exact", head: true })
      .eq("document_type", event.documentType)
      .eq("fact_key", event.factKey);

    if (!correctionCount || correctionCount < MIN_CORRECTIONS_FOR_PATTERN) {
      return; // Not enough data to suggest a pattern
    }

    // Count total extractions for this combination
    const { count: extractionCount } = await sb
      .from("deal_financial_facts")
      .select("id", { count: "exact", head: true })
      .eq("fact_key", event.factKey);

    const errorRate =
      extractionCount && extractionCount > 0
        ? correctionCount / extractionCount
        : 0;

    if (errorRate < EVOLUTION_THRESHOLD) {
      return; // Below threshold — no evolution needed yet
    }

    // Check if an evolution for this fact_key + doc_type already pending
    const { data: existing } = await sb
      .from("agent_skill_evolutions")
      .select("id")
      .eq("agent_id", "extraction")
      .eq("fact_key", event.factKey)
      .eq("document_type", event.documentType)
      .eq("applied", false)
      .eq("rejected", false)
      .maybeSingle();

    if (existing) {
      return; // Already a pending evolution for this combination
    }

    const delta =
      event.originalValue !== null && event.correctedValue !== null
        ? Math.abs(event.correctedValue - event.originalValue)
        : null;

    const context =
      `Fact key "${event.factKey}" in ${event.documentType} documents has ` +
      `${correctionCount} corrections (error rate: ${(errorRate * 100).toFixed(1)}%). ` +
      `Latest correction: ${event.originalValue} → ${event.correctedValue}` +
      (delta !== null ? ` (delta: ${delta.toLocaleString()})` : "") +
      `. Review prompt template for this field.`;

    await sb.from("agent_skill_evolutions").insert({
      agent_id: "extraction",
      fact_key: event.factKey,
      document_type: event.documentType,
      source: "analyst_correction",
      context,
      proposed_change: {
        section: "Extraction Notes",
        action: "append",
        content:
          `## Known Issue — ${event.factKey} in ${event.documentType}\n` +
          `- Error rate: ${(errorRate * 100).toFixed(1)}% (${correctionCount} corrections)\n` +
          `- Typical delta: ${delta !== null ? delta.toLocaleString() : "varies"}\n` +
          `- Action: review line number mapping and extraction prompt for this field`,
      },
    });
  } catch {
    // Never throw — evolution staging must never block correction logging
  }
}
```

---

### Extend `src/lib/learningLoop/correctionLogger.ts`

Add a call to `stageEvolutionIfNeeded` at the end of `logCorrection`.
Find the final line of the try block and add after the `writeEvent` call:

```typescript
// After the existing writeEvent call, add:

// Stage potential evolution if correction pattern warrants it (fire-and-forget)
stageEvolutionIfNeeded(event).catch(() => {});
```

Also add the import at the top of the file:
```typescript
import { stageEvolutionIfNeeded } from "./evolutionStager";
```

---

### New API route: `src/app/api/admin/agent-evolutions/route.ts`

Super-admin endpoint for reviewing and acting on pending evolutions.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — list pending evolutions
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin();
    const sb = supabaseAdmin();

    const url = new URL(req.url);
    const agentId = url.searchParams.get("agent_id");
    const includeDone = url.searchParams.get("include_done") === "true";

    let query = sb
      .from("agent_skill_evolutions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (agentId) query = query.eq("agent_id", agentId);
    if (!includeDone) query = query.eq("applied", false).eq("rejected", false);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ ok: true, evolutions: data ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "internal" },
      { status: err?.message === "forbidden" ? 403 : 500 }
    );
  }
}

// POST — approve or reject a pending evolution
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin();
    const { userId } = await clerkAuth();
    const sb = supabaseAdmin();

    const body = await req.json();
    const { evolution_id, action } = body as {
      evolution_id: string;
      action: "approve" | "reject";
    };

    if (!evolution_id || !action) {
      return NextResponse.json(
        { ok: false, error: "evolution_id and action required" },
        { status: 400 }
      );
    }

    if (action === "approve") {
      await sb
        .from("agent_skill_evolutions")
        .update({
          applied: true,
          approved_by: userId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", evolution_id)
        .eq("applied", false)
        .eq("rejected", false);

      // Note: "applying" an evolution marks it approved in the DB.
      // The actual prompt template update is a manual developer step:
      // increment PROMPT_VERSION in geminiFlashPrompts.ts and add the
      // evolved content as a comment or instruction in the relevant prompt function.
      // This gate ensures no prompt changes happen without human approval.

      return NextResponse.json({
        ok: true,
        message:
          "Evolution approved. A developer must now increment PROMPT_VERSION " +
          "in geminiFlashPrompts.ts and incorporate the proposed_change content. " +
          "This is the required human-in-the-loop gate per OCC SR 11-7.",
      });
    }

    if (action === "reject") {
      await sb
        .from("agent_skill_evolutions")
        .update({
          rejected: true,
          rejected_by: userId,
          rejected_at: new Date().toISOString(),
        })
        .eq("id", evolution_id)
        .eq("applied", false)
        .eq("rejected", false);

      return NextResponse.json({ ok: true, message: "Evolution rejected." });
    }

    return NextResponse.json(
      { ok: false, error: "action must be approve or reject" },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "internal" },
      { status: err?.message === "forbidden" ? 403 : 500 }
    );
  }
}
```

---

## STEP 71C — Outbox Drain Worker

### New file: `src/lib/workers/processPulseOutbox.ts`

Drains non-intake events from `buddy_outbox_events` to Pulse.
Mirrors the pattern of `processIntakeOutbox` but for pipeline notification events.

```typescript
/**
 * Drain pipeline notification events from buddy_outbox_events to Pulse.
 *
 * Handles: checklist_reconciled, readiness_recomputed, artifact_processed,
 * manual_override, and any other non-intake outbox events.
 *
 * Uses the same claim/deliver pattern as processIntakeOutbox.
 * Never throws. Called by /api/workers/pulse-outbox (Vercel Cron, every 2 min).
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

// Event kinds handled by intake-outbox worker — skip these
const INTAKE_KINDS = new Set(["intake.process"]);

const DEAD_LETTER_THRESHOLD = 10;
const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_CAP_SECONDS = 3600;
const INGEST_TIMEOUT_MS = 5000;

export type PulseOutboxResult = {
  claimed: number;
  forwarded: number;
  failed: number;
  dead_lettered: number;
  skipped_disabled: boolean;
};

function backoffSeconds(attempts: number): number {
  return Math.min(
    Math.pow(2, attempts) * BACKOFF_BASE_SECONDS,
    BACKOFF_CAP_SECONDS
  );
}

export async function processPulseOutbox(
  maxRows = 50
): Promise<PulseOutboxResult> {
  // Kill switch — same pattern as forwardLedgerCore
  if (process.env.PULSE_TELEMETRY_ENABLED !== "true") {
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: true,
    };
  }

  const ingestUrl = process.env.PULSE_BUDDY_INGEST_URL;
  const ingestToken = process.env.PULSE_INGEST_TOKEN;
  if (!ingestUrl || !ingestToken) {
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: true,
    };
  }

  const sb = supabaseAdmin();
  const claimOwner = `pulse-outbox-${Date.now()}`;
  const now = new Date().toISOString();

  // Select unclaimed, undelivered, non-intake events
  const { data: candidates, error: selectErr } = await (sb as any)
    .from("buddy_outbox_events")
    .select("id, kind, deal_id, bank_id, payload, attempts")
    .is("delivered_at", null)
    .is("dead_lettered_at", null)
    .is("claimed_at", null)
    // Only process events that are ready (next_attempt_at is null or in the past)
    .or("next_attempt_at.is.null,next_attempt_at.lte." + now)
    .order("created_at", { ascending: true })
    .limit(maxRows);

  if (selectErr || !candidates || candidates.length === 0) {
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: false,
    };
  }

  // Filter out intake events
  const filtered = (candidates as any[]).filter(
    (r) => !INTAKE_KINDS.has(r.kind)
  );

  if (filtered.length === 0) {
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: false,
    };
  }

  // Claim atomically
  const claimed: any[] = [];
  for (const candidate of filtered) {
    const { data } = await (sb as any)
      .from("buddy_outbox_events")
      .update({ claimed_at: now, claim_owner: claimOwner })
      .eq("id", candidate.id)
      .is("claimed_at", null)
      .select("id, kind, deal_id, bank_id, payload, attempts")
      .maybeSingle();
    if (data) claimed.push(data);
  }

  if (claimed.length === 0) {
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: false,
    };
  }

  let forwarded = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of claimed) {
    const ingestPayload = {
      event_code: row.kind,
      deal_id: row.deal_id ?? null,
      bank_id: row.bank_id ?? null,
      actor_id: null,
      status: "success",
      payload: row.payload ?? {},
      emitted_at: new Date().toISOString(),
    };

    try {
      const res = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ingestToken}`,
        },
        body: JSON.stringify(ingestPayload),
        signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
      });

      if (res.ok) {
        await (sb as any)
          .from("buddy_outbox_events")
          .update({
            delivered_at: new Date().toISOString(),
            delivered_to: "pulse",
            claimed_at: null,
            claim_owner: null,
            last_error: null,
          })
          .eq("id", row.id);
        forwarded++;
      } else {
        const isDeadLetter = await markFailed(
          sb,
          row.id,
          `HTTP ${res.status}`,
          row.attempts
        );
        if (isDeadLetter) deadLettered++;
        failed++;
      }
    } catch (err: any) {
      const isDeadLetter = await markFailed(
        sb,
        row.id,
        err?.message?.slice(0, 200) ?? "unknown",
        row.attempts
      );
      if (isDeadLetter) deadLettered++;
      failed++;
    }
  }

  return {
    claimed: claimed.length,
    forwarded,
    failed,
    dead_lettered: deadLettered,
    skipped_disabled: false,
  };
}

async function markFailed(
  sb: ReturnType<typeof supabaseAdmin>,
  rowId: string,
  error: string,
  currentAttempts: number
): Promise<boolean> {
  const newAttempts = (currentAttempts ?? 0) + 1;
  const isDeadLetter = newAttempts >= DEAD_LETTER_THRESHOLD;

  const update: Record<string, unknown> = {
    attempts: newAttempts,
    last_error: error.slice(0, 500),
    claimed_at: null,
    claim_owner: null,
  };

  if (isDeadLetter) {
    update.dead_lettered_at = new Date().toISOString();
  } else {
    update.next_attempt_at = new Date(
      Date.now() + backoffSeconds(newAttempts) * 1000
    ).toISOString();
  }

  await (sb as any)
    .from("buddy_outbox_events")
    .update(update)
    .eq("id", rowId);

  return isDeadLetter;
}
```

---

### New route: `src/app/api/workers/pulse-outbox/route.ts`

```typescript
/**
 * GET /api/workers/pulse-outbox
 *
 * Vercel Cron entry point for draining pipeline notification events
 * from buddy_outbox_events to Pulse.
 *
 * Schedule: every 2 minutes (vercel.json cron — add below)
 * Auth: CRON_SECRET or WORKER_SECRET
 *
 * Handles: checklist_reconciled, readiness_recomputed, artifact_processed,
 * manual_override, and all other non-intake outbox events.
 *
 * Does NOT handle intake.process events (those go to /api/workers/intake-outbox).
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { processPulseOutbox } from "@/lib/workers/processPulseOutbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  console.log("[pulse-outbox] cron_invocation_seen", {
    ts: new Date().toISOString(),
    ua: req.headers.get("user-agent") ?? null,
  });

  if (!hasValidWorkerSecret(req)) {
    console.error("[pulse-outbox] auth_failed — check CRON_SECRET / WORKER_SECRET");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const max = Math.min(
      Number(req.nextUrl.searchParams.get("max") ?? "50"),
      200
    );

    const result = await processPulseOutbox(max);

    if (result.skipped_disabled) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "PULSE_TELEMETRY_ENABLED not set or ingest config missing",
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[pulse-outbox] worker error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unexpected_error" },
      { status: 500 }
    );
  }
}
```

---

### Update `vercel.json`

Add the new cron to the existing `crons` array:

```json
{
  "path": "/api/workers/pulse-outbox?max=50",
  "schedule": "*/2 * * * *"
}
```

The full updated `crons` array should be:
```json
"crons": [
  { "path": "/api/cron/borrower-reminders", "schedule": "0 14 * * *" },
  { "path": "/api/jobs/worker/tick?type=SPREADS&batch_size=3", "schedule": "*/2 * * * *" },
  { "path": "/api/artifacts/process?max=20", "schedule": "*/1 * * * *" },
  { "path": "/api/pulse/cron-forward-ledger?max=50", "schedule": "*/2 * * * *" },
  { "path": "/api/ops/observer/tick", "schedule": "*/5 * * * *" },
  { "path": "/api/workers/intake-outbox?max=10", "schedule": "*/1 * * * *" },
  { "path": "/api/workers/intake-recovery", "schedule": "*/3 * * * *" },
  { "path": "/api/workers/doc-extraction?max=5", "schedule": "*/1 * * * *" },
  { "path": "/api/workers/pulse-outbox?max=50", "schedule": "*/2 * * * *" }
]
```

---

## Acceptance Criteria

### 71A — Agent Identity Files
- [ ] `src/agents/` directory created with 5 agent subdirectories
- [ ] Each agent has SOUL.md and SKILL.md
- [ ] All 10 markdown files present: extraction, reconciliation, research, underwriting, voice
- [ ] SOUL.md files contain: identity, core responsibility, governing constraints, what agent never does
- [ ] SKILL.md files contain: YAML frontmatter with name/version/description/tags, trigger, inputs, outputs

### 71B — Extraction Evolution Loop
- [ ] Migration file created and applied (`agent_skill_evolutions` table exists)
- [ ] `src/lib/learningLoop/evolutionStager.ts` created
- [ ] `correctionLogger.ts` calls `stageEvolutionIfNeeded` (fire-and-forget, non-fatal)
- [ ] `src/app/api/admin/agent-evolutions/route.ts` GET and POST routes functional
- [ ] GET returns pending evolutions filtered by agent_id
- [ ] POST approve sets applied=true, approved_by, approved_at
- [ ] POST reject sets rejected=true, rejected_by, rejected_at
- [ ] Evolution staging only fires when error rate > 5% AND >= 3 corrections
- [ ] No duplicate pending evolutions for same fact_key + document_type
- [ ] `tsc --noEmit` clean

### 71C — Outbox Drain Worker
- [ ] `src/lib/workers/processPulseOutbox.ts` created
- [ ] `src/app/api/workers/pulse-outbox/route.ts` created
- [ ] Route returns `{ skipped: true }` when `PULSE_TELEMETRY_ENABLED !== "true"`
- [ ] `vercel.json` updated with new cron entry
- [ ] INTAKE_KINDS filter prevents double-processing intake.process events
- [ ] Dead letter threshold: 10 attempts (higher than intake worker's 5 — these are lower priority)
- [ ] `tsc --noEmit` clean

### Post-deploy verification (run after deployment, log in AAR)
```sql
-- Verify agent_skill_evolutions table exists
SELECT COUNT(*) FROM agent_skill_evolutions;

-- After ~10 minutes, verify outbox drain started
SELECT
  COUNT(*) FILTER (WHERE delivered_at IS NOT NULL AND delivered_to = 'pulse') as drained_to_pulse,
  COUNT(*) FILTER (WHERE delivered_at IS NULL AND dead_lettered_at IS NULL) as still_pending,
  MAX(delivered_at) as last_drained_at
FROM buddy_outbox_events
WHERE kind != 'intake.process';
```

---

## AAR format

1. Pre-work SQL results (paste actual output from all 3 queries)
2. Files created (path + line count)
3. Files modified (path + what changed)
4. Post-deploy verification SQL results (paste after 10 min)
5. `tsc --noEmit` result
6. Test pass count
7. Deviations from spec with rationale
