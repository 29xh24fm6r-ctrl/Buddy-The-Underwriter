# Phase 50 — Deal Truth Graph + Gap Resolution Engine
## Implementation Spec for Claude Code (Antigravity)

**Prepared by:** Claude (architectural review + schema reconciliation)
**Source concept:** ChatGPT architectural spec (Deal Truth Graph)
**Status:** Build-ready. Do not deviate from this spec without review.

---

## CRITICAL CONTEXT — READ BEFORE ANY CODE

The ChatGPT spec proposed building `deal_facts` as a new table. **Do not do this.**
`deal_financial_facts` already exists and is the canonical fact store. It already has:
- `fact_type`, `fact_key`, `fact_value_num`, `fact_value_text`
- `confidence`, `provenance jsonb`, `source_document_id`
- `owner_entity_id`, `is_superseded`, `reconciliation_status`, `drift_pct`
- `fact_identity_hash` — deterministic deduplication key
- `upsertDealFinancialFact()` in `src/lib/financialFacts/writeFact.ts`

`deal_events` already exists as the canonical ledger.
`writeEvent()` already exists in `src/lib/ledger/writeEvent.ts`.

**This phase extends the existing system. It does not replace or duplicate it.**

---

## WHAT THIS PHASE BUILDS

Three new database tables + one new column (additive only):
1. `resolution_status` column on `deal_financial_facts`
2. `deal_gap_queue` — persistent queue of what needs human attention
3. `deal_fact_conflicts` — cross-source value disagreements
4. `deal_transcript_uploads` — AI note ingestion (Otter, Fireflies, etc.)

Three new server functions:
1. `computeDealGaps()` — builds the gap queue from existing facts
2. `extractFactsFromTranscript()` — parses AI notes → fact candidates
3. `resolveDealGap()` — confirms/rejects a gap item, writes back

Two new API routes:
1. `GET /api/deals/[dealId]/gap-queue` — current gaps with priorities
2. `POST /api/deals/[dealId]/transcript-ingest` — upload + parse AI notes

One new UI component:
1. `DealHealthPanel.tsx` — "Resolve N Open Items" — completeness % + gap list

Voice/chat session wiring (minimal — session drives gap queue):
1. `POST /api/deals/[dealId]/banker-session/start` — creates realtime session with deal context injected into system prompt

---

## STEP 1 — DATABASE MIGRATIONS (ADDITIVE ONLY)

Run these in order. Never DROP or ALTER existing columns.

### Migration 1: resolution_status on deal_financial_facts

```sql
ALTER TABLE deal_financial_facts
  ADD COLUMN IF NOT EXISTS resolution_status text NOT NULL DEFAULT 'inferred';

-- Valid values:
-- 'inferred'          — extracted from document, not yet reviewed
-- 'needs_confirmation' — low confidence or flagged, awaiting banker review
-- 'confirmed'         — banker explicitly confirmed this value
-- 'rejected'          — banker rejected this value (superseded)
-- 'conflicting'       — multiple sources disagree

COMMENT ON COLUMN deal_financial_facts.resolution_status IS
  'Workflow state: inferred → needs_confirmation → confirmed | rejected | conflicting';
```

### Migration 2: deal_gap_queue

```sql
CREATE TABLE IF NOT EXISTS deal_gap_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id         uuid NOT NULL,

  gap_type        text NOT NULL,
  -- 'missing_fact'       — required fact_key not present at all
  -- 'low_confidence'     — fact exists but confidence < threshold
  -- 'conflict'           — multiple sources disagree on value
  -- 'needs_confirmation' — fact exists but resolution_status = needs_confirmation
  -- 'stale_fact'         — fact period_end older than 18 months

  fact_type       text NOT NULL,
  fact_key        text NOT NULL,
  owner_entity_id uuid,

  -- Link to the fact or conflict that created this gap
  fact_id         uuid REFERENCES deal_financial_facts(id) ON DELETE SET NULL,
  conflict_id     uuid, -- FK added after deal_fact_conflicts created

  -- Human-readable description surfaced in UI
  description     text NOT NULL,

  -- Suggested question to ask the banker
  resolution_prompt text,

  priority        integer NOT NULL DEFAULT 50,
  -- 90 = blocking (conflict, missing required fact)
  -- 70 = high (low confidence on critical metric)
  -- 50 = medium (standard missing fact)
  -- 30 = low (nice to have)

  status          text NOT NULL DEFAULT 'open',
  -- 'open'
  -- 'in_progress'
  -- 'resolved'
  -- 'dismissed'

  resolved_by     text,  -- clerk user_id
  resolved_at     timestamptz,
  resolution_meta jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (deal_id, fact_type, fact_key, gap_type, status)
  -- prevents duplicate open gaps for the same fact
);

ALTER TABLE deal_gap_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_rls" ON deal_gap_queue
  USING (bank_id = (SELECT bank_id FROM deals WHERE id = deal_id LIMIT 1));
```

