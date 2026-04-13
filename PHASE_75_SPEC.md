# Phase 75 — Completion Sprint: Five Identified Gaps

**Date:** April 13, 2026
**Status:** Spec — ready for implementation

This phase closes every gap identified in the Phases 71–74 AAR review.
Five independent items, ordered by severity.

---

## What this phase does NOT touch

```
src/lib/agentWorkflows/registry.ts             ← do not modify
src/lib/agentWorkflows/approval.ts             ← do not modify
src/lib/agentWorkflows/contracts/              ← do not modify (only wire them)
src/lib/reconciliation/dealReconciliator.ts    ← do not modify
src/lib/extraction/geminiFlashPrompts.ts       ← do not modify
src/lib/research/runMission.ts                 ← targeted addition only (Step 2)
src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts ← targeted addition only (Step 2)
```

---

## Pre-work SQL (run before writing any code, paste results in AAR)

```sql
-- 1. Confirm invalid stage values in deals table
SELECT stage, COUNT(*) FROM deals GROUP BY stage ORDER BY count DESC;

-- 2. Does deal_decisions table exist?
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('deal_decisions', 'decision_snapshots');

-- 3. Confirm deal_borrower_drafts table exists (from Phase 73)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'deal_borrower_drafts';

-- 4. Check gap queue table name
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE '%gap%';
```

---

## STEP 1 — P0: Fix approve/decline/escalate in actions/route.ts

**Why P0:** `DealLifecycleStage` (from `advanceDealLifecycleCore.ts`) only accepts:
`"created" | "intake" | "collecting" | "underwriting" | "ready"`.

The current `actions/route.ts` writes:
- approve → `stage: "approved"` ❌
- decline → `stage: "declined"` ❌
- escalate → `stage: "committee"` ❌

None of these are valid `DealLifecycleStage` values. The lifecycle engine
doesn't recognize them, causing any approved deal to fall back to `created`
state in the lifecycle derivation.

**The correct model:** Credit decisions (approve/decline) are NOT lifecycle
stage changes. They are decision records stored separately from lifecycle.
The lifecycle of a deal is: created → intake → collecting → underwriting → ready.
A credit decision happens at `ready` stage and is stored in `deal_decisions`.

### Migration: `supabase/migrations/<timestamp>_add_deal_decisions.sql`

```sql
CREATE TABLE IF NOT EXISTS deal_decisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       UUID NOT NULL REFERENCES deals(id),
  bank_id       UUID NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('approved', 'declined', 'tabled', 'conditional_approval')),
  decided_by    TEXT NOT NULL,       -- Clerk user ID
  decided_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rationale     TEXT,
  conditions    TEXT[],              -- any conditions attached to approval
  recon_status  TEXT,                -- snapshot of reconciliation status at decision time
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deal_decisions_deal ON deal_decisions(deal_id);
CREATE INDEX idx_deal_decisions_bank ON deal_decisions(bank_id);

ALTER TABLE deal_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_isolation" ON deal_decisions
  FOR ALL USING (
    bank_id IN (
      SELECT bank_id FROM bank_memberships WHERE user_id = auth.uid()
    )
  );
```

### Replace the approve/decline/escalate cases in `src/app/api/deals/[dealId]/actions/route.ts`

Find the `switch (action)` block. Replace the three cases:

