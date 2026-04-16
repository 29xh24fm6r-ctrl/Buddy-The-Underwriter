# Phase 83 — Ignite Wizard (Combined Best Spec)
# Intelligent Research Readiness + Recovery Flow

**Synthesized from:** My `IGNITE_WIZARD_SPEC.md` + ChatGPT Phase 83 spec  
**Winner by section noted inline.**

---

## What Each Spec Got Right

**My spec:** Complete working component code, dark cockpit UI, full AI NAICS lookup
implementation via Anthropic API, correct borrower table field names, working API routes.

**ChatGPT spec:** Architecturally correct reuse principle (don't fork MemoCompletionWizard —
extract and share it), principal cleanup step for malformed entities, recovery/status normalized
blocker API, recovery/complete orchestration endpoint, "Continue Analysis" single button,
auto-trigger on blockers, banker-friendly copy philosophy.

**Combined:** ChatGPT's architecture + my working code + both specs' feature sets.

---

## Non-Negotiable Rules

1. **Do NOT create a third wizard system.** The existing `MemoCompletionWizard` is the qualitative
   stopgap. This builds on it, not beside it.

2. **Never ask the banker for numeric underwriting metrics** (DSCR, LTV, collateral values,
   financial ratios). Those come from documents only.

3. **Writes go to source-of-truth tables first.** Borrower record → ownership entities → deal name
   → then memo overrides for purely qualitative prose.

4. **No destructive actions without explicit banker confirmation.** Principal merges, record
   deletions — all require explicit confirm UI.

---

## What Already Exists — Do Not Rebuild

- `src/components/creditMemo/MemoCompletionWizard.tsx` — qualitative form with business
  description, revenue mix, seasonality, collateral, principal bios. **Extract its form body
  into `MemoQualitativeForm.tsx` (Sprint 6) and wire both wizard and new recovery component
  through that shared form.**

- `src/app/api/deals/[dealId]/research/flight-deck/route.ts` — already returns blockers.
  Sprint 1's `recovery/status` route replaces this as the wizard's data source with a
  richer normalized payload.

- `RunResearchButton`, `GenerateNarrativesButton`, `RegenerateMemoButton` on the credit memo
  page — the "Continue Analysis" button orchestrates these three in sequence, not beside them.

---

## Verified Data — Borrowers Table Schema

The `borrowers` table (confirmed from production) has these columns:  
`legal_name`, `naics_code`, `naics_description`, `city`, `state`, `address_line1`, `zip`,
`entity_type`, `state_of_formation`

No `website` or `dba` column exists → those go to `deal_memo_overrides`.

---

## Part 1 — `recovery/status` Route (ChatGPT Sprint 2, with my implementation)