### Migration 3: deal_fact_conflicts

```sql
CREATE TABLE IF NOT EXISTS deal_fact_conflicts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id             uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id             uuid NOT NULL,

  fact_type           text NOT NULL,
  fact_key            text NOT NULL,
  owner_entity_id     uuid,

  -- Array of conflicting source facts
  conflicting_fact_ids  uuid[] NOT NULL DEFAULT '{}',

  -- Snapshot of the conflicting values for display
  -- e.g. [{"source": "transcript", "value": 2100000}, {"source": "ade_document", "value": 2400000}]
  conflicting_values  jsonb NOT NULL DEFAULT '[]',

  status              text NOT NULL DEFAULT 'open',
  -- 'open'
  -- 'resolved'

  resolved_fact_id    uuid REFERENCES deal_financial_facts(id) ON DELETE SET NULL,
  resolved_by         text,
  resolved_at         timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deal_fact_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_rls" ON deal_fact_conflicts
  USING (bank_id = (SELECT bank_id FROM deals WHERE id = deal_id LIMIT 1));

-- Now backfill the FK on deal_gap_queue
ALTER TABLE deal_gap_queue
  ADD CONSTRAINT fk_gap_conflict
  FOREIGN KEY (conflict_id) REFERENCES deal_fact_conflicts(id) ON DELETE SET NULL;
```

### Migration 4: deal_transcript_uploads

```sql
CREATE TABLE IF NOT EXISTS deal_transcript_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id         uuid NOT NULL,

  uploaded_by     text NOT NULL,  -- clerk user_id
  source_label    text,           -- "Otter.ai", "Fireflies", "Manual notes", etc.
  raw_text        text NOT NULL,

  extraction_status text NOT NULL DEFAULT 'pending',
  -- 'pending'
  -- 'processing'
  -- 'complete'
  -- 'failed'

  -- Structured candidates extracted from the transcript
  -- Array of { fact_type, fact_key, value, confidence, snippet }
  extracted_candidates jsonb NOT NULL DEFAULT '[]',

  -- How many candidates were confirmed by the banker
  confirmed_count integer NOT NULL DEFAULT 0,
  rejected_count  integer NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

ALTER TABLE deal_transcript_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_rls" ON deal_transcript_uploads
  USING (bank_id = (SELECT bank_id FROM deals WHERE id = deal_id LIMIT 1));
```

---

## STEP 2 — SERVER FUNCTIONS

### File: `src/lib/gapEngine/computeDealGaps.ts`

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Minimum confidence to consider a fact "resolved enough" without confirmation
export const CONFIDENCE_THRESHOLD = 0.75;

// Required fact keys that MUST be present for memo to be complete
export const REQUIRED_FACT_KEYS = [
  "TOTAL_REVENUE",
  "NET_INCOME",
  "DEPRECIATION",
  "ANNUAL_DEBT_SERVICE",
  "DSCR",
] as const;

export type GapType =
  | "missing_fact"
  | "low_confidence"
  | "conflict"
  | "needs_confirmation";

export type GapItem = {
  gap_type: GapType;
  fact_type: string;
  fact_key: string;
  owner_entity_id: string | null;
  fact_id: string | null;
  conflict_id: string | null;
  description: string;
  resolution_prompt: string;
  priority: number;
};

/**
 * Computes the current gap state for a deal and upserts into deal_gap_queue.
 * Called after every extraction, BIE run, or manual confirmation.
 * Returns the number of open gaps.
 */