**Replace the `approve` case** (keeping the reconciliation gate that's already there):

```typescript
case "approve": {
  // Reconciliation gate — CONFLICTS block approve (Phase 69, keep as-is)
  const { data: reconRow } = await sb
    .from("deal_reconciliation_results")
    .select("overall_status")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!reconRow) {
    return NextResponse.json(
      {
        ok: false,
        error: "Reconciliation has not been run for this deal. Run reconciliation before approving.",
        code: "RECONCILIATION_NOT_RUN",
      },
      { status: 422 }
    );
  }

  if (reconRow.overall_status === "CONFLICTS") {
    return NextResponse.json(
      {
        ok: false,
        error: "This deal has unresolved cross-document conflicts. Resolve conflicts before approving.",
        code: "RECONCILIATION_CONFLICTS",
      },
      { status: 422 }
    );
  }

  // Write credit decision record (does NOT mutate deals.stage)
  await sb.from("deal_decisions").insert({
    deal_id: dealId,
    bank_id: bankId,
    decision: "approved",
    decided_by: userId,
    recon_status: reconRow.overall_status,
  });
  break;
}
```

**Replace the `decline` case:**

```typescript
case "decline": {
  const { reason } = body as { action: string; reason?: string };

  await sb.from("deal_decisions").insert({
    deal_id: dealId,
    bank_id: bankId,
    decision: "declined",
    decided_by: userId,
    rationale: reason ?? null,
  });
  break;
}
```

**Replace the `escalate` case:**

```typescript
case "escalate": {
  // Escalate advances lifecycle to "ready" (committee-ready state)
  // Uses the canonical lifecycle engine — does NOT write arbitrary stage values
  const { advanceDealLifecycle } = await import(
    "@/lib/deals/advanceDealLifecycle"
  );
  const advance = await advanceDealLifecycle({
    dealId,
    toStage: "ready",
    reason: "escalated_to_committee",
    source: "actions_route",
    actor: { userId, type: "user" },
  });

  if (!advance.ok && !(advance as any).already) {
    return NextResponse.json(
      {
        ok: false,
        error: (advance as any).error ?? "lifecycle_advance_failed",
        code: "LIFECYCLE_ADVANCE_FAILED",
      },
      { status: 422 }
    );
  }
  break;
}
```

**No other changes to this file.**

---

## STEP 2 — Wire output contracts to persistence call sites

Contracts exist in `src/lib/agentWorkflows/contracts/` but are not called
at the persistence points in `runMission.ts` or `buildCanonicalCreditMemo.ts`.

### 2A — Wire research narrative contract in `runMission.ts`

Find the `persistNarrative` call in `runMission.ts` (the inner call inside
the `runMission` function, around line 295 where `persistNarrative` is invoked
with BIE sections). Add contract validation before the upsert:

```typescript
// Add import at top of file:
import { validateResearchBundle, type ContractSeverity } from
  "@/lib/agentWorkflows/contracts";

// Before the existing buddy_research_narratives upsert call, add:
const contractResult = validateResearchBundle({
  mission_id: missionId,
  sections: bieSections,
  research_quality: bieResult.research_quality,
  sources_count: bieResult.sources_used.length,
  facts_count: 0,
});

if (contractResult.severity === "FATAL") {
  // FATAL: do not persist, log warning (non-fatal to mission completion)
  console.warn("[runMission] BIE narrative failed contract validation (FATAL)",
    { missionId, violations: contractResult.violations });
  // Skip the upsert — mission still succeeds, narrative just won't persist
} else {
  // WARN or ERROR: persist with validation_status recorded in metrics
  if (contractResult.severity !== "OK") {
    console.warn("[runMission] BIE narrative contract warnings",
      { missionId, severity: contractResult.severity, violations: contractResult.violations });
  }
  // Proceed with existing upsert (no change to upsert logic)
  const { error: bieUpsertErr } = await (sb2 as any)
    .from("buddy_research_narratives")
    .upsert(
      { mission_id: missionId, sections: bieSections, version: 3 },
      { onConflict: "mission_id" },
    );
  // ... existing error handling unchanged
}
```

### 2B — Wire memo section contract in `buildCanonicalCreditMemo.ts`

This is a large file (48KB). Do NOT refactor it. Make a targeted addition only.

Find the final `return { ok: true, memo }` line (the last line of the
try block in `buildCanonicalCreditMemo`). Before that return, add:

```typescript
// Add import at top of file:
import { validateMemoSection } from "@/lib/agentWorkflows/contracts";

// Before the final return { ok: true, memo }, add:
// Run memo section contract validation (non-fatal — memo renders even with warnings)
const sectionWarnings: string[] = [];
for (const key of ["executive_summary", "financial_analysis", "recommendation"] as const) {
  const section = memo[key];
  if (section) {
    const sectionPayload = {
      section_code: key,
      title: String(key),
      content: JSON.stringify(section).slice(0, 500),
      data_sources: ["deal_financial_facts"] as const,
      confidence: 0.8,
      warnings: [],
    };
    const result = validateMemoSection(sectionPayload);
    if (result.severity === "FATAL") {
      sectionWarnings.push(`${key}: FATAL contract violation — ${result.violations.join(", ")}`);
    }
  }
}
if (sectionWarnings.length > 0) {
  console.warn("[buildCanonicalCreditMemo] section contract violations (non-fatal)",
    { dealId: args.dealId, warnings: sectionWarnings });
}
// proceed to return { ok: true, memo } unchanged
```

**Important:** If `validateResearchBundle`, `validateMemoSection`, or other
contract functions do not yet exist as named exports from
`src/lib/agentWorkflows/contracts/index.ts`, check the actual export names
via GitHub API before wiring. Do not assume export names — read the file.

---

## STEP 3 — Operator console run detail page

**Gap:** `/ops/agents/page.tsx` lists all runs but rows are not clickable.
There is no detail view. Creating `/ops/agents/runs/[runId]/page.tsx`.

### New route: `src/app/api/ops/agent-runs/[runId]/route.ts`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getWorkflowDefinition } from "@/lib/agentWorkflows/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string }> }
) {
  try {
    await requireSuperAdmin();
    const { runId } = await ctx.params;
    const sb = supabaseAdmin();

    // Query the unified view for this specific run
    const { data, error } = await (sb as any)
      .from("agent_workflow_runs_view")
      .select("*")
      .eq("id", runId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ ok: false, error: "run_not_found" }, { status: 404 });
    }

    // Enrich with workflow definition
    const definition = getWorkflowDefinition(data.workflow_code) ?? null;

    return NextResponse.json({ ok: true, run: data, definition });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "internal" },
      { status: err?.message === "forbidden" ? 403 : 500 }
    );
  }
}
```

### New page: `src/app/ops/agents/runs/[runId]/page.tsx`

Client component. Fetches from `/api/ops/agent-runs/[runId]` and renders:

```
┌─ Run Detail ───────────────────────────────────────────┐
│ Workflow:   Research Bundle Generation (v3.0.0)        │
│ Run ID:     abc12345...                                │
│ Deal:       ffcc9733 → link to /deals/ffcc9733         │
│ Status:     ✅ complete                                │
│ Cost:       $0.0012                                    │
│ Tokens:     4,821 in / 1,203 out                      │
│ Started:    April 13, 2026 14:22:01                    │
│ Duration:   8.4s                                       │
├────────────────────────────────────────────────────────┤
│ Workflow Definition                                    │
│ Source table: buddy_research_missions                  │
│ Output table: buddy_research_narratives                │
│ Requires canonical state: Yes                          │
├────────────────────────────────────────────────────────┤
│ Step Sequence (from registry)                          │
│ 1. discover_sources       fetch_context    ✓           │
│ 2. ingest_sources         call_tool        ✓           │
│ 3. extract_facts          run_model        ✓           │
│ 4. derive_inferences      run_model        ✓           │
│ 5. compile_narrative      run_model        ✓           │
│ 6. run_bie                run_model        ✓           │
│ 7. persist_results        persist_output   ✓           │
└────────────────────────────────────────────────────────┘
```

The step sequence is rendered from `definition.steps` (registry data).
No step-level execution data is stored — the registry provides the declared
steps. The status shown for each step is derived from the overall run status
(all steps ✓ if run is `complete`, last step ✗ if `failed`).

**Also update `src/app/ops/agents/page.tsx`:** Make each row in the runs table
clickable. Add `cursor-pointer` to `<tr>` and `onClick` that navigates to
`/ops/agents/runs/${run.id}`. This is a 2-line change to the existing page.

---

## STEP 4 — Missing Items Follow-Up Workflow (Phase 73A execution path)

The `borrower_draft_request` workflow is declared in the registry but has no
execution path. The `deal_borrower_drafts` table was created in Phase 73.

**Verify `deal_borrower_drafts` exists** via pre-work SQL query #3 before
writing any code. If it doesn't exist, create this migration first:

```sql
-- Only run if pre-work SQL #3 returns 0 rows
CREATE TABLE IF NOT EXISTS deal_borrower_drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       UUID NOT NULL REFERENCES deals(id),
  bank_id       UUID NOT NULL,
  draft_type    TEXT NOT NULL CHECK (draft_type IN ('missing_items', 'general_request', 'status_update')),
  subject       TEXT,
  body          TEXT NOT NULL,
  gap_item_ids  UUID[],
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'approved', 'sent', 'cancelled')),
  approved_by   TEXT,
  approved_at   TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  sent_via      TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE deal_borrower_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_isolation" ON deal_borrower_drafts
  FOR ALL USING (
    bank_id IN (
      SELECT bank_id FROM bank_memberships WHERE user_id = auth.uid()
    )
  );