**File: `src/app/api/deals/[dealId]/recovery/status/route.ts`**

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

    const [
      dealRes,
      missionRes,
      trustGrade,
      overridesRes,
    ] = await Promise.all([
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

    // Load borrower
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

    // Load ownership entities — flag malformed ones
    const { data: ownersData } = await (sb as any)
      .from("ownership_entities")
      .select("id, display_name, title, ownership_pct")
      .eq("deal_id", dealId)
      .limit(20);

    const MALFORMED_PATTERNS = /\n|\r|\t|Taxpayer address|taxpayer|undefined|null/i;

    const principals = ((ownersData ?? []) as any[]).map((o: any) => {
      const raw = String(o.display_name ?? "").trim();
      const isMalformed = MALFORMED_PATTERNS.test(raw) || raw.length < 2;
      // Normalized candidate: take only the first line, strip junk
      const normalized = raw.split(/\n/)[0].trim().replace(/\s+/g, " ").replace(/Taxpayer.*$/i, "").trim();
      return {
        id: String(o.id),
        displayName: raw,
        isMalformed,
        normalizedCandidate: isMalformed && normalized.length > 2 ? normalized : null,
      };
    });

    // ── Build blocker list ──────────────────────────────────────────────────
    const blockers: Blocker[] = [];

    // NAICS
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

    // Geography
    const hasGeo = !!(borrower?.city?.trim() || borrower?.state?.trim());
    if (!hasGeo) {
      blockers.push({
        key: "missing_geography",
        severity: "error",
        label: "No market location",
        detail: "City and state are missing — BIE cannot run market or competitive research.",
      });
    }

    // Business description
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

    // Identifying anchor
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

    // Malformed principals
    const malformedPrincipals = principals.filter(p => p.isMalformed);
    if (malformedPrincipals.length > 0) {
      blockers.push({
        key: "malformed_principal",
        severity: "warn",
        label: `${malformedPrincipals.length} owner record${malformedPrincipals.length > 1 ? "s need" : " needs"} cleanup`,
        detail: `Malformed name(s): ${malformedPrincipals.map(p => p.displayName.slice(0, 40)).join(", ")}. This will cause management research to fail.`,
      });
    }

    // Placeholder deal name
    const dealName = deal?.display_name || deal?.nickname || deal?.borrower_name || "";
    const PLACEHOLDER_PATTERNS = /^(chatgpt|fix|test|deal \d|new deal|untitled|draft)/i;
    if (PLACEHOLDER_PATTERNS.test(dealName.trim())) {
      blockers.push({
        key: "placeholder_deal_name",
        severity: "warn",
        label: "Placeholder deal name",
        detail: `"${dealName}" looks like a test name. Rename it to something meaningful.`,
      });
    }

    // Research state
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
        detail: "The last research run could not confirm the entity. Resolve the blockers above and re-run.",
      });
    }

    // Suggested actions (ordered by priority)
    const criticalBlockers = blockers.filter(b => b.severity === "error");
    const allClear = criticalBlockers.length === 0;

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
      isReadyForResearch: allClear,
      borrower: {
        legalName: borrower?.legal_name ?? null,
        naicsCode: borrower?.naics_code ?? null,
        naicsDescription: borrower?.naics_description ?? null,
        city: borrower?.city ?? null,
        state: borrower?.state ?? null,
      },
      principals,
      overrides,
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

## Part 2 — `borrower/update` Route (from my spec, field-verified)