export async function computeDealGaps(args: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: true; openGaps: number } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();
    const gaps: GapItem[] = [];

    // ── 1. Check required facts exist ──────────────────────────────────
    const { data: presentFacts } = await sb
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, confidence, id, resolution_status")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("is_superseded", false)
      .in("fact_key", REQUIRED_FACT_KEYS as unknown as string[])
      .not("fact_value_num", "is", null)
      .order("created_at", { ascending: false });

    const presentKeys = new Set((presentFacts ?? []).map((f: any) => f.fact_key));

    for (const key of REQUIRED_FACT_KEYS) {
      if (!presentKeys.has(key)) {
        gaps.push({
          gap_type: "missing_fact",
          fact_type: "FINANCIAL",
          fact_key: key,
          owner_entity_id: null,
          fact_id: null,
          conflict_id: null,
          description: `Required metric "${key}" has not been extracted from any document.`,
          resolution_prompt: `Upload the financial document containing ${key} and re-run spreads, or provide it directly.`,
          priority: 90,
        });
      }
    }

    // ── 2. Check low-confidence facts ──────────────────────────────────
    const { data: lowConfFacts } = await sb
      .from("deal_financial_facts")
      .select("id, fact_key, fact_type, confidence, fact_value_num, fact_value_text")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("is_superseded", false)
      .not("confidence", "is", null)
      .lt("confidence", CONFIDENCE_THRESHOLD)
      .neq("resolution_status", "confirmed")
      .neq("resolution_status", "rejected")
      .order("confidence", { ascending: true })
      .limit(20);

    for (const f of lowConfFacts ?? []) {
      gaps.push({
        gap_type: "low_confidence",
        fact_type: f.fact_type,
        fact_key: f.fact_key,
        owner_entity_id: null,
        fact_id: f.id,
        conflict_id: null,
        description: `"${f.fact_key}" was extracted with low confidence (${Math.round(f.confidence * 100)}%). Verification recommended.`,
        resolution_prompt: `Can you confirm the value for ${f.fact_key}? I extracted ${f.fact_value_num ?? f.fact_value_text} but I'm not fully certain.`,
        priority: 70,
      });
    }

    // ── 3. Check open conflicts ─────────────────────────────────────────
    const { data: conflicts } = await sb
      .from("deal_fact_conflicts")
      .select("id, fact_type, fact_key, conflicting_values, owner_entity_id")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("status", "open");

    for (const c of conflicts ?? []) {
      const vals = (c.conflicting_values as any[])
        .map((v: any) => `${v.source}: ${v.value}`)
        .join(" vs ");
      gaps.push({
        gap_type: "conflict",
        fact_type: c.fact_type,
        fact_key: c.fact_key,
        owner_entity_id: c.owner_entity_id ?? null,
        fact_id: null,
        conflict_id: c.id,
        description: `Conflicting values for "${c.fact_key}": ${vals}`,
        resolution_prompt: `I found two different values for ${c.fact_key}. Which is correct?`,
        priority: 90,
      });
    }

    // ── 4. Upsert gaps into deal_gap_queue ─────────────────────────────
    // First, dismiss any previously open gaps for keys that are now resolved
    const openGapKeys = gaps.map(g => g.fact_key);
    if (openGapKeys.length > 0) {
      await sb
        .from("deal_gap_queue")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("deal_id", args.dealId)
        .eq("bank_id", args.bankId)
        .eq("status", "open")
        .not("fact_key", "in", `(${openGapKeys.map(k => `"${k}"`).join(",")})`);
    }

    // Upsert new gaps
    for (const gap of gaps) {
      await sb
        .from("deal_gap_queue")
        .upsert(
          {
            deal_id: args.dealId,
            bank_id: args.bankId,
            ...gap,
            status: "open",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "deal_id,fact_type,fact_key,gap_type,status" },
        );
    }

    return { ok: true, openGaps: gaps.length };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

---

### File: `src/lib/gapEngine/extractFactsFromTranscript.ts`

```typescript
import "server-only";

export type TranscriptCandidate = {
  fact_type: string;
  fact_key: string;
  value: string | number;
  confidence: number;
  snippet: string;
  owner_name?: string;
};

/**
 * Uses Gemini Flash to extract objective, verifiable facts from
 * an AI-generated meeting transcript or call notes.
 *
 * IMPORTANT: Only extracts objective facts — no subjective impressions.
 * The prompt explicitly instructs the model to skip qualitative assessments.
 */
export async function extractFactsFromTranscript(args: {
  rawText: string;
  dealId: string;
}): Promise<{ ok: true; candidates: TranscriptCandidate[] } | { ok: false; error: string }> {
  try {
    const { aiJson } = await import("@/lib/ai/openai");

    const structureHint = `
{
  "candidates": [
    {
      "fact_type": "FINANCIAL | ENTITY | COLLATERAL | LOAN_REQUEST",
      "fact_key": "canonical key e.g. TOTAL_REVENUE, BUSINESS_START_DATE, OWNER_NAME",
      "value": "extracted value — number or string",
      "confidence": 0.0 to 1.0,
      "snippet": "exact quote from transcript supporting this fact",
      "owner_name": "person or entity name if this fact belongs to a specific owner"
    }
  ]
}`;

    const prompt = `You are a fact extraction engine for a commercial bank credit system.