```

### New file: `src/lib/workflows/missingItemsFollowup.ts`

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

type FollowupResult =
  | { ok: true; draftId: string; subject: string; bodyPreview: string }
  | { ok: false; error: string };

/**
 * Generate a missing items follow-up draft for banker review.
 *
 * Reads the deal gap queue, drafts a professional follow-up message
 * using Gemini Flash, and persists to deal_borrower_drafts with
 * status='draft'. NEVER sends anything automatically.
 *
 * The banker must review and explicitly approve before any send action.
 */
export async function generateMissingItemsFollowup(args: {
  dealId: string;
  bankId: string;
  createdBy: string;
}): Promise<FollowupResult> {
  try {
    const sb = supabaseAdmin();

    // 1. Load deal context
    const { data: deal } = await (sb as any)
      .from("deals")
      .select("id, borrower_name, display_name, nickname, name")
      .eq("id", args.dealId)
      .eq("bank_id", args.bankId)
      .maybeSingle();

    if (!deal) return { ok: false, error: "deal_not_found" };

    // 2. Load gap queue items — check actual table name from pre-work SQL #4
    // If deal_gap_queue doesn't exist, use deal_checklist_items where status = 'missing'
    let gapItems: Array<{ id: string; description: string }> = [];

    // Try deal_gap_queue first
    const { data: gapData } = await (sb as any)
      .from("deal_gap_queue")
      .select("id, description")
      .eq("deal_id", args.dealId)
      .eq("resolved", false)
      .limit(10);

    if (gapData && gapData.length > 0) {
      gapItems = gapData;
    } else {
      // Fallback: checklist items with missing status
      const { data: checklistData } = await (sb as any)
        .from("deal_checklist_items")
        .select("id, checklist_key")
        .eq("deal_id", args.dealId)
        .eq("status", "missing")
        .limit(10);

      gapItems = (checklistData ?? []).map((c: any) => ({
        id: c.id,
        description: c.checklist_key,
      }));
    }

    if (gapItems.length === 0) {
      return { ok: false, error: "no_gap_items_found" };
    }

    // 3. Build Gemini prompt
    const borrowerName = deal.borrower_name ?? deal.display_name ?? deal.nickname ?? deal.name ?? "Borrower";
    const itemList = gapItems.map((g, i) => `${i + 1}. ${g.description}`).join("\n");

    const prompt = `You are a professional commercial loan officer. Write a brief, polite follow-up email to a borrower requesting missing documentation.