**File: `src/app/api/deals/[dealId]/borrower/update/route.ts`**

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
  // Borrower table fields (verified schema: legal_name, naics_code, naics_description, city, state, address_line1)
  naics_code: z.string().min(2).max(10).optional(),
  naics_description: z.string().min(2).max(300).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  legal_name: z.string().min(2).max(200).optional(),
  address_line1: z.string().max(300).optional(),
  // These have no column in borrowers — stored in deal_memo_overrides
  banker_summary: z.string().max(3000).optional(),
  website: z.string().max(500).optional(),
  dba: z.string().max(200).optional(),
  // Deal name
  deal_name: z.string().max(200).optional(),
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

    // Resolve borrower_id from deal
    const { data: deal } = await (sb as any)
      .from("deals")
      .select("borrower_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal?.borrower_id) {
      return NextResponse.json({ ok: false, error: "no_borrower_linked" }, { status: 400 });
    }

    const borrowerPatch: Record<string, string> = {};
    if (body.naics_code !== undefined) borrowerPatch.naics_code = body.naics_code;
    if (body.naics_description !== undefined) borrowerPatch.naics_description = body.naics_description;
    if (body.city !== undefined) borrowerPatch.city = body.city;
    if (body.state !== undefined) borrowerPatch.state = body.state;
    if (body.legal_name !== undefined) borrowerPatch.legal_name = body.legal_name;
    if (body.address_line1 !== undefined) borrowerPatch.address_line1 = body.address_line1;

    if (Object.keys(borrowerPatch).length > 0) {
      const { error } = await (sb as any)
        .from("borrowers")
        .update(borrowerPatch)
        .eq("id", deal.borrower_id);
      if (error) {
        return NextResponse.json({ ok: false, error: "update_failed", detail: error.message }, { status: 500 });
      }
    }

    // Overrides patch (no borrower column: website, dba, banker_summary)
    const overridesPatch: Record<string, unknown> = {};
    if (body.banker_summary !== undefined) overridesPatch.banker_summary = body.banker_summary;
    if (body.website !== undefined) overridesPatch.website = body.website;
    if (body.dba !== undefined) overridesPatch.dba = body.dba;

    if (Object.keys(overridesPatch).length > 0) {
      // Merge with existing overrides
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

    // Deal name update
    if (body.deal_name !== undefined) {
      await (sb as any)
        .from("deals")
        .update({ display_name: body.deal_name.trim() })
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

    return NextResponse.json({
      ok: true,
      updated: {
        borrower: Object.keys(borrowerPatch),
        overrides: Object.keys(overridesPatch),
        deal_name: body.deal_name !== undefined,
      },
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
```

---

## Part 3 — `recovery/naics-suggest` Route (my implementation, ChatGPT's shape)

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
  confidence: number;     // 0.0–1.0
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

    const prompt = `You are a commercial bank underwriter. Given this business description, return the
3 most likely NAICS codes. Use real 6-digit codes from the 2022 NAICS manual.

Company: ${body.company_name ?? "Not specified"}
Description: ${body.business_description}

Return ONLY valid JSON — no markdown, no preamble:
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
- Exactly 3 suggestions, best-first
- confidence 0.0–1.0 (not a string label)
- rationale: one sentence max, plain English`;

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

## Part 4 — `recovery/principals` Route (ChatGPT Sprint 5)

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
          .eq("deal_id", dealId);  // Safety: only update if belongs to this deal
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

## Part 5 — Extract `MemoQualitativeForm` (ChatGPT Sprint 6)

**File: `src/components/creditMemo/MemoQualitativeForm.tsx`**

Extract the form body from `MemoCompletionWizard.tsx` into this standalone component.
Both `MemoCompletionWizard` and `IgniteWizard` (Step 4: Business Context) use this.

```tsx
"use client";

import React from "react";

const fieldStyle: React.CSSProperties = { color: "#111827", backgroundColor: "#ffffff" };

const baseCls =
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
  /** "dark" for the IgniteWizard, "light" for the existing MemoCompletionWizard */
  theme?: "dark" | "light";
};

export function MemoQualitativeForm({ overrides, onChange, principals, theme = "light" }: Props) {
  const mgmtEntries = principals.length > 0
    ? principals
    : [{ id: "general", name: "Management Team" }];

  const inputCls = theme === "dark"
    ? "w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 resize-none leading-relaxed"
    : baseCls;

  const labelCls = theme === "dark"
    ? "block text-xs font-medium text-white/60 mb-1"
    : "block text-xs font-medium text-gray-700 mb-1";

  const hintCls = theme === "dark"
    ? "text-xs text-white/30 mb-2"
    : "text-xs text-gray-400 mb-2";

  const sectionHeaderCls = theme === "dark"
    ? "text-xs font-semibold text-white/40 uppercase tracking-widest mb-3"
    : "text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3";

  return (
    <div className="space-y-5">
      {/* Business Profile */}
      <div>
        <div className={sectionHeaderCls}>Business Profile</div>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Business Operations & History</label>
            <p className={hintCls}>Who is the borrower, what do they do, how long have they operated?</p>
            <textarea
              rows={4}
              value={overrides.business_description ?? ""}
              onChange={e => onChange("business_description", e.target.value)}
              placeholder="e.g. Samaritus Management LLC operates Yacht Hampton, a luxury boat charter business founded in 2017 in Sag Harbor, NY..."
              className={inputCls}
              style={theme === "light" ? fieldStyle : undefined}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Revenue Mix</label>
              <textarea rows={3} value={overrides.revenue_mix ?? ""} onChange={e => onChange("revenue_mix", e.target.value)} placeholder="e.g. 60% boat rentals, 30% corporate events, 10% sailing lessons" className={inputCls} style={theme === "light" ? fieldStyle : undefined} />
            </div>
            <div>
              <label className={labelCls}>Seasonality</label>
              <textarea rows={3} value={overrides.seasonality ?? ""} onChange={e => onChange("seasonality", e.target.value)} placeholder="e.g. Peak May–Sep (85% of revenue)" className={inputCls} style={theme === "light" ? fieldStyle : undefined} />
            </div>
          </div>
        </div>
      </div>

      {/* Collateral */}
      <div>
        <div className={sectionHeaderCls}>Collateral</div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Collateral Description</label>
            <textarea rows={3} value={overrides.collateral_description ?? ""} onChange={e => onChange("collateral_description", e.target.value)} placeholder="e.g. 2023 Aquila 36 catamaran and Galeon 640 motor yacht maintained at Sag Harbor Marina..." className={inputCls} style={theme === "light" ? fieldStyle : undefined} />
          </div>
          <div>
            <label className={labelCls}>Collateral Address</label>
            <input type="text" value={overrides.collateral_address ?? ""} onChange={e => onChange("collateral_address", e.target.value)} placeholder="e.g. 31 Bay St, Sag Harbor, NY 11963" className={inputCls} style={theme === "light" ? fieldStyle : undefined} />
          </div>
        </div>
      </div>

      {/* Management */}
      <div>
        <div className={sectionHeaderCls}>Management Qualifications</div>
        <div className="space-y-4">
          {mgmtEntries.map(p => (
            <div key={p.id}>
              <label className={labelCls}>{p.name}</label>
              <textarea
                rows={4}
                value={overrides[`principal_bio_${p.id}`] ?? ""}
                onChange={e => onChange(`principal_bio_${p.id}`, e.target.value)}
                placeholder={`Career background, industry experience, and track record for ${p.name}...`}
                className={inputCls}
                style={theme === "light" ? fieldStyle : undefined}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Strategy */}
      <div>
        <div className={sectionHeaderCls}>Business Strategy</div>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Competitive Advantages</label>
            <textarea rows={3} value={overrides.competitive_advantages ?? ""} onChange={e => onChange("competitive_advantages", e.target.value)} placeholder="e.g. Exclusive marina berthing, repeat corporate clientele representing 40% of revenue" className={inputCls} style={theme === "light" ? fieldStyle : undefined} />
          </div>
          <div>
            <label className={labelCls}>Vision & Growth Strategy</label>
            <textarea rows={3} value={overrides.vision ?? ""} onChange={e => onChange("vision", e.target.value)} placeholder="e.g. Expand fleet by 3 vessels, launch electric-only premium charter tier" className={inputCls} style={theme === "light" ? fieldStyle : undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Then update `MemoCompletionWizard.tsx`** to use this component for its form body instead of
the inline JSX. The wizard's state management and save/close logic stays in the wizard.

---

## Part 6 — `IgniteWizard` Component (my UI + ChatGPT's extra steps)

**File: `src/components/deals/IgniteWizard.tsx`**

Complete dark-themed multi-step modal. Steps are built dynamically from the recovery/status
response. The component handles: NAICS suggestion, geography, deal name, principal cleanup,
business context (using `MemoQualitativeForm`), and launch.

```tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { MemoQualitativeForm } from "@/components/creditMemo/MemoQualitativeForm";
import type { QualitativeOverrides } from "@/components/creditMemo/MemoQualitativeForm";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

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
  isReadyForResearch: boolean;
  borrower: { legalName: string | null; naicsCode: string | null; city: string | null; state: string | null };
  principals: Principal[];
  overrides: Record<string, unknown>;
  trustGrade: string | null;
  researchStatus: string | null;
};

// ─────────────────────────────────────────────────────────────
// Step builder
// ─────────────────────────────────────────────────────────────

function buildSteps(status: RecoveryStatus): WizardStep[] {
  const steps: WizardStep[] = [];
  const blockerKeys = new Set(status.blockers.map(b => b.key));

  if (blockerKeys.has("missing_naics")) {
    steps.push({ id: "industry", label: "Industry", icon: "category", status: "pending", required: true });
  }
  if (blockerKeys.has("missing_geography")) {
    steps.push({ id: "location", label: "Location", icon: "location_on", status: "pending", required: true });
  }
  if (blockerKeys.has("placeholder_deal_name")) {
    steps.push({ id: "name", label: "Deal Name", icon: "edit", status: "pending", required: false });
  }
  if (blockerKeys.has("malformed_principal")) {
    steps.push({ id: "owners", label: "Owners", icon: "people", status: "pending", required: true });
  }
  // Business context always included — reuses MemoQualitativeForm
  steps.push({ id: "context", label: "Business Context", icon: "description", status: "pending", required: false });
  // Launch is always last
  steps.push({ id: "launch", label: "Continue Analysis", icon: "rocket_launch", status: "pending", required: true });

  return steps.map((s, i) => ({ ...s, status: i === 0 ? "active" : "pending" }));
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

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
  const [phase, setPhase] = useState<"idle" | "running_research" | "generating_memo" | "done">("idle");

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
  const [principalActions, setPrincipalActions] = useState<Record<string, { action: "rename" | "keep"; newName: string }>>({});
  const [overrides, setOverrides] = useState<QualitativeOverrides>({});

  // Load recovery status
  useEffect(() => {
    setLoading(true);
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
          // Pre-init principal actions to "keep"
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

  // Advance to next step
  const advance = useCallback(() => {
    setSteps(prev => prev.map((s, i) => {
      if (i === stepIdx) return { ...s, status: "done" };
      if (i === stepIdx + 1) return { ...s, status: "active" };
      return s;
    }));
    setStepIdx(i => i + 1);
    setError(null);
  }, [stepIdx]);

  // Save and advance helper
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

  // AI NAICS lookup
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

  // Save principals
  const savePrincipals = useCallback(async () => {
    setSaving(true);
    try {
      const actions = Object.entries(principalActions).map(([id, v]) => ({
        id,
        action: v.action,
        new_name: v.action === "rename" ? v.newName : undefined,
      }));
      await fetch(`/api/deals/${dealId}/recovery/principals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions }),
      });
      advance();
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }, [principalActions, dealId, advance]);

  // Save overrides (context step)
  const saveContext = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/deals/${dealId}/borrower/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overrides),
      });
    } catch {}
    finally { setSaving(false); }
    advance();
  }, [overrides, dealId, advance]);

  // "Continue Analysis" — orchestrated: research → memo
  const continueAnalysis = useCallback(async () => {
    setPhase("running_research");
    setError(null);
    try {
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

      setPhase("generating_memo");
      // Non-blocking memo regenerate — don't wait
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
                <div
                  key={step.id}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all ${
                    isActive ? "bg-sky-500/15 border border-sky-500/30"
                    : isDone ? "opacity-50" : "opacity-25"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                    isDone ? "bg-emerald-500 text-white"
                    : isActive ? "bg-sky-500 text-white"
                    : "bg-white/10 text-white/40"
                  }`}>
                    {isDone ? "✓" : isActive
                      ? <span className="material-symbols-outlined text-[12px]">{step.icon}</span>
                      : i + 1}
                  </div>
                  <div>
                    <div className={`text-xs font-medium ${isActive ? "text-white" : "text-white/50"}`}>
                      {step.label}
                    </div>
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
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── Content ───────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-8 py-5 border-b border-white/[0.06]">
            <div>
              <div className="text-base font-semibold text-white">
                {currentStep?.label ?? "Complete"}
              </div>
              <div className="text-xs text-white/40 mt-0.5">
                {status?.deal.borrowerName ?? status?.deal.name ?? dealId} ·
                Step {Math.min(stepIdx + 1, steps.length)} of {steps.length}
              </div>
            </div>
            <button onClick={onClose} className="text-white/30 hover:text-white/60 text-lg">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-6">
            {error && (
              <div className="mb-4 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {/* ── Industry Step ────────────────────────────────── */}
            {currentStep?.id === "industry" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">
                    Tell Buddy what this business does
                  </div>
                  <div className="text-xs text-white/40 mb-3">
                    Write a sentence or two in plain English — Buddy finds the right industry code.
                  </div>
                  <textarea
                    rows={4}
                    value={businessDescription}
                    onChange={e => { setBusinessDescription(e.target.value); setNaicsSuggestions([]); setSelectedNaics(null); }}
                    placeholder="e.g. Luxury yacht charter and boat rental business serving corporate and leisure clients in the Hamptons, NY. Operates a fleet of motor yachts and sailing vessels."
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 resize-none leading-relaxed"
                  />
                </div>
                <button
                  onClick={lookupNaics}
                  disabled={naicsLoading || businessDescription.trim().length < 15}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    naicsLoading ? "bg-white/5 text-white/30 cursor-wait"
                    : businessDescription.trim().length < 15 ? "bg-white/5 text-white/20 cursor-not-allowed"
                    : "bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20"
                  }`}
                >
                  {naicsLoading
                    ? <><span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span> Buddy is thinking...</>
                    : <><span className="material-symbols-outlined text-[16px]">auto_awesome</span> Find Industry Code</>
                  }
                </button>
                {naicsSuggestions.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">
                      Buddy's suggestions — pick one
                    </div>
                    {naicsSuggestions.map(s => (
                      <button
                        key={s.naics_code}
                        onClick={() => setSelectedNaics(s)}
                        className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all ${
                          selectedNaics?.naics_code === s.naics_code
                            ? "border-sky-500/60 bg-sky-500/10"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20"
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
                    <button
                      onClick={() => setSelectedNaics({ naics_code: "", naics_description: "", confidence: 0, rationale: "" })}
                      className="text-xs text-white/30 hover:text-white/50 mt-1 transition-colors"
                    >
                      Enter a code manually instead →
                    </button>
                  </div>
                )}
                {selectedNaics?.naics_code === "" && (
                  <div className="flex gap-3">
                    <input type="text" maxLength={6} placeholder="6-digit code" value={manualNaicsCode} onChange={e => setManualNaicsCode(e.target.value)}
                      className="w-32 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                    <input type="text" placeholder="Industry description" value={manualNaicsDesc} onChange={e => setManualNaicsDesc(e.target.value)}
                      className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                  </div>
                )}
              </div>
            )}

            {/* ── Location Step ─────────────────────────────────── */}
            {currentStep?.id === "location" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Where does this business operate?</div>
                  <div className="text-xs text-white/40 mb-4">
                    Buddy needs a market to run local economic and competitive research.
                  </div>
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
                  local economic conditions, or benchmark real estate collateral markets.
                </div>
              </div>
            )}

            {/* ── Deal Name Step ────────────────────────────────── */}
            {currentStep?.id === "name" && (
              <div className="space-y-5">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Give this deal a real name</div>
                  <div className="text-xs text-white/40 mb-4">Current name looks like a test artifact. Use the borrower name or a meaningful descriptor.</div>
                  <input type="text" value={dealName} onChange={e => setDealName(e.target.value)} placeholder="e.g. SAMARITUS MANAGEMENT LLC — $500K Equipment"
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50" />
                </div>
              </div>
            )}

            {/* ── Owners Step ───────────────────────────────────── */}
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
                    <div className="text-xs text-amber-400 font-semibold mb-2 uppercase tracking-wide">
                      ⚠ Malformed record
                    </div>
                    <div className="text-xs text-white/30 font-mono mb-3 line-through">
                      {p.displayName.slice(0, 80)}{p.displayName.length > 80 ? "..." : ""}
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-white/50 font-medium block">Corrected name</label>
                      <input
                        type="text"
                        value={principalActions[p.id]?.newName ?? p.normalizedCandidate ?? ""}
                        onChange={e => setPrincipalActions(prev => ({
                          ...prev,
                          [p.id]: { action: "rename", newName: e.target.value }
                        }))}
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50"
                      />
                      <button
                        onClick={() => setPrincipalActions(prev => ({
                          ...prev,
                          [p.id]: { action: "keep", newName: p.displayName }
                        }))}
                        className="text-xs text-white/25 hover:text-white/40 transition-colors"
                      >
                        Keep original (not recommended)
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Business Context Step ─────────────────────────── */}
            {currentStep?.id === "context" && (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-white mb-1">Add context Buddy can't get from documents</div>
                  <div className="text-xs text-white/40 mb-4">
                    Optional but makes research dramatically better. No financial metrics needed —
                    just what you know from conversations with the borrower.
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

            {/* ── Launch Step ───────────────────────────────────── */}
            {currentStep?.id === "launch" && (
              <div className="space-y-5">
                {phase === "done" ? (
                  <div className="text-center py-10">
                    <div className="text-5xl mb-4">🚀</div>
                    <div className="text-lg font-bold text-white mb-2">Research Launched!</div>
                    <div className="text-sm text-white/40">
                      Buddy is running 8 intelligence threads. Check the Intelligence tab in about 60–90 seconds.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bg-gradient-to-br from-sky-500/10 to-violet-500/10 border border-sky-500/20 rounded-2xl p-6">
                      <div className="text-sm font-bold text-white mb-3">Ready to launch ✓</div>
                      <div className="space-y-1.5">
                        {steps.filter(s => s.status === "done").map(s => (
                          <div key={s.id} className="flex items-center gap-2 text-xs text-white/60">
                            <span className="text-emerald-400 material-symbols-outlined text-[14px]">check_circle</span>
                            {s.label}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 text-xs text-white/40 leading-relaxed space-y-1">
                      <div className="text-white/60 font-medium mb-1">What happens:</div>
                      <div>→ BIE confirms entity identity for {status?.borrower.legalName ?? "borrower"}</div>
                      <div>→ 6 parallel intelligence threads (borrower, management, competitive, market, industry, transaction)</div>
                      <div>→ Synthesis + 8 adversarial contradiction checks</div>
                      <div>→ Trust grade computed across 9 gates</div>
                      <div>→ Memo regenerated with updated research</div>
                    </div>
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
                {currentStep && !currentStep.required && currentStep.id !== "launch" && (
                  <button onClick={advance} className="text-xs text-white/30 hover:text-white/50 px-3 py-2 transition-colors">
                    Skip for now
                  </button>
                )}

                {/* Industry CTA */}
                {currentStep?.id === "industry" && (
                  <button
                    onClick={() => {
                      const code = selectedNaics?.naics_code === "" ? manualNaicsCode : selectedNaics?.naics_code;
                      const desc = selectedNaics?.naics_code === "" ? manualNaicsDesc : selectedNaics?.naics_description;
                      if (!code) { setError("Select or enter an industry code"); return; }
                      saveAndAdvance({
                        naics_code: code,
                        naics_description: desc ?? "",
                        banker_summary: businessDescription.length > 20 ? businessDescription : undefined,
                      });
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
                  <button
                    onClick={savePrincipals}
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 transition-all"
                  >
                    {saving ? "Saving..." : "Fix Owner Records →"}
                  </button>
                )}

                {currentStep?.id === "context" && (
                  <button
                    onClick={saveContext}
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/20 transition-all"
                  >
                    {saving ? "Saving..." : "Save & Continue →"}
                  </button>
                )}

                {currentStep?.id === "launch" && phase === "idle" && (
                  <button
                    onClick={continueAnalysis}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-sky-500 to-violet-500 hover:from-sky-400 hover:to-violet-400 text-white shadow-xl shadow-sky-500/25 transition-all"
                  >
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

## Part 7 — Wire Into Existing UI (ChatGPT Sprint 9)

### Auto-trigger logic

The wizard should appear automatically when critical blockers exist. In the Builder page
and Credit Memo page, add a `useEffect` that fetches `recovery/status` on mount and
auto-opens the wizard when `hasCriticalBlockers === true`.

**Add to the builder page AND the credit memo page:**

```typescript
import { IgniteWizard } from "@/components/deals/IgniteWizard";

// In the component:
const [igniteOpen, setIgniteOpen] = useState(false);

useEffect(() => {
  // Auto-check blockers on load; show wizard if critical ones exist
  fetch(`/api/deals/${dealId}/recovery/status`)
    .then(r => r.json())
    .then(d => {
      if (d.ok && d.hasCriticalBlockers) {
        setIgniteOpen(true);
      }
    })
    .catch(() => {});
}, [dealId]);
```

### Builder page button

Find the component containing the "Run Analysis" button. Add next to it:

```tsx
<button
  onClick={() => setIgniteOpen(true)}
  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500/20 to-violet-500/20 border border-sky-500/30 text-sky-400 hover:from-sky-500/30 hover:to-violet-500/30 text-xs font-semibold transition-all"
>
  <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
  Ignite
</button>

{igniteOpen && (
  <IgniteWizard
    dealId={dealId}
    onComplete={() => window.location.reload()}
    onClose={() => setIgniteOpen(false)}
  />
)}
```

### Credit Memo page — replace BlockedMemoRecoveryPanel CTA

In `src/components/creditMemo/BlockedMemoRecoveryPanel.tsx`, replace the "Run Research" button:

```tsx
<button
  onClick={() => setIgniteOpen(true)}
  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 text-xs font-bold text-white shadow-lg hover:from-sky-400 hover:to-violet-400 transition-all"
>
  <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
  Fix with Buddy
</button>
```

---

## Part 8 — Update `MemoCompletionWizard` to Use Shared Form

After creating `MemoQualitativeForm.tsx`, update `MemoCompletionWizard.tsx` to:

1. Import `MemoQualitativeForm`
2. Replace its form body with `<MemoQualitativeForm overrides={overrides} onChange={set} principals={mgmtEntries} theme="light" />`
3. Keep all save/close/header/footer logic unchanged

---

## TypeScript Check

After every part:
```bash
npx tsc --noEmit 2>&1 | grep -v "pdf/route.ts"
```
Zero new errors before proceeding.

---

## Implementation Order (strict)

1. `MemoQualitativeForm.tsx` — extract from MemoCompletionWizard
2. Update `MemoCompletionWizard.tsx` to use the shared form
3. `recovery/status/route.ts` — normalized blocker API
4. `borrower/update/route.ts` — update borrower fields + deal name
5. `recovery/naics-suggest/route.ts` — AI NAICS lookup
6. `recovery/principals/route.ts` — principal cleanup actions
7. `IgniteWizard.tsx` — full wizard component
8. Wire auto-trigger into builder page
9. Wire into credit memo page (BlockedMemoRecoveryPanel)
10. `npx tsc --noEmit` — zero errors
11. Test on deal `0279ed32-c25c-4919-b231-5790050331dd` (SAMARITUS MANAGEMENT LLC)
12. Commit and push

---

## Banker Experience (Target)

Open deal → wizard auto-appears (critical blockers detected) → step 1: type "luxury yacht
charter Hamptons" → Buddy suggests NAICS 713990 → click it → step 2: enter "Sag Harbor" +
"NY" → step 3: Buddy shows malformed "MICHAEL NEWMARK\nTaxpayer address" → confirm
"MICHAEL NEWMARK" → step 4: add one paragraph about the business → click Continue Analysis
→ research fires → wizard closes → Intelligence tab updates in 60–90 seconds.

Total banker effort: **under 90 seconds**.
