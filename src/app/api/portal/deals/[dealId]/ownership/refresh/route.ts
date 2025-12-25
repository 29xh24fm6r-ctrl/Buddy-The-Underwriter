// src/app/api/portal/deals/[dealId]/ownership/refresh/route.ts
import { NextResponse } from "next/server";
import { requireValidInvite } from "@/lib/portal/auth";
import { extractOwnershipFindings } from "@/lib/ownership/extractor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs doc-first extraction using active doc_text_source mapping.
 * Safe if mapping isn't set (returns ok with 0).
 *
 * Called after borrower submits manual correction to refresh evidence chips.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    await requireValidInvite(token);

    const { dealId } = await ctx.params;
    const findings = await extractOwnershipFindings(dealId);
    return NextResponse.json({ ok: true, found: findings.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