Borrower: ${borrowerName}
Missing items:
${itemList}

Instructions:
- Professional but conversational tone
- Do not mention specific financial figures
- Keep under 150 words
- Include a subject line on the first line as "Subject: [subject here]"
- Do not include salutation or signature (will be added separately)
- Return ONLY the subject line and body, nothing else`;

    // 4. Call Gemini Flash
    const { VertexAI } = await import("@google-cloud/vertexai");
    const { ensureGcpAdcBootstrap, getVertexAuthOptions } = await import(
      "@/lib/gcpAdcBootstrap"
    );

    await ensureGcpAdcBootstrap();
    const googleAuthOptions = await getVertexAuthOptions();
    const vertexAI = new VertexAI({
      project: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_PROJECT_ID ?? "",
      location: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
      ...(googleAuthOptions ? { googleAuthOptions: googleAuthOptions as any } : {}),
    });

    const model = vertexAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { temperature: 0.3 },
    });

    const response = await Promise.race([
      model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("gemini_timeout")), 15_000)
      ),
    ]);

    const rawText = (response as any)?.response?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text ?? "")
      .join("")
      .trim() ?? "";

    if (!rawText) return { ok: false, error: "gemini_empty_response" };

    // 5. Parse subject and body
    const lines = rawText.split("\n");
    const subjectLine = lines.find((l) => l.startsWith("Subject:"));
    const subject = subjectLine
      ? subjectLine.replace(/^Subject:\s*/i, "").trim()
      : `Follow-up: Outstanding Items Required — ${borrowerName}`;
    const body = lines
      .filter((l) => !l.startsWith("Subject:"))
      .join("\n")
      .trim();

    // 6. Persist draft (status = 'draft' — NEVER auto-send)
    const { data: draft, error: insertErr } = await (sb as any)
      .from("deal_borrower_drafts")
      .insert({
        deal_id: args.dealId,
        bank_id: args.bankId,
        draft_type: "missing_items",
        subject,
        body,
        gap_item_ids: gapItems.map((g) => g.id),
        status: "draft",
        created_by: args.createdBy,
      })
      .select("id")
      .single();

    if (insertErr) return { ok: false, error: insertErr.message };

    return {
      ok: true,
      draftId: draft.id,
      subject,
      bodyPreview: body.slice(0, 200),
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "unknown" };
  }
}
```

