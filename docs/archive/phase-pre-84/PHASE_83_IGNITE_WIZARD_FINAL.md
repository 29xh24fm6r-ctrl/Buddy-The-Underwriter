# Phase 83 — Ignite Wizard (True Final Combined Spec)
# Intelligent Research Readiness + Recovery Flow

**v3 — This is the definitive implementation spec.**

**What each spec contributed:**

| My Spec | ChatGPT Spec |
|---------|-------------|
| Complete working code for all routes and components | Don't fork MemoCompletionWizard — extract and share it |
| Verified production borrowers table schema | `recovery/complete` atomic validation gate before research fires |
| Auth via `ensureDealBankAccess`, zod validation, writeEvent telemetry | Principal cleanup step for malformed ownership entities |
| Per-step auto-save (resilient to mid-wizard close) | "Review" summary step before launch |
| NAICS manual entry fallback | Auto-trigger on `manual_review_required` (not just critical blockers) |
| Back navigation between steps | "Fix with Buddy" button copy for builder surface |
| Dark cockpit UI with exact color values | `suggestedActions[]` in status response |
| Full Anthropic API NAICS lookup implementation | Intelligence tab as third surface |

**Combined:** ChatGPT's product architecture + my working implementation code + both specs' features.

---

## Non-Negotiable Rules

1. **Do NOT create a third wizard system.** `MemoCompletionWizard` is the qualitative stopgap.
   This is a wrapper and extension layer, not a rebuild.

2. **Never ask the banker for numeric underwriting metrics.** No DSCR, LTV, collateral values,
   financial ratios. Those come from documents only.

3. **Per-step auto-save, not batch-on-submit.** Each wizard step saves immediately so partial
   progress survives a mid-wizard close. `recovery/complete` is a validation gate only,
   not a data write path.

4. **Writes go to source-of-truth tables first.** `borrowers` → `ownership_entities` → `deals`
   → then `deal_memo_overrides` for purely qualitative prose (website, dba, banker_summary).

5. **No destructive principal actions without explicit confirmation.**

---

## What Already Exists — Do Not Rebuild

- `src/components/creditMemo/MemoCompletionWizard.tsx` — qualitative form. Extract its body
  into `MemoQualitativeForm.tsx`. Both wizards share that extracted component.
- `src/app/api/deals/[dealId]/research/flight-deck/route.ts` — superseded by `recovery/status`.
- `RunResearchButton`, `GenerateNarrativesButton`, `RegenerateMemoButton` on the credit memo
  page — "Continue Analysis" orchestrates these in sequence. Do not add separate buttons.

---

## Verified Production Schema

The `borrowers` table has: `legal_name`, `naics_code`, `naics_description`, `city`, `state`,
`address_line1`, `zip`, `entity_type`, `state_of_formation`.

**No `website` or `dba` column exists** → those go to `deal_memo_overrides.overrides`.

---

## Part 1 — `recovery/status` Route

**File: `src/app/api/deals/[dealId]/recovery/status/route.ts`**

This is the single normalized source of truth for the wizard. It determines which steps to show,
pre-fills existing values, and flags both critical errors and recoverable warnings.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type BlockerKey =
  | "missing_naics"
  | "missing_geography"
  | "missing_business_description"
  | "missing_identifying_anchor"
  | "malformed_principal"
  | "placeholder_deal_name"
  | "research_failed"
  | "manual_review_required"
  | "research_not_run";

