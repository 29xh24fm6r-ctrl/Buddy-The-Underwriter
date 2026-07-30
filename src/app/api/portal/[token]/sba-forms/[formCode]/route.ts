import "server-only";

/**
 * GET  /api/portal/[token]/sba-forms/[formCode]
 *   Borrower-facing form review — SPEC-M7 ZERO-REPEAT-PREFILL-1. Returns
 *   the flattened, already-prefilled field list (buildBorrowerFormReview)
 *   plus the covenant counter. `?download=1` instead streams the actual
 *   unsigned, downloadable PDF via the SAME render pipeline the existing
 *   bank-staff-only route uses (src/app/api/deals/[dealId]/sba/forms/
 *   [formId]/[action]/route.ts) — that route is Clerk/bank-staff
 *   authenticated only (confirmed in SPEC-M7 §0 research: a borrower
 *   session cannot reach it), so this is a new, borrower-token-scoped
 *   entry point onto the same builders/renderers, not a duplicate of them.
 *
 * POST /api/portal/[token]/sba-forms/[formCode]
 *   Confirms (or edits, for use-of-proceeds) the one structurer-derived
 *   field this spec introduces. Body: { fieldKey, categorized? }.
 *
 * formCode ∈ {"1919", "413"} — the two forms SPEC-M7 covers in v1.
 *
 * Auth: resolveBorrowerToken(token) only, same as every other
 * src/app/api/portal/[token]/** route (glass-box, fix-cards) — no Clerk,
 * no assertDealAccess, matching this arc's established convention.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import { buildBorrowerFormReview, confirmStructuredField } from "@/lib/sba/forms/borrowerFormReview";
import { computeCovenantCounts } from "@/lib/brokerage/covenantCounter";
import { buildForm1919Input } from "@/lib/sba/forms/form1919/inputBuilder";
import { buildForm1919 } from "@/lib/sba/forms/form1919/build";
import { renderForm1919Pdf } from "@/lib/sba/forms/form1919/render";
import { buildForm413Input } from "@/lib/sba/forms/form413/inputBuilder";
import { buildForm413 } from "@/lib/sba/forms/form413/build";
import { renderForm413Pdf } from "@/lib/sba/forms/form413/render";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ token: string; formCode: string }> };

function isFormCode(v: string): v is "1919" | "413" {
  return v === "1919" || v === "413";
}

function pdfResponse(pdfBytes: Uint8Array, filename: string): NextResponse {
  return new NextResponse(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}

async function resolvePrimaryOwnershipEntityId(dealId: string, sb: ReturnType<typeof supabaseAdmin>): Promise<string | null> {
  const { data } = await sb
    .from("ownership_entities")
    .select("id")
    .eq("deal_id", dealId)
    .in("entity_type", ["individual", "person"])
    .order("ownership_pct", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { token, formCode } = await ctx.params;
  if (!isFormCode(formCode)) {
    return NextResponse.json({ ok: false, error: "unsupported_form" }, { status: 400 });
  }

  let dealId: string;
  let bankId: string;
  try {
    const resolved = await resolveBorrowerToken(token);
    dealId = resolved.deal_id;
    bankId = resolved.bank_id;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid or expired portal link" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  if (new URL(req.url).searchParams.get("download") === "1") {
    const ownershipEntityId = await resolvePrimaryOwnershipEntityId(dealId, sb);
    if (!ownershipEntityId) {
      return NextResponse.json({ ok: false, error: "no_primary_owner" }, { status: 422 });
    }

    if (formCode === "1919") {
      const buildResult = buildForm1919(await buildForm1919Input(dealId, sb));
      const rendered = await renderForm1919Pdf({ supabase: sb, buildResult, ownershipEntityId, dealId });
      if (!rendered.ok) {
        return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
      }
      return pdfResponse(rendered.pdfBytes, `form-1919-${dealId}.pdf`);
    }

    const buildResult = buildForm413(await buildForm413Input(dealId, sb));
    const rendered = await renderForm413Pdf({ supabase: sb, buildResult, ownershipEntityId, dealId });
    if (!rendered.ok) {
      return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
    }
    return pdfResponse(rendered.pdfBytes, `form-413-${dealId}.pdf`);
  }

  try {
    const [review, covenant] = await Promise.all([
      buildBorrowerFormReview(dealId, bankId, formCode, sb),
      computeCovenantCounts(dealId, sb),
    ]);
    return NextResponse.json({ ok: true, review, covenant });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[portal/sba-forms] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { token, formCode } = await ctx.params;
  if (!isFormCode(formCode)) {
    return NextResponse.json({ ok: false, error: "unsupported_form" }, { status: 400 });
  }

  let dealId: string;
  try {
    const resolved = await resolveBorrowerToken(token);
    dealId = resolved.deal_id;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid or expired portal link" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const { fieldKey, categorized } = body as { fieldKey?: string; categorized?: unknown };
  if (typeof fieldKey !== "string" || !fieldKey) {
    return NextResponse.json({ ok: false, error: "missing_field_key" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const result = await confirmStructuredField(
    dealId,
    formCode,
    fieldKey,
    Array.isArray(categorized) ? (categorized as any) : null,
    sb,
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.error === "not_found" ? 404 : 500 });
  }
  return NextResponse.json({ ok: true });
}