### New API route: `src/app/api/deals/[dealId]/borrower-drafts/route.ts`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { generateMissingItemsFollowup } from "@/lib/workflows/missingItemsFollowup";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyApprovalExists, recordApprovalEvent, buildDraftApprovalSnapshot } from "@/lib/agentWorkflows/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/deals/[dealId]/borrower-drafts
 *
 * Actions:
 *   action: "generate"  — generate a new missing items draft
 *   action: "approve"   — approve a draft (records immutable approval event)
 *   action: "reject"    — reject a draft
 *
 * Sending is a separate action handled by the existing borrower communication
 * infrastructure. Approval NEVER triggers a send automatically.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;
    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = await req.json();
    const { action, draftId } = body as { action: string; draftId?: string };

    if (action === "generate") {
      const result = await generateMissingItemsFollowup({
        dealId,
        bankId: access.bankId,
        createdBy: userId,
      });
      return NextResponse.json(result);
    }

    if (action === "approve" && draftId) {
      const sb = supabaseAdmin();

      // Load draft for snapshot
      const { data: draft } = await (sb as any)
        .from("deal_borrower_drafts")
        .select("*")
        .eq("id", draftId)
        .eq("deal_id", dealId)
        .maybeSingle();

      if (!draft) return NextResponse.json({ ok: false, error: "draft_not_found" }, { status: 404 });
      if (draft.status !== "draft") {
        return NextResponse.json({ ok: false, error: "draft_not_in_draft_status" }, { status: 422 });
      }

      // Record immutable approval event (SR 11-7)
      const snapshot = buildDraftApprovalSnapshot({
        draft_subject: draft.subject ?? "",
        draft_message: draft.body ?? "",
        evidence: draft.gap_item_ids,
        missing_document_type: "missing_items",
      });

      const approvalResult = await recordApprovalEvent(sb as any, {
        entityType: "deal_borrower_draft",
        entityId: draftId,
        decision: "approved",
        decidedBy: userId,
        snapshotJson: snapshot,
      });

      if (!approvalResult.ok) {
        return NextResponse.json({ ok: false, error: approvalResult.error }, { status: 500 });
      }

      // Update draft status
      await (sb as any)
        .from("deal_borrower_drafts")
        .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
        .eq("id", draftId);

      return NextResponse.json({
        ok: true,
        approvalEventId: approvalResult.eventId,
        message: "Draft approved. A banker must explicitly send this draft via the communication panel.",
      });
    }

    if (action === "reject" && draftId) {
      const sb = supabaseAdmin();
      await (sb as any)
        .from("deal_borrower_drafts")
        .update({ status: "cancelled" })
        .eq("id", draftId)
        .eq("deal_id", dealId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "internal" }, { status: 500 });
  }
}

