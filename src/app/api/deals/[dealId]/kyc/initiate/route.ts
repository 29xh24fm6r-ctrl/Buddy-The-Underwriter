import "server-only";

/** SPEC S3 A-4 — POST /api/deals/[dealId]/kyc/initiate */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { initiateKyc } from "@/lib/identity/kyc/service";
import { createPersonaInquiry, fetchPersonaInquiry, generatePersonaOneTimeLink } from "@/lib/identity/kyc/persona";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId, userId } = await requireDealAccess(rawDealId);

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
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/kyc/initiate]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
