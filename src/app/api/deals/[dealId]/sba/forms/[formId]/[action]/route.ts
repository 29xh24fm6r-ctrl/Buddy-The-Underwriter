import "server-only";

/**
 * ARC-00 (Phases 2-5) — /api/deals/[dealId]/sba/forms/[formId]/[action]
 * formId ∈ {"1244","148","155","1919","413","4506c","601","912","722"}
 * action ∈ {"build","render"} for the 8 fillable forms (render for
 * per-signer forms takes ?ownership_entity_id=...); formId="722" instead
 * uses action ∈ {"status" (GET), "acknowledge" (POST)} — it's a delivery
 * acknowledgment, not a fillable PDF.
 *
 * Consolidates the 8 previously-separate per-form [action] route files
 * (1244/[action], 148/[action], 155/[action], 1919/[action], 413/[action],
 * 4506c/[action], 601/[action], 912/[action]) plus the former standalone
 * forms/722/route.ts into one dynamic-segment dispatcher — route/page slot
 * budget discipline (see the Drift Log). Public URL shape for the 8 forms
 * is unchanged: [formId] matches the same literal path segments ("1244",
 * "148", etc.) those directories occupied, and reuses the `formId` param
 * name already established by the sibling legacy catch-all at
 * sba/forms/[formId]/route.ts (Next.js requires all dynamic segments at
 * the same directory level to share one param name). Form 722's URL
 * changes from /sba/forms/722 to /sba/forms/722/status|acknowledge — no
 * caller used the old path (confirmed before this restructure).
 *
 * The legacy sba/forms/[formId] 2-segment route (pre-ARC-00, formId="1919"
 * only, a disconnected parallel subsystem — see Phase 1 Drift Log) is
 * untouched.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getForm722Status, acknowledgeForm722 } from "@/lib/sba/forms/form722/service";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

import { buildForm1244WithSignature } from "@/lib/sba/forms/form1244/buildWithSignature";
import { buildForm1244Input } from "@/lib/sba/forms/form1244/inputBuilder";
import { buildForm1244 } from "@/lib/sba/forms/form1244/build";
import { renderForm1244Pdf } from "@/lib/sba/forms/form1244/render";

import { buildForm148WithSignature } from "@/lib/sba/forms/form148/buildWithSignature";
import { buildForm148Input } from "@/lib/sba/forms/form148/inputBuilder";
import { buildForm148 } from "@/lib/sba/forms/form148/build";
import { renderForm148Pdf } from "@/lib/sba/forms/form148/render";

import { buildForm155WithSignature } from "@/lib/sba/forms/form155/buildWithSignature";
import { buildForm155Input } from "@/lib/sba/forms/form155/inputBuilder";
import { renderForm155Pdf } from "@/lib/sba/forms/form155/render";

import { buildForm1919WithSignature } from "@/lib/sba/forms/form1919/buildWithSignature";
import { buildForm1919Input } from "@/lib/sba/forms/form1919/inputBuilder";
import { buildForm1919 } from "@/lib/sba/forms/form1919/build";
import { renderForm1919Pdf } from "@/lib/sba/forms/form1919/render";

import { buildForm413WithSignature } from "@/lib/sba/forms/form413/buildWithSignature";
import { buildForm413Input } from "@/lib/sba/forms/form413/inputBuilder";
import { buildForm413 } from "@/lib/sba/forms/form413/build";
import { renderForm413Pdf } from "@/lib/sba/forms/form413/render";

import { buildForm4506cWithSignature } from "@/lib/sba/forms/form4506c/buildWithSignature";
import { buildForm4506cInput } from "@/lib/sba/forms/form4506c/inputBuilder";
import { buildForm4506c } from "@/lib/sba/forms/form4506c/build";
import { renderForm4506cPdf } from "@/lib/sba/forms/form4506c/render";

import { buildForm601WithSignature } from "@/lib/sba/forms/form601/buildWithSignature";
import { buildForm601Input } from "@/lib/sba/forms/form601/inputBuilder";
import { renderForm601Pdf } from "@/lib/sba/forms/form601/render";

import { buildForm912WithSignature } from "@/lib/sba/forms/form912/buildWithSignature";
import { buildForm912Input } from "@/lib/sba/forms/form912/inputBuilder";
import { buildForm912 } from "@/lib/sba/forms/form912/build";
import { renderForm912Pdf } from "@/lib/sba/forms/form912/render";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; formId: string; action: string }> };

function pdfResponse(pdfBytes: Uint8Array, filename: string): NextResponse {
  return new NextResponse(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}

function requireOwnershipEntityId(req: Request): string | NextResponse {
  const ownershipEntityId = new URL(req.url).searchParams.get("ownership_entity_id");
  if (!ownershipEntityId) {
    return NextResponse.json({ ok: false, error: "missing_ownership_entity_id" }, { status: 400 });
  }
  return ownershipEntityId;
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, formId, action } = await ctx.params;
    const { dealId, bankId } = await assertDealAccess(rawDealId);
    const sb = supabaseAdmin();

    if (formId === "722") {
      if (action !== "status") {
        return NextResponse.json({ ok: false, error: `unsupported_action: ${action}` }, { status: 400 });
      }
      const status = await getForm722Status(dealId, sb);
      return NextResponse.json({ ok: true, ...status });
    }

    if (action !== "build" && action !== "render") {
      return NextResponse.json({ ok: false, error: `unsupported_action: ${action}` }, { status: 400 });
    }

    switch (formId) {
      case "1244": {
        if (action === "build") {
          const result = await buildForm1244WithSignature(dealId, sb);
          return NextResponse.json({ ok: true, dealId, ...result });
        }
        const input = await buildForm1244Input(dealId, sb);
        const buildResult = buildForm1244(input);
        const rendered = await renderForm1244Pdf({ supabase: sb, buildResult });
        if (!rendered.ok) return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
        return pdfResponse(rendered.pdfBytes, `form-1244-${dealId}.pdf`);
      }

      case "148": {
        if (action === "build") {
          const result = await buildForm148WithSignature(dealId, bankId, sb);
          return NextResponse.json({ ok: true, dealId, ...result });
        }
        const ownershipEntityId = requireOwnershipEntityId(req);
        if (typeof ownershipEntityId !== "string") return ownershipEntityId;
        const input = await buildForm148Input(dealId, bankId, sb);
        const buildResult = buildForm148(input);
        const rendered = await renderForm148Pdf({ supabase: sb, buildResult, ownershipEntityId });
        if (!rendered.ok) return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
        return pdfResponse(rendered.pdfBytes, `form-148-${dealId}-${ownershipEntityId}.pdf`);
      }

      case "155": {
        if (action === "build") {
          const result = await buildForm155WithSignature(dealId, bankId, sb);
          return NextResponse.json({ ok: true, dealId, ...result });
        }
        const buildResult = await buildForm155Input(dealId, bankId, sb);
        const rendered = await renderForm155Pdf({ supabase: sb, buildResult });
        if (!rendered.ok) return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
        return pdfResponse(rendered.pdfBytes, `form-155-${dealId}.pdf`);
      }

      case "1919": {
        if (action === "build") {
          const result = await buildForm1919WithSignature(dealId, sb);
          return NextResponse.json({ ok: true, dealId, ...result });
        }
        // Section II (demographics/compliance questions/export section) is
        // completed per covered individual on the real form — see
        // render.ts's header comment — so rendering now requires knowing
        // which individual's copy to produce.
        const ownershipEntityId = requireOwnershipEntityId(req);
        if (typeof ownershipEntityId !== "string") return ownershipEntityId;
        const input = await buildForm1919Input(dealId, sb);
        const buildResult = buildForm1919(input);
        const rendered = await renderForm1919Pdf({ supabase: sb, buildResult, ownershipEntityId, dealId });
        if (!rendered.ok) return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
        return pdfResponse(rendered.pdfBytes, `form-1919-${dealId}-${ownershipEntityId}.pdf`);
      }

      case "413": {
        if (action === "build") {
          const result = await buildForm413WithSignature(dealId, sb);
          return NextResponse.json({ ok: true, dealId, ...result });
        }
        const ownershipEntityId = requireOwnershipEntityId(req);
        if (typeof ownershipEntityId !== "string") return ownershipEntityId;
        const input = await buildForm413Input(dealId, sb);
        const buildResult = buildForm413(input);
        const rendered = await renderForm413Pdf({ supabase: sb, buildResult, ownershipEntityId, dealId });
        if (!rendered.ok) return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
        return pdfResponse(rendered.pdfBytes, `form-413-${ownershipEntityId}.pdf`);
      }

      case "4506c": {
        if (action === "build") {
          const result = await buildForm4506cWithSignature(dealId, bankId, sb);
          return NextResponse.json({ ok: true, dealId, ...result });
        }
        const ownershipEntityId = requireOwnershipEntityId(req);
        if (typeof ownershipEntityId !== "string") return ownershipEntityId;
        const input = await buildForm4506cInput(dealId, bankId, sb);
        const buildResult = buildForm4506c(input);
        const rendered = await renderForm4506cPdf({ supabase: sb, buildResult, ownershipEntityId, dealId });
        if (!rendered.ok) return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
        return pdfResponse(rendered.pdfBytes, `form-4506c-${dealId}-${ownershipEntityId}.pdf`);
      }

      case "601": {
        if (action === "build") {
          const result = await buildForm601WithSignature(dealId, bankId, sb);
          return NextResponse.json({ ok: true, dealId, ...result });
        }
        const buildResult = await buildForm601Input(dealId, bankId, sb);
        const rendered = await renderForm601Pdf({ supabase: sb, buildResult });
        if (!rendered.ok) return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
        return pdfResponse(rendered.pdfBytes, `form-601-${dealId}.pdf`);
      }

      case "912": {
        if (action === "build") {
          const result = await buildForm912WithSignature(dealId, sb);
          return NextResponse.json({ ok: true, dealId, ...result });
        }
        const ownershipEntityId = requireOwnershipEntityId(req);
        if (typeof ownershipEntityId !== "string") return ownershipEntityId;
        const input = await buildForm912Input(dealId, sb);
        const buildResult = buildForm912(input);
        const rendered = await renderForm912Pdf({ supabase: sb, buildResult, ownershipEntityId, dealId });
        if (!rendered.ok) return NextResponse.json({ ok: false, reason: rendered.reason, detail: rendered.detail }, { status: 422 });
        return pdfResponse(rendered.pdfBytes, `form-912-${dealId}-${ownershipEntityId}.pdf`);
      }

      default:
        return NextResponse.json({ ok: false, error: `unsupported_form: ${formId}` }, { status: 400 });
    }
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/sba/forms/[formId]/[action]]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, formId, action } = await ctx.params;
    const { dealId, bankId, userId } = await assertDealAccess(rawDealId);

    if (formId !== "722" || action !== "acknowledge") {
      return NextResponse.json({ ok: false, error: `unsupported_form_or_action: ${formId}/${action}` }, { status: 400 });
    }

    const result = await acknowledgeForm722(dealId, bankId, supabaseAdmin(), { acknowledgedByUserId: userId });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/sba/forms/[formId]/[action]] POST", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