type Blocker = {
  key: BlockerKey;
  severity: "error" | "warn";
  label: string;
  detail: string;
};

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();

    const [dealRes, missionRes, trustGrade, overridesRes] = await Promise.all([
      (sb as any)
        .from("deals")
        .select("id, display_name, nickname, borrower_name, borrower_id")
        .eq("id", dealId)
        .maybeSingle(),
      (sb as any)
        .from("buddy_research_missions")
        .select("id, status, trust_grade")
        .eq("deal_id", dealId)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadTrustGradeForDeal(dealId),
      (sb as any)
        .from("deal_memo_overrides")
        .select("overrides")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .maybeSingle(),
    ]);

    const deal = dealRes.data;
    const mission = missionRes.data;
    const overrides = (overridesRes.data?.overrides ?? {}) as Record<string, unknown>;

    // Borrower
    let borrower: {
      legal_name: string | null;
      naics_code: string | null;
      naics_description: string | null;
      city: string | null;
      state: string | null;
    } | null = null;

    if (deal?.borrower_id) {
      const { data: b } = await (sb as any)
        .from("borrowers")
        .select("legal_name, naics_code, naics_description, city, state")
        .eq("id", deal.borrower_id)
        .maybeSingle();
      borrower = b ?? null;
    }

    // Ownership entities — flag malformed
    const { data: ownersData } = await (sb as any)
      .from("ownership_entities")
      .select("id, display_name, title, ownership_pct")
      .eq("deal_id", dealId)
      .limit(20);

    const MALFORMED_PATTERNS = /\n|\r|\t|Taxpayer address|taxpayer|undefined|null/i;

    const principals = ((ownersData ?? []) as any[]).map((o: any) => {
      const raw = String(o.display_name ?? "").trim();
      const isMalformed = MALFORMED_PATTERNS.test(raw) || raw.length < 2;
      const normalized = raw.split(/\n/)[0].trim()
        .replace(/\s+/g, " ")
        .replace(/Taxpayer.*$/i, "")
        .trim();
      return {
        id: String(o.id),
        displayName: raw,
        isMalformed,
        normalizedCandidate: isMalformed && normalized.length > 2 ? normalized : null,
      };
    });

    // ── Blocker list ────────────────────────────────────────────────────────
    const blockers: Blocker[] = [];

    const hasNaics = !!borrower?.naics_code && borrower.naics_code !== "999999";
    if (!hasNaics) {
      blockers.push({
        key: "missing_naics",
        severity: "error",
        label: "Industry not identified",
        detail: !borrower?.naics_code
          ? "No industry code on file — BIE cannot run industry or competitive research."
          : "NAICS 999999 is a placeholder — research will fail with this code.",
      });
    }

    const hasGeo = !!(borrower?.city?.trim() || borrower?.state?.trim());
    if (!hasGeo) {
      blockers.push({
        key: "missing_geography",
        severity: "error",
        label: "No market location",
        detail: "City and state are missing — BIE cannot run market or competitive research.",
      });
    }

    const hasDesc = typeof overrides.business_description === "string" &&
      (overrides.business_description as string).trim().length > 20;
    if (!hasDesc) {
      blockers.push({
        key: "missing_business_description",
        severity: "warn",
        label: "Business description missing",
        detail: "Adding a plain-English description dramatically improves research quality.",
      });
    }

    const hasBankerSummary = typeof overrides.banker_summary === "string" &&
      (overrides.banker_summary as string).trim().length > 20;
    const hasWebsite = typeof overrides.website === "string" &&
      (overrides.website as string).trim().length > 5;
    if (!hasBankerSummary && !hasWebsite && !hasDesc) {
      blockers.push({
        key: "missing_identifying_anchor",
        severity: "warn",
        label: "No identifying anchor",
        detail: "A website URL or brief banker summary helps BIE find the right entity.",
      });
    }

    const malformedPrincipals = principals.filter(p => p.isMalformed);
    if (malformedPrincipals.length > 0) {
      blockers.push({
        key: "malformed_principal",
        severity: "warn",
        label: `${malformedPrincipals.length} owner record${malformedPrincipals.length > 1 ? "s need" : " needs"} cleanup`,
        detail: `Malformed name(s): ${malformedPrincipals.map(p => p.displayName.slice(0, 40)).join(", ")}.`,
      });
    }

    const dealName = deal?.display_name || deal?.nickname || deal?.borrower_name || "";
    const PLACEHOLDER_PATTERNS = /^(chatgpt|fix|test|deal \d|new deal|untitled|draft)/i;
    if (PLACEHOLDER_PATTERNS.test(dealName.trim())) {
      blockers.push({
        key: "placeholder_deal_name",
        severity: "warn",
        label: "Placeholder deal name",
        detail: `"${dealName}" looks like a test name — rename it.`,
      });
    }

    if (!mission) {
      blockers.push({
        key: "research_not_run",
        severity: "warn",
        label: "Research not yet run",
        detail: "No intelligence has been gathered for this deal.",
      });
    } else if (trustGrade === "research_failed") {
      blockers.push({
        key: "research_failed",
        severity: "error",
        label: "Research failed",
        detail: "The last run could not confirm the entity. Resolve blockers above and re-run.",
      });
    } else if (trustGrade === "manual_review_required") {
      blockers.push({
        key: "manual_review_required",
        severity: "warn",
        label: "Research needs manual review",
        detail: "Research completed with gaps. Adding more context and re-running may improve trust grade.",
      });
    }

    const criticalBlockers = blockers.filter(b => b.severity === "error");

    // suggestedActions (ChatGPT Sprint 2 shape)
    const suggestedActions: Array<{ key: string; label: string }> = [];
    if (!hasNaics) suggestedActions.push({ key: "set_naics", label: "Set industry code" });
    if (!hasGeo) suggestedActions.push({ key: "set_geography", label: "Add location" });
    if (malformedPrincipals.length > 0) suggestedActions.push({ key: "fix_principals", label: "Clean up owner records" });
    if (!hasDesc) suggestedActions.push({ key: "add_description", label: "Describe the business" });
    suggestedActions.push({ key: "run_research", label: "Run research" });

    return NextResponse.json({
      ok: true,
      deal: {
        id: String(deal?.id ?? dealId),
        name: dealName || null,
        borrowerId: deal?.borrower_id ?? null,
        borrowerName: deal?.borrower_name ?? null,
      },
      blockers,
      hasCriticalBlockers: criticalBlockers.length > 0,
      // Trigger wizard for critical blockers OR manual_review_required
      shouldShowWizard: criticalBlockers.length > 0 || trustGrade === "manual_review_required",
      isReadyForResearch: criticalBlockers.length === 0,
      borrower: {
        legalName: borrower?.legal_name ?? null,
        naicsCode: borrower?.naics_code ?? null,
        naicsDescription: borrower?.naics_description ?? null,
        city: borrower?.city ?? null,
        state: borrower?.state ?? null,
        // website has no borrowers column — read from overrides
        website: typeof overrides.website === "string" ? overrides.website : null,
      },
      principals,
      overrides,
      suggestedActions,
      trustGrade,
      researchStatus: mission?.status ?? null,
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
```

---

## Part 2 — `borrower/update` Route

**File: `src/app/api/deals/[dealId]/borrower/update/route.ts`**

Per-step save. Called after each wizard step. Does NOT need to be called atomically —
data is written immediately on step confirmation for resilience.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BodySchema = z.object({
  // borrowers table (verified schema — no website or dba column)
  naics_code: z.string().min(2).max(10).optional(),
  naics_description: z.string().min(2).max(300).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  legal_name: z.string().min(2).max(200).optional(),
  address_line1: z.string().max(300).optional(),
  // deal_memo_overrides (no column in borrowers)
  banker_summary: z.string().max(3000).optional(),
  website: z.string().max(500).optional(),
  dba: z.string().max(200).optional(),
  business_description: z.string().max(3000).optional(),
  revenue_mix: z.string().max(1000).optional(),
  seasonality: z.string().max(500).optional(),
  collateral_description: z.string().max(1000).optional(),
  collateral_address: z.string().max(300).optional(),
  competitive_advantages: z.string().max(1000).optional(),
  vision: z.string().max(1000).optional(),
  // deal name
  deal_name: z.string().max(200).optional(),
}).passthrough(); // allow principal_bio_* keys

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = BodySchema.parse(await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const { data: deal } = await (sb as any)
      .from("deals")
      .select("borrower_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal?.borrower_id) {
      return NextResponse.json({ ok: false, error: "no_borrower_linked" }, { status: 400 });
    }

    // Borrower table patch (only verified columns)
    const BORROWER_COLUMNS = ["naics_code", "naics_description", "city", "state", "legal_name", "address_line1"];
    const borrowerPatch: Record<string, string> = {};
    for (const col of BORROWER_COLUMNS) {
      if (body[col] !== undefined) borrowerPatch[col] = body[col] as string;
    }

    if (Object.keys(borrowerPatch).length > 0) {
      const { error } = await (sb as any)
        .from("borrowers")
        .update(borrowerPatch)
        .eq("id", deal.borrower_id);
      if (error) {
        return NextResponse.json({ ok: false, error: "update_failed", detail: error.message }, { status: 500 });
      }
    }

    // Overrides patch: everything that isn't a borrower column or deal_name
    const OVERRIDE_SKIP = new Set([...BORROWER_COLUMNS, "deal_name"]);
    const overridesPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!OVERRIDE_SKIP.has(k) && v !== undefined) {
        overridesPatch[k] = v;
      }
    }

    if (Object.keys(overridesPatch).length > 0) {
      const { data: existing } = await (sb as any)
        .from("deal_memo_overrides")
        .select("overrides")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .maybeSingle();

      const merged = { ...(existing?.overrides ?? {}), ...overridesPatch };
      await (sb as any)
        .from("deal_memo_overrides")
        .upsert(
          { deal_id: dealId, bank_id: access.bankId, overrides: merged },
          { onConflict: "deal_id,bank_id" },
        );
    }

    if (typeof body.deal_name === "string") {
      await (sb as any)
        .from("deals")
        .update({ display_name: (body.deal_name as string).trim() })
        .eq("id", dealId);
    }

    void writeEvent({
      dealId,
      kind: "deal.borrower.recovery_wizard_updated",
      actorUserId: access.userId,
      scope: "borrower",
      meta: {
        borrower_fields: Object.keys(borrowerPatch),
        override_fields: Object.keys(overridesPatch),
        renamed: body.deal_name !== undefined,
      },
    });

    return NextResponse.json({ ok: true, updated: { borrower: Object.keys(borrowerPatch), overrides: Object.keys(overridesPatch) } });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
```

---

## Part 3 — `recovery/naics-suggest` Route

**File: `src/app/api/deals/[dealId]/recovery/naics-suggest/route.ts`**

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({
  business_description: z.string().min(10).max(2000),
  company_name: z.string().max(200).optional(),
});

type NaicsSuggestion = {
  naics_code: string;
  naics_description: string;
  confidence: number;
  rationale: string;
};

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "no_api_key" }, { status: 500 });
    }

    const prompt = `You are a commercial bank underwriter. Return the 3 most likely 6-digit NAICS codes
for the following business. Use only real codes from the 2022 NAICS manual.

Company: ${body.company_name ?? "Not specified"}
Description: ${body.business_description}

Return ONLY valid JSON — no markdown, no preamble, no explanation outside the JSON:
{
  "suggestions": [
    {
      "naics_code": "531311",
      "naics_description": "Residential Property Managers",
      "confidence": 0.90,
      "rationale": "One sentence explaining the fit"
    }
  ]
}

Rules:
- Exactly 3 suggestions ordered best-first
- confidence is 0.0–1.0 (decimal, not a string label)
- rationale is one plain-English sentence`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: "ai_error" }, { status: 500 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    let suggestions: NaicsSuggestion[] = [];
    try {
      const clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
      suggestions = JSON.parse(clean).suggestions ?? [];
    } catch {
      return NextResponse.json({ ok: false, error: "parse_error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, suggestions });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
```

---

## Part 4 — `recovery/principals` Route

**File: `src/app/api/deals/[dealId]/recovery/principals/route.ts`**

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BodySchema = z.object({
  actions: z.array(z.object({
    id: z.string().uuid(),
    action: z.enum(["rename", "keep"]),
    new_name: z.string().min(2).max(200).optional(),
  })),
});

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const results: Array<{ id: string; action: string; ok: boolean }> = [];

    for (const item of body.actions) {
      if (item.action === "rename" && item.new_name) {
        const { error } = await (sb as any)
          .from("ownership_entities")
          .update({ display_name: item.new_name.trim() })
          .eq("id", item.id)
          .eq("deal_id", dealId); // Safety: only update if belongs to this deal
        results.push({ id: item.id, action: "rename", ok: !error });
      } else {
        results.push({ id: item.id, action: "keep", ok: true });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
```

---

## Part 5 — `recovery/complete` Route (ChatGPT Sprint 7)

**File: `src/app/api/deals/[dealId]/recovery/complete/route.ts`**

This is a **validation gate**, not a data write path. Called by the wizard on the Review/Launch
step before research fires. It reads current DB state (data was already written per-step) and
returns whether required fields are present and what should run next.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();

    // Read current state from DB — don't trust request body
    const [dealRes, overridesRes] = await Promise.all([
      (sb as any)
        .from("deals")
        .select("borrower_id")
        .eq("id", dealId)
        .maybeSingle(),
      (sb as any)
        .from("deal_memo_overrides")
        .select("overrides")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .maybeSingle(),
    ]);

    const overrides = (overridesRes.data?.overrides ?? {}) as Record<string, unknown>;

    let borrower: { naics_code: string | null; city: string | null; state: string | null } | null = null;
    if (dealRes.data?.borrower_id) {
      const { data: b } = await (sb as any)
        .from("borrowers")
        .select("naics_code, city, state")
        .eq("id", dealRes.data.borrower_id)
        .maybeSingle();
      borrower = b ?? null;
    }

    const hasNaics = !!borrower?.naics_code && borrower.naics_code !== "999999";
    const hasGeo = !!(borrower?.city?.trim() || borrower?.state?.trim());

    const validationErrors: string[] = [];
    if (!hasNaics) validationErrors.push("Industry code is still missing — complete the Industry step.");
    if (!hasGeo) validationErrors.push("Location is still missing — complete the Location step.");

    if (validationErrors.length > 0) {
      return NextResponse.json({ ok: false, validation_errors: validationErrors }, { status: 422 });
    }

    const hasDesc = typeof overrides.business_description === "string" &&
      (overrides.business_description as string).trim().length > 20;

    const actionsTaken: string[] = ["borrower_verified", "overrides_verified"];

    return NextResponse.json({
      ok: true,
      actions_taken: actionsTaken,
      next: {
        should_run_research: true,
        should_regenerate_memo: true,
        should_run_risk: false,
        has_business_description: hasDesc,
      },
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
```

---

## Part 6 — Extract `MemoQualitativeForm`

**File: `src/components/creditMemo/MemoQualitativeForm.tsx`**

Extracted from `MemoCompletionWizard`. Both the wizard and the existing memo wizard share this.

```tsx
"use client";

import React from "react";

const fieldStyleLight: React.CSSProperties = { color: "#111827", backgroundColor: "#ffffff" };

const baseLightCls =
  "w-full text-sm border border-gray-300 rounded-md px-3 py-2 " +
  "placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none";

export type QualitativeOverrides = {
  business_description?: string;
  revenue_mix?: string;
  seasonality?: string;
  collateral_description?: string;
  collateral_address?: string;
  competitive_advantages?: string;
  vision?: string;
  [key: string]: string | undefined;
};

type Props = {
  overrides: QualitativeOverrides;
  onChange: (key: string, value: string) => void;
  principals: Array<{ id: string; name: string }>;
  theme?: "dark" | "light";
};

export function MemoQualitativeForm({ overrides, onChange, principals, theme = "light" }: Props) {
  const isDark = theme === "dark";
  const mgmtEntries = principals.length > 0 ? principals : [{ id: "general", name: "Management Team" }];

  const inputCls = isDark
    ? "w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 resize-none leading-relaxed"
    : baseLightCls;
  const labelCls = isDark ? "block text-xs font-medium text-white/60 mb-1" : "block text-xs font-medium text-gray-700 mb-1";
  const hintCls = isDark ? "text-xs text-white/30 mb-2" : "text-xs text-gray-400 mb-2";
  const headCls = isDark ? "text-xs font-semibold text-white/40 uppercase tracking-widest mb-3" : "text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3";
  const style = isDark ? undefined : fieldStyleLight;

  return (
    <div className="space-y-5">
      <div>
        <div className={headCls}>Business Profile</div>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Business Operations & History</label>
            <p className={hintCls}>Who is the borrower, what do they do, how long have they operated?</p>
            <textarea rows={4} value={overrides.business_description ?? ""} onChange={e => onChange("business_description", e.target.value)}
              placeholder="e.g. Samaritus Management LLC operates Yacht Hampton, a luxury boat charter business founded in 2017 in Sag Harbor, NY..."
              className={inputCls} style={style} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Revenue Mix</label>
              <textarea rows={3} value={overrides.revenue_mix ?? ""} onChange={e => onChange("revenue_mix", e.target.value)}
                placeholder="e.g. 60% boat rentals, 30% corporate events, 10% sailing lessons" className={inputCls} style={style} />
            </div>
            <div>
              <label className={labelCls}>Seasonality</label>
              <textarea rows={3} value={overrides.seasonality ?? ""} onChange={e => onChange("seasonality", e.target.value)}
                placeholder="e.g. Peak May–Sep (85% of revenue)" className={inputCls} style={style} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className={headCls}>Collateral</div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Collateral Description</label>
            <textarea rows={3} value={overrides.collateral_description ?? ""} onChange={e => onChange("collateral_description", e.target.value)}
              placeholder="e.g. 2023 Aquila 36 catamaran maintained at Sag Harbor Marina..." className={inputCls} style={style} />
          </div>
          <div>
            <label className={labelCls}>Collateral Address</label>
            <input type="text" value={overrides.collateral_address ?? ""} onChange={e => onChange("collateral_address", e.target.value)}
              placeholder="e.g. 31 Bay St, Sag Harbor, NY 11963" className={inputCls} style={style} />
          </div>
        </div>
      </div>

      <div>
        <div className={headCls}>Management Qualifications</div>
        <div className="space-y-4">
          {mgmtEntries.map(p => (
            <div key={p.id}>
              <label className={labelCls}>{p.name}</label>
              <textarea rows={4} value={overrides[`principal_bio_${p.id}`] ?? ""}
                onChange={e => onChange(`principal_bio_${p.id}`, e.target.value)}
                placeholder={`Career background, industry experience, track record for ${p.name}...`}
                className={inputCls} style={style} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className={headCls}>Business Strategy</div>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Competitive Advantages</label>
            <textarea rows={3} value={overrides.competitive_advantages ?? ""} onChange={e => onChange("competitive_advantages", e.target.value)}
              placeholder="e.g. Exclusive marina berthing, repeat corporate clientele" className={inputCls} style={style} />
          </div>
          <div>
            <label className={labelCls}>Vision & Growth Strategy</label>
            <textarea rows={3} value={overrides.vision ?? ""} onChange={e => onChange("vision", e.target.value)}
              placeholder="e.g. Expand fleet by 3 vessels, launch electric-only charter tier" className={inputCls} style={style} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Then update `MemoCompletionWizard.tsx`**: import `MemoQualitativeForm`, replace form body
with `<MemoQualitativeForm overrides={overrides} onChange={set} principals={mgmtEntries} theme="light" />`.
Keep all save/close/header/footer logic unchanged.

---

## Part 7 — `IgniteWizard` Component

**File: `src/components/deals/IgniteWizard.tsx`**

Complete dark-themed multi-step modal. Steps built dynamically from `recovery/status`.
Includes: Industry, Location, Deal Name (conditional), Owners (conditional), Business Context,
**Review** (summary), Continue Analysis.

```tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { MemoQualitativeForm } from "@/components/creditMemo/MemoQualitativeForm";
import type { QualitativeOverrides } from "@/components/creditMemo/MemoQualitativeForm";

// ─── Types ────────────────────────────────────────────────────
type NaicsSuggestion = {
  naics_code: string;
  naics_description: string;
  confidence: number;
  rationale: string;
};

type Principal = {
  id: string;
  displayName: string;
  isMalformed: boolean;
  normalizedCandidate: string | null;
};

type WizardStep = {
  id: string;
  label: string;
  icon: string;
  status: "pending" | "active" | "done";
  required: boolean;
};

type RecoveryStatus = {
  deal: { id: string; name: string | null; borrowerName: string | null };
  blockers: Array<{ key: string; severity: string; label: string; detail: string }>;
  hasCriticalBlockers: boolean;
  shouldShowWizard: boolean;
  borrower: {
    legalName: string | null;
    naicsCode: string | null;
    naicsDescription: string | null;
    city: string | null;
    state: string | null;
    website: string | null;
  };
  principals: Principal[];
  overrides: Record<string, unknown>;
  trustGrade: string | null;
};

// ─── Step builder ─────────────────────────────────────────────
function buildSteps(status: RecoveryStatus): WizardStep[] {
  const steps: WizardStep[] = [];
  const keys = new Set(status.blockers.map(b => b.key));

  if (keys.has("missing_naics")) {
    steps.push({ id: "industry", label: "Industry", icon: "category", status: "pending", required: true });
  }
  if (keys.has("missing_geography")) {
    steps.push({ id: "location", label: "Location", icon: "location_on", status: "pending", required: true });
  }
  if (keys.has("placeholder_deal_name")) {
    steps.push({ id: "name", label: "Deal Name", icon: "edit", status: "pending", required: false });
  }
  if (keys.has("malformed_principal")) {
    steps.push({ id: "owners", label: "Owners", icon: "people", status: "pending", required: true });
  }
  // Business context and review are always included
  steps.push({ id: "context", label: "Business Context", icon: "description", status: "pending", required: false });
  steps.push({ id: "review", label: "Review", icon: "fact_check", status: "pending", required: true });
  steps.push({ id: "launch", label: "Continue Analysis", icon: "rocket_launch", status: "pending", required: true });

  return steps.map((s, i) => ({ ...s, status: i === 0 ? "active" : "pending" }));
}

// ─── Main Component ───────────────────────────────────────────
export function IgniteWizard({
  dealId,
  onComplete,
  onClose,
}: {
  dealId: string;
  onComplete?: () => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [steps, setSteps] = useState<WizardStep[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "validating" | "running_research" | "generating_memo" | "done">("idle");

  // Per-step state
  const [businessDescription, setBusinessDescription] = useState("");
  const [naicsSuggestions, setNaicsSuggestions] = useState<NaicsSuggestion[]>([]);
  const [naicsLoading, setNaicsLoading] = useState(false);
  const [selectedNaics, setSelectedNaics] = useState<NaicsSuggestion | null>(null);
  const [manualNaicsCode, setManualNaicsCode] = useState("");
  const [manualNaicsDesc, setManualNaicsDesc] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [dealName, setDealName] = useState("");
  const [principalActions, setPrincipalActions] = useState<
    Record<string, { action: "rename" | "keep"; newName: string }>
  >({});
  const [overrides, setOverrides] = useState<QualitativeOverrides>({});

  // Track what was saved per-step for the Review summary
  const [savedSummary, setSavedSummary] = useState<{
    naics?: string;
    naicsDesc?: string;
    location?: string;
    ownersFixed?: number;
    hasContext?: boolean;
  }>({});

  useEffect(() => {
    fetch(`/api/deals/${dealId}/recovery/status`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setStatus(data);
          setSteps(buildSteps(data));
          setCity(data.borrower.city ?? "");
          setStateVal(data.borrower.state ?? "");
          setDealName(data.deal.name ?? "");
          setOverrides((data.overrides ?? {}) as QualitativeOverrides);
          const acts: Record<string, { action: "rename" | "keep"; newName: string }> = {};
          for (const p of data.principals) {
            acts[p.id] = {
              action: p.isMalformed && p.normalizedCandidate ? "rename" : "keep",
              newName: p.normalizedCandidate ?? p.displayName,
            };
          }
          setPrincipalActions(acts);
        } else {
          setError("Failed to load deal state");
        }
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }, [dealId]);

  const currentStep = steps[stepIdx];
  const progress = steps.length > 0
    ? Math.round((steps.filter(s => s.status === "done").length / steps.length) * 100)
    : 0;

  const advance = useCallback(() => {
    setSteps(prev => prev.map((s, i) => {
      if (i === stepIdx) return { ...s, status: "done" };
      if (i === stepIdx + 1) return { ...s, status: "active" };
      return s;
    }));
    setStepIdx(i => i + 1);
    setError(null);
  }, [stepIdx]);

  const saveAndAdvance = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/borrower/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Save failed"); return; }
      advance();
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }, [dealId, advance]);

  const lookupNaics = useCallback(async () => {
    if (businessDescription.trim().length < 15) { setError("Describe the business in a bit more detail"); return; }
    setNaicsLoading(true);
    setNaicsSuggestions([]);
    setSelectedNaics(null);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/recovery/naics-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_description: businessDescription,
          company_name: status?.borrower.legalName ?? status?.deal.borrowerName ?? undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError("Couldn't look up industry — try again"); return; }
      setNaicsSuggestions(data.suggestions ?? []);
    } catch { setError("Network error"); }
    finally { setNaicsLoading(false); }
  }, [businessDescription, dealId, status]);

  const savePrincipals = useCallback(async () => {
    setSaving(true);
    try {
      const actions = Object.entries(principalActions).map(([id, v]) => ({
        id, action: v.action, new_name: v.action === "rename" ? v.newName : undefined,
      }));
      await fetch(`/api/deals/${dealId}/recovery/principals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions }),
      });
      const fixed = actions.filter(a => a.action === "rename").length;
      setSavedSummary(prev => ({ ...prev, ownersFixed: fixed }));
      advance();
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }, [principalActions, dealId, advance]);

  const saveContext = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/deals/${dealId}/borrower/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overrides),
      });
      setSavedSummary(prev => ({
        ...prev,
        hasContext: typeof overrides.business_description === "string" && overrides.business_description.length > 20,
      }));
    } catch {}
    finally { setSaving(false); }
    advance();
  }, [overrides, dealId, advance]);

  // "Continue Analysis": validate → research → memo
  const continueAnalysis = useCallback(async () => {
    setPhase("validating");
    setError(null);
    try {
      // Step 1: server-side validation gate (ChatGPT Sprint 7)
      const validateRes = await fetch(`/api/deals/${dealId}/recovery/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const validateData = await validateRes.json();
      if (!validateData.ok) {
        const errs: string[] = validateData.validation_errors ?? [validateData.error ?? "Validation failed"];
        setError(errs.join(" · "));
        setPhase("idle");
        return;
      }

      // Step 2: fire research
      setPhase("running_research");
      const researchRes = await fetch(`/api/deals/${dealId}/research/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const researchData = await researchRes.json();
      if (!researchData.ok) {
        setError(researchData.error ?? "Research launch failed");
        setPhase("idle");
        return;
      }

      // Step 3: non-blocking memo regenerate
      setPhase("generating_memo");
      fetch(`/api/deals/${dealId}/credit-memo/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});

      setPhase("done");
      setSteps(prev => prev.map((s, i) => i === stepIdx ? { ...s, status: "done" } : s));
      setTimeout(() => { onComplete?.(); onClose(); }, 2500);
    } catch {
      setError("Failed to launch analysis");
      setPhase("idle");
    }
  }, [dealId, stepIdx, onComplete, onClose]);

  // ─── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="text-white/50 text-sm animate-pulse">Loading deal state...</div>
      </div>
    );
  }

  const malformedPrincipals = status?.principals.filter(p => p.isMalformed) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        className="bg-[#0f1117] border border-white/10 rounded-2xl w-full shadow-2xl flex overflow-hidden"
        style={{ maxWidth: 900, maxHeight: "calc(100vh - 2rem)", minHeight: 540 }}
      >
        {/* ── Left Rail ─────────────────────────────────────── */}
        <div className="w-52 bg-[#0a0c12] border-r border-white/[0.06] flex flex-col py-6 flex-shrink-0">
          <div className="px-5 mb-6">
            <div className="text-xs font-bold text-white/80 uppercase tracking-widest">🚀 Ignite</div>
            <div className="text-[10px] text-white/30 mt-0.5">Research Readiness</div>
          </div>
          <div className="flex-1 px-3 space-y-1">
            {steps.map((step, i) => {
              const isActive = i === stepIdx;
              const isDone = step.status === "done";
              return (
                <div key={step.id} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all ${
                  isActive ? "bg-sky-500/15 border border-sky-500/30" : isDone ? "opacity-50" : "opacity-25"
                }`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                    isDone ? "bg-emerald-500 text-white" : isActive ? "bg-sky-500 text-white" : "bg-white/10 text-white/40"
                  }`}>
                    {isDone ? "✓" : isActive
                      ? <span className="material-symbols-outlined text-[12px]">{step.icon}</span>
                      : i + 1}
                  </div>
                  <div className={`text-xs font-medium ${isActive ? "text-white" : "text-white/50"}`}>
                    {step.label}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-5 mt-4">
            <div className="flex justify-between text-[10px] text-white/30 mb-1.5">
              <span>Progress</span><span>{progress}%</span>
            </div>
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-700"
                style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        {/* ── Content ───────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-8 py-5 border-b border-white/[0.06]">
            <div>
              <div className="text-base font-semibold text-white">{currentStep?.label ?? "Complete"}</div>
              <div className="text-xs text-white/40 mt-0.5">
                {status?.deal.borrowerName ?? status?.deal.name ?? dealId} ·
                Step {Math.min(stepIdx + 1, steps.length)} of {steps.length}
              </div>
            </div>
            <button onClick={onClose} className="text-white/30 hover:text-white/60 text-lg">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-6">
            {error && (
              <div className="mb-4 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {/* ── Industry ───────────────────────────────────── */}
            {currentStep?.id === "industry" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Tell Buddy what this business does</div>
                  <div className="text-xs text-white/40 mb-3">
                    Write a sentence or two in plain English — Buddy finds the right industry code.
                  </div>
                  <textarea rows={4} value={businessDescription}
                    onChange={e => { setBusinessDescription(e.target.value); setNaicsSuggestions([]); setSelectedNaics(null); }}
                    placeholder="e.g. Luxury yacht charter and boat rental business serving corporate and leisure clients in the Hamptons, NY..."
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 resize-none leading-relaxed"
                  />
                </div>
                <button onClick={lookupNaics}
                  disabled={naicsLoading || businessDescription.trim().length < 15}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    naicsLoading ? "bg-white/5 text-white/30 cursor-wait"
                    : businessDescription.trim().length < 15 ? "bg-white/5 text-white/20 cursor-not-allowed"
                    : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                  }`}
                >
                  {naicsLoading
                    ? <><span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span> Buddy is thinking...</>
                    : <><span className="material-symbols-outlined text-[16px]">auto_awesome</span> Find Industry Code</>}
                </button>

                {naicsSuggestions.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">
                      Buddy's suggestions — pick one
                    </div>
                    {naicsSuggestions.map(s => (
                      <button key={s.naics_code} onClick={() => setSelectedNaics(s)}
                        className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all ${
                          selectedNaics?.naics_code === s.naics_code
                            ? "border-sky-500/60 bg-sky-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm font-bold text-white">{s.naics_code}</span>
                            <span className="text-sm text-white/80">{s.naics_description}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-semibold ${s.confidence >= 0.7 ? "text-emerald-400" : s.confidence >= 0.4 ? "text-amber-400" : "text-white/30"}`}>
                              {Math.round(s.confidence * 100)}%
                            </span>
                            {selectedNaics?.naics_code === s.naics_code && (
                              <span className="text-sky-400 material-symbols-outlined text-[18px]">check_circle</span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-white/40 mt-1.5 leading-relaxed">{s.rationale}</div>
                      </button>
                    ))}
                    <button onClick={() => setSelectedNaics({ naics_code: "", naics_description: "", confidence: 0, rationale: "" })}
                      className="text-xs text-white/30 hover:text-white/50 mt-1 transition-colors">
                      Enter a code manually instead →
                    </button>
                  </div>
                )}

                {selectedNaics?.naics_code === "" && (
                  <div className="flex gap-3">
                    <input type="text" maxLength={6} placeholder="6-digit code" value={manualNaicsCode}
                      onChange={e => setManualNaicsCode(e.target.value)}
                      className="w-32 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                    <input type="text" placeholder="Industry description" value={manualNaicsDesc}
                      onChange={e => setManualNaicsDesc(e.target.value)}
                      className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                  </div>
                )}
              </div>
            )}

            {/* ── Location ───────────────────────────────────── */}
            {currentStep?.id === "location" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Where does this business operate?</div>
                  <div className="text-xs text-white/40 mb-4">Buddy needs a market location to run local economic and competitive research.</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-white/50 font-medium mb-1.5 block">City</label>
                      <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Sag Harbor"
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                    </div>
                    <div>
                      <label className="text-xs text-white/50 font-medium mb-1.5 block">State</label>
                      <input type="text" value={stateVal} onChange={e => setStateVal(e.target.value.toUpperCase())} placeholder="NY" maxLength={2}
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 uppercase" />
                    </div>
                  </div>
                </div>
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 text-xs text-white/40 leading-relaxed">
                  <span className="text-white/60 font-medium">Why this matters: </span>
                  Without a market location, Buddy cannot analyze competitive dynamics, identify
                  local employment conditions, or benchmark real estate collateral markets.
                </div>
              </div>
            )}

            {/* ── Deal Name ──────────────────────────────────── */}
            {currentStep?.id === "name" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Give this deal a real name</div>
                  <div className="text-xs text-white/40 mb-4">Current name looks like a test artifact. Use the borrower name or a short descriptor.</div>
                  <input type="text" value={dealName} onChange={e => setDealName(e.target.value)}
                    placeholder="e.g. SAMARITUS MANAGEMENT LLC — $500K Equipment"
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                </div>
              </div>
            )}

            {/* ── Owners ─────────────────────────────────────── */}
            {currentStep?.id === "owners" && (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-white mb-1">One owner record needs cleanup</div>
                  <div className="text-xs text-white/40 mb-4">
                    Buddy detected imported data mixed in with the owner name. Confirm the correct name below.
                  </div>
                </div>
                {malformedPrincipals.map(p => (
                  <div key={p.id} className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-4">
                    <div className="text-xs text-amber-400 font-semibold mb-2 uppercase tracking-wide">⚠ Malformed record</div>
                    <div className="text-xs text-white/30 font-mono mb-3 line-through">
                      {p.displayName.slice(0, 80)}{p.displayName.length > 80 ? "..." : ""}
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-white/50 font-medium block">Corrected name</label>
                      <input type="text"
                        value={principalActions[p.id]?.newName ?? p.normalizedCandidate ?? ""}
                        onChange={e => setPrincipalActions(prev => ({
                          ...prev, [p.id]: { action: "rename", newName: e.target.value }
                        }))}
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50"
                      />
                      <button onClick={() => setPrincipalActions(prev => ({
                        ...prev, [p.id]: { action: "keep", newName: p.displayName }
                      }))} className="text-xs text-white/25 hover:text-white/40 transition-colors">
                        Keep original (not recommended)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Business Context ───────────────────────────── */}
            {currentStep?.id === "context" && (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Add context Buddy can't get from documents</div>
                  <div className="text-xs text-white/40 mb-4">
                    Optional but makes research dramatically better. No financial metrics — just what you know from conversations.
                  </div>
                </div>
                <MemoQualitativeForm
                  overrides={overrides}
                  onChange={(key, val) => setOverrides(prev => ({ ...prev, [key]: val }))}
                  principals={status?.principals
                    .filter(p => !p.isMalformed)
                    .map(p => ({ id: p.id, name: principalActions[p.id]?.newName ?? p.displayName })) ?? []}
                  theme="dark"
                />
              </div>
            )}

            {/* ── Review (ChatGPT Sprint 10) ──────────────────── */}
            {currentStep?.id === "review" && (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Looking good — here's what Buddy knows</div>
                  <div className="text-xs text-white/40 mb-4">
                    Review what was collected, then launch research.
                  </div>
                </div>
                <div className="space-y-2">
                  {/* Industry */}
                  {savedSummary.naics ? (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-emerald-400 material-symbols-outlined text-[16px] mt-0.5">check_circle</span>
                      <div>
                        <div className="text-xs font-semibold text-white">Industry</div>
                        <div className="text-xs text-white/50">{savedSummary.naics} — {savedSummary.naicsDesc}</div>
                      </div>
                    </div>
                  ) : status?.borrower.naicsCode && status.borrower.naicsCode !== "999999" ? (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-emerald-400 material-symbols-outlined text-[16px] mt-0.5">check_circle</span>
                      <div>
                        <div className="text-xs font-semibold text-white">Industry</div>
                        <div className="text-xs text-white/50">{status.borrower.naicsCode} — {status.borrower.naicsDescription ?? "Industry classified"}</div>
                      </div>
                    </div>
                  ) : null}

                  {/* Location */}
                  {(city || stateVal || status?.borrower.city || status?.borrower.state) && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-emerald-400 material-symbols-outlined text-[16px] mt-0.5">check_circle</span>
                      <div>
                        <div className="text-xs font-semibold text-white">Location</div>
                        <div className="text-xs text-white/50">
                          {city || status?.borrower.city}, {stateVal || status?.borrower.state}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Owners */}
                  {(savedSummary.ownersFixed ?? 0) > 0 && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-emerald-400 material-symbols-outlined text-[16px] mt-0.5">check_circle</span>
                      <div>
                        <div className="text-xs font-semibold text-white">Owner Records</div>
                        <div className="text-xs text-white/50">{savedSummary.ownersFixed} record{(savedSummary.ownersFixed ?? 0) > 1 ? "s" : ""} cleaned up</div>
                      </div>
                    </div>
                  )}

                  {/* Context */}
                  <div className={`flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border ${savedSummary.hasContext ? "border-white/[0.06]" : "border-white/[0.04]"}`}>
                    <span className={`material-symbols-outlined text-[16px] mt-0.5 ${savedSummary.hasContext ? "text-emerald-400" : "text-white/20"}`}>
                      {savedSummary.hasContext ? "check_circle" : "radio_button_unchecked"}
                    </span>
                    <div>
                      <div className={`text-xs font-semibold ${savedSummary.hasContext ? "text-white" : "text-white/40"}`}>Business Context</div>
                      <div className="text-xs text-white/40">
                        {savedSummary.hasContext ? "Business description added" : "Skipped — research will use documents only"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 text-xs text-white/40 leading-relaxed space-y-1">
                  <div className="text-white/60 font-medium mb-1.5">What Buddy will do next:</div>
                  <div>→ Confirm entity identity for {status?.borrower.legalName ?? "borrower"}</div>
                  <div>→ 6 parallel intelligence threads (borrower, management, competitive, market, industry, transaction)</div>
                  <div>→ Synthesis + 8 adversarial contradiction checks</div>
                  <div>→ Trust grade across 9 gates · Memo regenerated</div>
                  <div className="text-white/30 mt-2">~60–90 seconds. Results appear in the Intelligence tab.</div>
                </div>
              </div>
            )}

            {/* ── Launch ─────────────────────────────────────── */}
            {currentStep?.id === "launch" && (
              <div className="space-y-5">
                {phase === "done" ? (
                  <div className="text-center py-10">
                    <div className="text-5xl mb-4">🚀</div>
                    <div className="text-lg font-bold text-white mb-2">Research Launched!</div>
                    <div className="text-sm text-white/40">Check the Intelligence tab in about 60–90 seconds.</div>
                  </div>
                ) : (
                  <>
                    {phase === "validating" && (
                      <div className="flex items-center gap-2 text-sm text-white/50">
                        <span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span>
                        Validating readiness...
                      </div>
                    )}
                    {phase === "running_research" && (
                      <div className="flex items-center gap-2 text-sm text-sky-400">
                        <span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span>
                        Running research...
                      </div>
                    )}
                    {phase === "generating_memo" && (
                      <div className="flex items-center gap-2 text-sm text-violet-400">
                        <span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span>
                        Regenerating memo...
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────────── */}
          {phase === "idle" && (
            <div className="flex items-center justify-between px-8 py-5 border-t border-white/[0.06]">
              <button
                onClick={() => {
                  if (stepIdx > 0) {
                    setSteps(prev => prev.map((s, i) => {
                      if (i === stepIdx) return { ...s, status: "pending" };
                      if (i === stepIdx - 1) return { ...s, status: "active" };
                      return s;
                    }));
                    setStepIdx(i => i - 1);
                  }
                }}
                disabled={stepIdx === 0}
                className="text-xs text-white/30 hover:text-white/60 disabled:opacity-0 transition-colors"
              >
                ← Back
              </button>
              <div className="flex items-center gap-3">
                {currentStep && !currentStep.required && !["launch", "review"].includes(currentStep.id) && (
                  <button onClick={advance} className="text-xs text-white/30 hover:text-white/50 px-3 py-2 transition-colors">
                    Skip for now
                  </button>
                )}

                {currentStep?.id === "industry" && (
                  <button
                    onClick={() => {
                      const code = selectedNaics?.naics_code === "" ? manualNaicsCode : selectedNaics?.naics_code;
                      const desc = selectedNaics?.naics_code === "" ? manualNaicsDesc : selectedNaics?.naics_description;
                      if (!code) { setError("Select or enter an industry code"); return; }
                      setSavedSummary(prev => ({ ...prev, naics: code, naicsDesc: desc ?? "" }));
                      saveAndAdvance({ naics_code: code, naics_description: desc ?? "",
                        banker_summary: businessDescription.length > 20 ? businessDescription : undefined });
                    }}
                    disabled={(!selectedNaics && !manualNaicsCode) || saving}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      (!selectedNaics && !manualNaicsCode) || saving
                        ? "bg-white/5 text-white/25 cursor-not-allowed"
                        : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                    }`}
                  >
                    {saving ? "Saving..." : "Confirm Industry →"}
                  </button>
                )}

                {currentStep?.id === "location" && (
                  <button
                    onClick={() => {
                      if (!city.trim() && !stateVal.trim()) { setError("Enter at least a city or state"); return; }
                      setSavedSummary(prev => ({ ...prev }));
                      saveAndAdvance({ city: city.trim(), state: stateVal.trim() });
                    }}
                    disabled={(!city.trim() && !stateVal.trim()) || saving}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      (!city.trim() && !stateVal.trim()) || saving
                        ? "bg-white/5 text-white/25 cursor-not-allowed"
                        : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                    }`}
                  >
                    {saving ? "Saving..." : "Confirm Location →"}
                  </button>
                )}

                {currentStep?.id === "name" && (
                  <button
                    onClick={() => {
                      if (dealName.trim().length < 3) { setError("Enter a meaningful deal name"); return; }
                      saveAndAdvance({ deal_name: dealName.trim() });
                    }}
                    disabled={dealName.trim().length < 3 || saving}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      dealName.trim().length < 3 || saving
                        ? "bg-white/5 text-white/25 cursor-not-allowed"
                        : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                    }`}
                  >
                    {saving ? "Saving..." : "Rename →"}
                  </button>
                )}

                {currentStep?.id === "owners" && (
                  <button onClick={savePrincipals} disabled={saving}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 transition-all">
                    {saving ? "Saving..." : "Fix Owner Records →"}
                  </button>
                )}

                {currentStep?.id === "context" && (
                  <button onClick={saveContext} disabled={saving}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 transition-all">
                    {saving ? "Saving..." : "Save & Continue →"}
                  </button>
                )}

                {currentStep?.id === "review" && (
                  <button onClick={advance}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 transition-all">
                    Looks good — continue →
                  </button>
                )}

                {currentStep?.id === "launch" && phase === "idle" && (
                  <button onClick={continueAnalysis}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-sky-500 to-violet-500 hover:from-sky-400 hover:to-violet-400 text-white shadow-xl shadow-sky-500/25 transition-all">
                    <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
                    Continue Analysis
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## Part 8 — Wire Into Existing UI

### Auto-trigger (ChatGPT Sprint 9 + fix)

Use `shouldShowWizard` from `recovery/status` — fires on critical blockers **or**
`manual_review_required`. Add to **Builder page**, **Credit Memo page**, and optionally
**Intelligence tab**.

```typescript
import { IgniteWizard } from "@/components/deals/IgniteWizard";

const [igniteOpen, setIgniteOpen] = useState(false);

useEffect(() => {
  fetch(`/api/deals/${dealId}/recovery/status`)
    .then(r => r.json())
    .then(d => {
      // shouldShowWizard = hasCriticalBlockers OR trustGrade === "manual_review_required"
      if (d.ok && d.shouldShowWizard) {
        setIgniteOpen(true);
      }
    })
    .catch(() => {});
}, [dealId]);
```

### Builder page — "Fix with Buddy" button (ChatGPT copy)

Search for `RunResearchButton` or `"Run Analysis"` to find the correct component file.
Add next to Run Analysis:

```tsx
<button
  onClick={() => setIgniteOpen(true)}
  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500/20 to-violet-500/20 border border-sky-500/30 text-sky-400 hover:from-sky-500/30 hover:to-violet-500/30 text-xs font-semibold transition-all"
>
  <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
  Fix with Buddy
</button>

{igniteOpen && (
  <IgniteWizard
    dealId={dealId}
    onComplete={() => window.location.reload()}
    onClose={() => setIgniteOpen(false)}
  />
)}
```

### Credit Memo page — `BlockedMemoRecoveryPanel`

In `src/components/creditMemo/BlockedMemoRecoveryPanel.tsx`, replace the current
"Run Research" button:

```tsx
<button
  onClick={() => setIgniteOpen(true)}
  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 text-xs font-bold text-white shadow-lg hover:from-sky-400 hover:to-violet-400 transition-all"
>
  <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
  Fix with Buddy
</button>
```

### Intelligence tab (ChatGPT Sprint 9 — third surface)

Find the Intelligence tab component (search for `IntelligenceTab` or
`src/app/(app)/deals/[dealId]/intelligence`). When the research trust grade is
`research_failed` or `manual_review_required`, show:

```tsx
{(trustGrade === "research_failed" || trustGrade === "manual_review_required") && (
  <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
    <span className="material-symbols-outlined text-amber-400 text-[18px]">warning</span>
    <div className="flex-1 text-xs text-amber-300">
      {trustGrade === "research_failed"
        ? "Research failed — entity could not be confirmed."
        : "Research returned with gaps — consider re-running after adding more context."}
    </div>
    <button
      onClick={() => setIgniteOpen(true)}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 transition-colors"
    >
      <span className="material-symbols-outlined text-[13px]">rocket_launch</span>
      Fix with Buddy
    </button>
  </div>
)}
```

---

## Part 9 — Update `MemoCompletionWizard`

After creating `MemoQualitativeForm.tsx`:

1. Import: `import { MemoQualitativeForm } from "@/components/creditMemo/MemoQualitativeForm";`
2. Replace form body JSX with: `<MemoQualitativeForm overrides={overrides} onChange={set} principals={mgmtEntries} theme="light" />`
3. Keep all save/close/header/footer logic unchanged.

---

## TypeScript Check

After every part:
```bash
npx tsc --noEmit 2>&1 | grep -v "pdf/route.ts"
```
Zero new errors required before proceeding to next part.

---

## Implementation Order (strict — do not reorder)

1. `MemoQualitativeForm.tsx` — extract from MemoCompletionWizard
2. Update `MemoCompletionWizard.tsx` to use the shared form
3. `recovery/status/route.ts`
4. `borrower/update/route.ts`
5. `recovery/naics-suggest/route.ts`
6. `recovery/principals/route.ts`
7. `recovery/complete/route.ts` — validation gate
8. `IgniteWizard.tsx` — full wizard component
9. Wire auto-trigger + "Fix with Buddy" button into builder page
10. Wire into credit memo page (`BlockedMemoRecoveryPanel`)
11. Wire into Intelligence tab (conditional warning banner)
12. `npx tsc --noEmit` — zero errors
13. Test on deal `0279ed32-c25c-4919-b231-5790050331dd` (SAMARITUS MANAGEMENT LLC)
14. Commit and push

---

## Files to Read Before Implementing

(From ChatGPT's paste-to-builder prompt — Claude Code should read these before starting)

- `src/app/(app)/deals/[dealId]/credit-memo/page.tsx`
- `src/components/creditMemo/MemoCompletionWizard.tsx`
- `src/app/api/deals/[dealId]/research/run/route.ts`
- `src/components/creditMemo/BlockedMemoRecoveryPanel.tsx`
- Search codebase for `"Run Analysis"` to find builder page component file

---

## Banker Experience (Target)

Open deal → wizard auto-appears (`shouldShowWizard: true`) →
**Step 1** "Industry": type "luxury yacht charter Hamptons" → click "Find Industry Code"
  → Buddy suggests NAICS 713990 → click it → "Confirm Industry" →
**Step 2** "Location": enter "Sag Harbor" + "NY" → "Confirm Location" →
**Step 3** "Owners": Buddy shows malformed "MICHAEL NEWMARK\nTaxpayer address" → confirm
  "MICHAEL NEWMARK" → "Fix Owner Records" →
**Step 4** "Business Context": add one paragraph (optional, skip if no time) →
**Step 5** "Review": see everything collected in a clean summary → "Looks good — continue" →
**Step 6** "Continue Analysis": validation passes → research fires → wizard closes →
Intelligence tab updates in ~60–90 seconds.

Total banker effort: **under 2 minutes for the first time, under 30 seconds for re-runs.**