Extract ONLY objective, verifiable facts from the following meeting transcript or call notes.

STRICT RULES:
- Extract ONLY facts that can be documented in a credit file
- DO NOT extract subjective impressions (e.g. "borrower seems trustworthy", "management presents well")
- DO NOT extract predictions or opinions
- DO extract: dollar amounts, dates, percentages, names of entities/people, addresses, counts, years in business, ownership percentages, stated revenue/income figures, existing debt balances, property addresses, fleet sizes, employee counts
- If a value is stated as approximate (e.g. "about $2 million"), extract it with lower confidence (0.55)
- If a value is stated precisely, use higher confidence (0.75)
- Never infer values not explicitly stated

Return ONLY the JSON object matching this structure:
${structureHint}

TRANSCRIPT:
${args.rawText.slice(0, 15000)}`;

    const result = await aiJson({ prompt, label: "transcript_extraction" });
    const candidates = result?.candidates ?? [];

    return { ok: true, candidates };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

---

### File: `src/lib/gapEngine/resolveDealGap.ts`

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

export type GapResolution =
  | { action: "confirm"; factId: string; userId: string }
  | { action: "reject"; factId: string; userId: string }
  | { action: "resolve_conflict"; conflictId: string; winningFactId: string; userId: string }
  | { action: "provide_value"; gapId: string; factType: string; factKey: string; value: number | string; userId: string; dealId: string; bankId: string };

/**
 * Resolves a gap item. Writes back to deal_financial_facts and emits ledger event.
 * Called from both the UI gap panel and the voice/chat session handler.
 */
export async function resolveDealGap(
  resolution: GapResolution
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = supabaseAdmin();

  try {
    if (resolution.action === "confirm") {
      await sb
        .from("deal_financial_facts")
        .update({ resolution_status: "confirmed" })
        .eq("id", resolution.factId);

      await sb
        .from("deal_gap_queue")
        .update({
          status: "resolved",
          resolved_by: resolution.userId,
          resolved_at: new Date().toISOString(),
          resolution_meta: { action: "confirmed" },
        })
        .eq("fact_id", resolution.factId)
        .eq("status", "open");

      // Get deal_id for ledger event
      const { data: fact } = await sb
        .from("deal_financial_facts")
        .select("deal_id, fact_key")
        .eq("id", resolution.factId)
        .maybeSingle();

      if (fact) {
        await writeEvent({
          dealId: fact.deal_id,
          kind: "fact.confirmed",
          actorUserId: resolution.userId,
          scope: "gap_resolution",
          action: "confirmed",
          meta: { fact_id: resolution.factId, fact_key: fact.fact_key },
        });
      }
    }

    if (resolution.action === "reject") {
      await sb
        .from("deal_financial_facts")
        .update({ resolution_status: "rejected", is_superseded: true })
        .eq("id", resolution.factId);

      await sb
        .from("deal_gap_queue")
        .update({
          status: "resolved",
          resolved_by: resolution.userId,
          resolved_at: new Date().toISOString(),
          resolution_meta: { action: "rejected" },
        })
        .eq("fact_id", resolution.factId)
        .eq("status", "open");
    }

    if (resolution.action === "resolve_conflict") {
      // Mark conflict resolved
      await sb
        .from("deal_fact_conflicts")
        .update({
          status: "resolved",
          resolved_fact_id: resolution.winningFactId,
          resolved_by: resolution.userId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", resolution.conflictId);

      // Mark the winning fact as confirmed, losers as rejected
      const { data: conflict } = await sb
        .from("deal_fact_conflicts")
        .select("conflicting_fact_ids")
        .eq("id", resolution.conflictId)
        .maybeSingle();

      const losingIds = (conflict?.conflicting_fact_ids ?? [])
        .filter((id: string) => id !== resolution.winningFactId);

      await sb
        .from("deal_financial_facts")
        .update({ resolution_status: "confirmed" })
        .eq("id", resolution.winningFactId);

      if (losingIds.length > 0) {
        await sb
          .from("deal_financial_facts")
          .update({ resolution_status: "rejected", is_superseded: true })
          .in("id", losingIds);
      }

      // Close the gap queue item
      await sb
        .from("deal_gap_queue")
        .update({
          status: "resolved",
          resolved_by: resolution.userId,
          resolved_at: new Date().toISOString(),
        })
        .eq("conflict_id", resolution.conflictId)
        .eq("status", "open");
    }

    if (resolution.action === "provide_value") {
      // Banker is providing a value that didn't exist
      const valueNum = typeof resolution.value === "number" ? resolution.value : null;
      const valueText = typeof resolution.value === "string" ? resolution.value : null;

      await upsertDealFinancialFact({
        dealId: resolution.dealId,
        bankId: resolution.bankId,
        sourceDocumentId: null,
        factType: resolution.factType,
        factKey: resolution.factKey,
        factValueNum: valueNum,
        factValueText: valueText,
        confidence: 1.0,
        provenance: {
          source_type: "BANKER_INPUT",
          source_ref: `banker:${resolution.userId}`,
          as_of_date: new Date().toISOString().slice(0, 10),
          extractor: "gap_resolution:banker_provided",
          confidence: 1.0,
          extraction_path: "banker_voice",
          citations: [],
          raw_snippets: [],
        },
      });

      // Resolve the gap
      await sb
        .from("deal_gap_queue")
        .update({
          status: "resolved",
          resolved_by: resolution.userId,
          resolved_at: new Date().toISOString(),
          resolution_meta: { action: "provided", value: resolution.value },
        })
        .eq("id", resolution.gapId)
        .eq("status", "open");

      await writeEvent({
        dealId: resolution.dealId,
        kind: "fact.banker_provided",
        actorUserId: resolution.userId,
        scope: "gap_resolution",
        action: "provided",
        meta: {
          fact_type: resolution.factType,
          fact_key: resolution.factKey,
          value: resolution.value,
          gap_id: resolution.gapId,
        },
      });
    }

    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

---

## STEP 3 — API ROUTES

### File: `src/app/api/deals/[dealId]/gap-queue/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeDealGaps } from "@/lib/gapEngine/computeDealGaps";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const sb = supabaseAdmin();
    const { data: gaps } = await sb
      .from("deal_gap_queue")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .eq("status", "open")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });

    // Completeness score: (required facts confirmed / total required facts) * 100
    const { data: confirmedFacts } = await sb
      .from("deal_financial_facts")
      .select("fact_key")
      .eq("deal_id", dealId)
      .eq("bank_id", bankPick.bankId)
      .eq("resolution_status", "confirmed")
      .eq("is_superseded", false);

    const totalRequired = 5; // REQUIRED_FACT_KEYS.length
    const confirmedRequired = (confirmedFacts ?? []).length;
    const completenessScore = Math.round((confirmedRequired / totalRequired) * 100);

    return NextResponse.json({
      ok: true,
      gaps: gaps ?? [],
      openCount: (gaps ?? []).length,
      completenessScore,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// POST — trigger gap recompute
export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const result = await computeDealGaps({ dealId, bankId: bankPick.bankId });
    return NextResponse.json(result);
  } catch (e: unknown) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

---

### File: `src/app/api/deals/[dealId]/transcript-ingest/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFactsFromTranscript } from "@/lib/gapEngine/extractFactsFromTranscript";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const { userId } = await clerkAuth();
    const body = await req.json().catch(() => ({}));
    const rawText: string = body.raw_text ?? "";
    const sourceLabel: string = body.source_label ?? "Uploaded notes";

    if (!rawText.trim() || rawText.length < 50) {
      return NextResponse.json({ ok: false, error: "transcript_too_short" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Create the upload record
    const { data: upload } = await sb
      .from("deal_transcript_uploads")
      .insert({
        deal_id: dealId,
        bank_id: bankPick.bankId,
        uploaded_by: userId ?? "unknown",
        source_label: sourceLabel,
        raw_text: rawText,
        extraction_status: "processing",
      })
      .select("id")
      .single();

    // Extract candidates
    const extractResult = await extractFactsFromTranscript({ rawText, dealId });

    if (!extractResult.ok) {
      await sb
        .from("deal_transcript_uploads")
        .update({ extraction_status: "failed" })
        .eq("id", upload.id);
      return NextResponse.json({ ok: false, error: extractResult.error }, { status: 500 });
    }

    // Save candidates back to upload record
    await sb
      .from("deal_transcript_uploads")
      .update({
        extraction_status: "complete",
        extracted_candidates: extractResult.candidates,
        processed_at: new Date().toISOString(),
      })
      .eq("id", upload.id);

    return NextResponse.json({
      ok: true,
      upload_id: upload.id,
      candidates: extractResult.candidates,
      candidate_count: extractResult.candidates.length,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

---

### File: `src/app/api/deals/[dealId]/gap-queue/resolve/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { resolveDealGap } from "@/lib/gapEngine/resolveDealGap";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const { userId } = await clerkAuth();
    const body = await req.json().catch(() => ({}));

    const result = await resolveDealGap({
      ...body,
      userId: userId ?? "unknown",
      dealId,
      bankId: bankPick.bankId,
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

---

### File: `src/app/api/deals/[dealId]/banker-session/start/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 15;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });

    const sb = supabaseAdmin();

    // Load deal context for system prompt injection
    const [dealRes, gapsRes, metricsRes] = await Promise.all([
      sb.from("deals").select("borrower_name, loan_amount, name").eq("id", dealId).maybeSingle(),
      sb.from("deal_gap_queue").select("description, resolution_prompt, priority").eq("deal_id", dealId).eq("status", "open").order("priority", { ascending: false }).limit(10),
      sb.from("deal_financial_facts").select("fact_key, fact_value_num").eq("deal_id", dealId).eq("is_superseded", false).in("fact_key", ["TOTAL_REVENUE", "NET_INCOME", "DSCR"]).not("fact_value_num", "is", null),
    ]);

    const deal = dealRes.data;
    const openGaps = gapsRes.data ?? [];
    const metrics = metricsRes.data ?? [];

    const metricSummary = metrics.map((m: any) => `${m.fact_key}: ${m.fact_value_num}`).join(", ");
    const gapSummary = openGaps.slice(0, 5).map((g: any, i: number) => `${i + 1}. ${g.description}`).join("\n");

    const systemPrompt = `You are Buddy, a senior credit analyst AI at a commercial bank.

You are conducting a structured credit review session with a banker about the following deal:
- Borrower: ${deal?.borrower_name ?? "Unknown"}
- Deal: ${deal?.name ?? dealId}
- Loan Amount: $${deal?.loan_amount?.toLocaleString() ?? "Unknown"}

Known financial metrics:
${metricSummary || "None extracted yet"}

Open items requiring resolution (${openGaps.length} total):
${gapSummary || "None"}

YOUR ROLE:
- You are helping the banker resolve open gaps in the deal record
- Ask ONLY about specific open items listed above, one at a time
- ONLY collect objective, verifiable facts (numbers, dates, names, addresses, percentages)
- NEVER ask for subjective impressions ("does management seem trustworthy")
- NEVER make credit recommendations or judgments yourself
- Be concise, specific, and professional
- Acknowledge when you already have a piece of information — never ask for things already known
- When the banker provides a fact, confirm it back clearly: "Got it — I'll record [value] for [field]"

Start by briefly acknowledging what you already know about the deal, then focus on the highest priority open item.`;

    // Create ephemeral session token
    const session = await openai.beta.realtime.sessions.create({
      model: "gpt-4o-realtime-preview-2024-12-17",
      instructions: systemPrompt,
      voice: "alloy",
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
    });

    return NextResponse.json({
      ok: true,
      client_secret: session.client_secret,
      session_id: session.id,
      open_gaps: openGaps.length,
      context_summary: {
        borrower: deal?.borrower_name,
        open_gaps: openGaps.length,
        metrics_present: metrics.length,
      },
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

---

## STEP 4 — UI COMPONENT

### File: `src/components/deals/DealHealthPanel.tsx`

This component lives on the deal page AND the credit memo page.
It shows completeness %, open gap count, and a list of gaps with one-click resolution for confirms.

```typescript
"use client";

import { useState, useEffect } from "react";

type Gap = {
  id: string;
  gap_type: "missing_fact" | "low_confidence" | "conflict" | "needs_confirmation";
  fact_key: string;
  description: string;
  resolution_prompt: string;
  priority: number;
  fact_id: string | null;
  conflict_id: string | null;
};

type DealHealthPanelProps = {
  dealId: string;
  onSessionStart?: () => void;
};

const GAP_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  missing_fact:       { label: "Missing",  color: "bg-rose-100 text-rose-700" },
  conflict:           { label: "Conflict", color: "bg-orange-100 text-orange-700" },
  low_confidence:     { label: "Unverified", color: "bg-amber-100 text-amber-700" },
  needs_confirmation: { label: "Confirm",  color: "bg-sky-100 text-sky-700" },
};

export default function DealHealthPanel({ dealId, onSessionStart }: DealHealthPanelProps) {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [completeness, setCompleteness] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/deals/${dealId}/gap-queue`);
    const data = await res.json();
    if (data.ok) {
      setGaps(data.gaps);
      setCompleteness(data.completenessScore);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [dealId]);

  const confirm = async (gap: Gap) => {
    if (!gap.fact_id) return;
    setResolving(gap.id);
    await fetch(`/api/deals/${dealId}/gap-queue/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", factId: gap.fact_id }),
    });
    await load();
    setResolving(null);
  };

  const barColor = completeness >= 80 ? "bg-emerald-500" :
                   completeness >= 50 ? "bg-amber-500" : "bg-rose-500";

  if (loading) return (
    <div className="border border-gray-200 rounded-lg p-4 animate-pulse">
      <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
      <div className="h-2 bg-gray-100 rounded" />
    </div>
  );

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Deal Health</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            gaps.length === 0 ? "bg-emerald-100 text-emerald-700" :
            gaps.length <= 3 ? "bg-amber-100 text-amber-700" :
            "bg-rose-100 text-rose-700"
          }`}>
            {gaps.length === 0 ? "Complete" : `${gaps.length} open item${gaps.length !== 1 ? "s" : ""}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {gaps.length > 0 && onSessionStart && (
            <button
              onClick={onSessionStart}
              className="text-xs font-semibold bg-gray-900 text-white px-3 py-1.5 rounded-md hover:bg-gray-700 flex items-center gap-1.5"
            >
              <span>🎙</span> Start Credit Interview
            </button>
          )}
        </div>
      </div>

      {/* Completeness bar */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
          <span>Data completeness</span>
          <span className="font-semibold text-gray-800">{completeness}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-1.5 ${barColor} rounded-full transition-all`} style={{ width: `${completeness}%` }} />
        </div>
      </div>

      {/* Gap list */}
      {gaps.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          ✓ All required facts confirmed
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {gaps.map(gap => {
            const badge = GAP_TYPE_BADGE[gap.gap_type] ?? { label: gap.gap_type, color: "bg-gray-100 text-gray-600" };
            return (
              <div key={gap.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.color}`}>
                      {badge.label}
                    </span>
                    <span className="text-xs font-mono text-gray-500">{gap.fact_key}</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">{gap.description}</p>
                </div>
                {gap.gap_type === "low_confidence" && gap.fact_id && (
                  <button
                    onClick={() => confirm(gap)}
                    disabled={resolving === gap.id}
                    className="flex-shrink-0 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded"
                  >
                    {resolving === gap.id ? "..." : "Confirm"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

---

## STEP 5 — TRANSCRIPT UPLOAD COMPONENT

### File: `src/components/deals/TranscriptUploadPanel.tsx`

```typescript
"use client";

import { useState } from "react";

type Candidate = {
  fact_type: string;
  fact_key: string;
  value: string | number;
  confidence: number;
  snippet: string;
  owner_name?: string;
};

export default function TranscriptUploadPanel({ dealId }: { dealId: string }) {
  const [text, setText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("Otter.ai");
  const [uploading, setUploading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());

  const upload = async () => {
    if (!text.trim()) return;
    setUploading(true);
    setCandidates([]);
    try {
      const res = await fetch(`/api/deals/${dealId}/transcript-ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_text: text, source_label: sourceLabel }),
      });
      const data = await res.json();
      if (data.ok) {
        setCandidates(data.candidates);
        setUploadId(data.upload_id);
      }
    } finally {
      setUploading(false);
    }
  };

  const confirmCandidate = async (idx: number, candidate: Candidate) => {
    setConfirming(prev => new Set(prev).add(idx));
    await fetch(`/api/deals/${dealId}/gap-queue/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "provide_value",
        gapId: "transcript-" + idx,
        factType: candidate.fact_type,
        factKey: candidate.fact_key,
        value: candidate.value,
      }),
    });
    setConfirmed(prev => new Set(prev).add(idx));
    setConfirming(prev => { const s = new Set(prev); s.delete(idx); return s; });
  };

  const SOURCE_LABELS = ["Otter.ai", "Fireflies", "Fathom", "Teams recording", "Manual notes", "Other"];

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Upload Call Notes / Transcript</div>
        <div className="text-xs text-gray-400 mt-0.5">Buddy extracts verifiable facts — no subjective content is stored</div>
      </div>

      {candidates.length === 0 ? (
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            {SOURCE_LABELS.map(label => (
              <button
                key={label}
                onClick={() => setSourceLabel(label)}
                className={`text-xs px-2.5 py-1 rounded border ${
                  sourceLabel === label
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            rows={8}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste your Otter.ai transcript, Fireflies notes, or meeting summary here..."
            className="w-full text-sm text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-2 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
          />
          <button
            onClick={upload}
            disabled={uploading || !text.trim()}
            className="text-xs font-semibold bg-gray-900 text-white px-4 py-2 rounded-md hover:bg-gray-700 disabled:bg-gray-300"
          >
            {uploading ? "Extracting facts..." : "Extract Facts"}
          </button>
        </div>
      ) : (
        <div>
          <div className="px-4 py-2 bg-sky-50 border-b border-sky-100 text-xs text-sky-700">
            Found {candidates.length} verifiable facts. Confirm the ones that are correct.
          </div>
          <div className="divide-y divide-gray-100">
            {candidates.map((c, i) => (
              <div key={i} className={`px-4 py-3 flex items-start gap-3 ${confirmed.has(i) ? "bg-emerald-50" : ""}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono font-semibold text-gray-700">{c.fact_key}</span>
                    <span className="text-xs text-gray-400">{Math.round(c.confidence * 100)}% confident</span>
                  </div>
                  <div className="text-sm text-gray-900 font-medium">{String(c.value)}</div>
                  {c.snippet && (
                    <div className="text-xs text-gray-400 mt-0.5 italic">"{c.snippet.slice(0, 120)}"</div>
                  )}
                </div>
                {confirmed.has(i) ? (
                  <span className="text-xs text-emerald-600 font-semibold">✓ Confirmed</span>
                ) : (
                  <button
                    onClick={() => confirmCandidate(i, c)}
                    disabled={confirming.has(i)}
                    className="flex-shrink-0 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded"
                  >
                    {confirming.has(i) ? "..." : "Confirm"}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              onClick={() => { setCandidates([]); setText(""); setConfirmed(new Set()); }}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Upload another transcript
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## STEP 6 — WIRE COMPUTEDEALSGAPS INTO EXISTING PIPELINE

In `src/lib/financialSpreads/extractFactsFromDocument.ts`, at the very end of the function (after the heartbeat upsert), add:

```typescript
// Trigger gap recompute after every extraction
try {
  const { computeDealGaps } = await import("@/lib/gapEngine/computeDealGaps");
  void computeDealGaps({ dealId: args.dealId, bankId: args.bankId }).catch(() => {});
} catch {
  // Non-fatal
}
```

In `src/lib/research/runMission.ts`, after BIE completes, add the same trigger.

---

## STEP 7 — WIRE DEALHEALTHPANEL INTO EXISTING PAGES

### Deal page (wherever the deal overview is rendered):
```tsx
import DealHealthPanel from "@/components/deals/DealHealthPanel";
// Add alongside existing deal status panels
<DealHealthPanel dealId={dealId} />
```

### Credit memo page (`src/app/(app)/credit-memo/[dealId]/canonical/page.tsx`):
```tsx
import DealHealthPanel from "@/components/deals/DealHealthPanel";
import TranscriptUploadPanel from "@/components/deals/TranscriptUploadPanel";
// Add above the memo template, below the button row
<DealHealthPanel dealId={dealId} />
<TranscriptUploadPanel dealId={dealId} />
```

---

## VALIDATION CHECKLIST

Before marking Phase 50 complete:

- [ ] `tsc` clean — zero type errors
- [ ] All 4 migrations applied — verify via `information_schema.columns`
- [ ] `computeDealGaps()` runs without error on deal ffcc9733
- [ ] Gap queue returns rows for Samaritus (missing stressed DSCR, collateral values etc.)
- [ ] Transcript upload with sample Otter.ai text extracts at least 3 candidates
- [ ] Confirm button on low-confidence gap sets `resolution_status = confirmed` in DB
- [ ] Ledger event emitted for each confirmation — verify in `deal_events`
- [ ] DealHealthPanel renders on deal page showing completeness %
- [ ] Banker session start route returns `client_secret` from OpenAI
- [ ] Voice/chat session system prompt contains deal context (borrower name, open gaps)
- [ ] `deal_memo_overrides` still works — this phase does NOT remove it (that's Phase 51)

---

## NON-NEGOTIABLE INVARIANTS (from ChatGPT spec — preserved unchanged)

- No subjective data ever stored
- No silent overwrites of facts
- All conflicts must be surfaced
- Every fact must have a source
- Banker never re-types known data
- System fails closed if data missing
- Single ledger (`deal_events`) remains source of truth

---

## WHAT THIS PHASE DOES NOT DO (save for Phase 51)

- Does NOT remove `deal_memo_overrides` — that deprecation happens when `buildCanonicalCreditMemo` is wired to read from confirmed facts
- Does NOT replace `deal_memo_overrides` wizard — wizard remains as fallback
- Does NOT fully wire voice session transcript → auto-confirm (Phase 51)
- Does NOT add the full chat/voice UI component (Phase 51)

Phase 50 is infrastructure + minimal UI. Phase 51 is the full interactive experience.
