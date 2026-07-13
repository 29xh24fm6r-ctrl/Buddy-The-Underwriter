import "server-only";

/**
 * SPEC S3 A-4 — /api/deals/[dealId]/kyc
 * POST -> initiate a Persona IAL2 verification
 * GET  ?ownershipEntityId=... -> latest verification status
 *
 * Consolidates the former separate kyc/initiate (POST) and
 * kyc/status/[ownershipEntityId] (GET) route files into one file — route/
 * page slot budget discipline (see the Drift Log). The POST path changes
 * from /kyc/initiate to /kyc (caller updated: SbaSigningPanel.tsx); GET
 * had no caller.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { initiateKyc } from "@/lib/identity/kyc/service";
import { createPersonaInquiry, fetchPersonaInquiry, generatePersonaOneTimeLink } from "@/lib/identity/kyc/persona";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId, userId } = await assertDealAccess(rawDealId);

    const body = await req.json().catch(() => null);
    const ownershipEntityId = body?.ownership_entity_id;
    if (typeof ownershipEntityId !== "string" || !ownershipEntityId) {
      return NextResponse.json({ ok: false, error: "missing_ownership_entity_id" }, { status: 400 });
    }

    const templateId = process.env.PERSONA_TEMPLATE_ID_IAL2;
    if (!templateId) {
      return NextResponse.json({ ok: false, error: "persona_not_configured" }, { status: 503 });
    }

    const result = await initiateKyc(
      {
        dealId,
        bankId,
        ownershipEntityId,
        initiatorUserId: userId,
        initiatorIp: req.headers.get("x-forwarded-for"),
        initiatorUserAgent: req.headers.get("user-agent"),
      },
      {
        sb: supabaseAdmin(),
        persona: { createPersonaInquiry, fetchPersonaInquiry, generatePersonaOneTimeLink },
        templateId,
      },
    );

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: result.reason === "OWNER_NOT_FOUND" ? 404 : 500 });
    }

    return NextResponse.json({ ok: true, verification: result.verification, oneTimeLink: result.oneTimeLink, reused: result.reused });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/kyc] POST", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId } = await assertDealAccess(rawDealId);

    const ownershipEntityId = new URL(req.url).searchParams.get("ownershipEntityId");
    if (!ownershipEntityId) {
      return NextResponse.json({ ok: false, error: "missing_ownershipEntityId_query_param" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data } = await sb
      .from("borrower_identity_verifications")
      .select("*")
      .eq("deal_id", dealId)
      .eq("ownership_entity_id", ownershipEntityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ ok: true, verification: data ?? null });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/kyc] GET", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