/**
 * GET /api/deals/[dealId]/borrower-drafts
 * Returns all drafts for a deal, most recent first.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;
    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const sb = supabaseAdmin();
    const { data, error } = await (sb as any)
      .from("deal_borrower_drafts")
      .select("id, draft_type, subject, body, status, created_by, created_at, approved_at, sent_at")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return NextResponse.json({ ok: true, drafts: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "internal" }, { status: 500 });
  }
}
```

---

## STEP 5 — Phase 71 (agent identity + evolution loop + outbox drain)

Phase 71 is already fully specced in `PHASE_71_SPEC.md`. Implement it completely
per that spec. No changes to the spec are needed.

The three items in order:

**71A:** Create `src/agents/` with SOUL.md + SKILL.md for 5 agents.
Pure markdown. No code.

**71B:** Migration `agent_skill_evolutions`, `evolutionStager.ts`,
extend `correctionLogger.ts`, admin API route.

**71C:** `processPulseOutbox.ts`, route, `vercel.json` update.

Reference `PHASE_71_SPEC.md` for complete implementation details.
Do not duplicate them here.

---

## Acceptance Criteria

### Step 1 — P0: actions/route.ts
- [ ] Pre-work SQL run and results pasted in AAR
- [ ] `deal_decisions` migration applied and table exists
- [ ] `approve` case writes to `deal_decisions` (does NOT mutate `deals.stage`)
- [ ] `decline` case writes to `deal_decisions` (does NOT mutate `deals.stage`)
- [ ] `escalate` case calls `advanceDealLifecycle` with `toStage: "ready"`
- [ ] Existing reconciliation gate on approve is preserved intact
- [ ] `tsc --noEmit` clean

### Step 2 — Contract wiring
- [ ] `validateResearchBundle` called before `buddy_research_narratives` upsert in `runMission.ts`
- [ ] FATAL contract violations skip persistence (non-fatal to mission)
- [ ] WARN/ERROR violations log but persist
- [ ] `validateMemoSection` called on key sections in `buildCanonicalCreditMemo.ts`
- [ ] Section contract violations log warnings but do not block memo return
- [ ] `tsc --noEmit` clean

### Step 3 — Operator console run detail
- [ ] `src/app/api/ops/agent-runs/[runId]/route.ts` created
- [ ] `src/app/ops/agents/runs/[runId]/page.tsx` created
- [ ] Page renders: workflow name, run ID, deal link, status, cost, tokens, timestamps
- [ ] Page renders step sequence from registry definition
- [ ] Runs table rows in `page.tsx` are clickable (navigate to detail)
- [ ] `tsc --noEmit` clean

### Step 4 — Missing items workflow
- [ ] `deal_borrower_drafts` table confirmed exists (or created via migration)
- [ ] `src/lib/workflows/missingItemsFollowup.ts` created
- [ ] POST `generate` action returns `{ ok: true, draftId, subject, bodyPreview }`
- [ ] POST `approve` action calls `recordApprovalEvent` before updating status
- [ ] Draft status progression: draft → approved (never auto-advances to sent)
- [ ] GET returns draft list for a deal
- [ ] `tsc --noEmit` clean

### Step 5 — Phase 71
- [ ] All 10 agent markdown files created in `src/agents/`
- [ ] `agent_skill_evolutions` migration applied
- [ ] `evolutionStager.ts` created, wired into `correctionLogger.ts`
- [ ] Admin evolutions route: GET + POST (approve/reject)
- [ ] `processPulseOutbox.ts` created and wired
- [ ] `vercel.json` updated with pulse-outbox cron
- [ ] 36 new tests pass (from Phase 71 spec)
- [ ] `tsc --noEmit` clean

---

## AAR format

1. Pre-work SQL results (paste all 4 query outputs)
2. Files created (path + size)
3. Files modified (path + what changed + line numbers)
4. Verification: does `deals.stage` still get written as "approved" anywhere? (`grep -r '"approved"' src/app/api/deals --include="*.ts"`)
5. Post-deploy: confirm `deal_decisions` receives a row when approve is clicked on ffcc9733
6. `tsc --noEmit` result
7. Test pass count
8. Deviations from spec with rationale
