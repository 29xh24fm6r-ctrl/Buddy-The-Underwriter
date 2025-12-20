// src/app/api/portal/deals/[dealId]/buddy/missing-doc/route.ts
import { NextResponse } from "next/server";
import { requireValidInvite } from "@/lib/portal/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canonical borrower-safe helper:
 * - Accepts which checklist item they're stuck on and a short explanation
 * - Returns: reassurance + suggested substitutes + a banker message draft (borrower can send)
 * - No credit/risk/underwriting terms allowed
 */
export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace(/^Bearer\s+/i, "");
    
    const invite = await requireValidInvite(token);
    const { dealId } = await ctx.params;

    // Verify deal matches invite
    if (invite.deal_id !== dealId) throw new Error("Deal ID mismatch");

    const body = await req.json();

    const itemTitle = String(body?.itemTitle ?? "").trim();
    const stuckReason = String(body?.stuckReason ?? "").trim(); // "can't find it", "accountant has it", etc.

    if (!itemTitle) throw new Error("Missing itemTitle.");

    // Deterministic substitute suggestions (safe + broad)
    // IMPORTANT: keep generic. Banker will decide what's acceptable.
    const substitutes =
      itemTitle.toLowerCase().includes("tax")
        ? [
            "A copy of what you have (even last year) is helpful to start.",
            "If your accountant has it, you can upload an email or note saying they're preparing it.",
            "If you have business bank statements, those can help us keep moving while we wait.",
          ]
        : itemTitle.toLowerCase().includes("financial")
        ? [
            "If statements aren't ready, upload a P&L / balance sheet draft or screenshots from your accounting software.",
            "Business bank statements can help us keep moving in the meantime.",
          ]
        : [
            "Upload anything close (photo, screenshot, partial document) — we'll guide you from there.",
            "If someone else has it (accountant/bookkeeper), tell us who and when you expect it.",
          ];

    const reassurance =
      "No worries — this happens all the time. You're not behind, and you don't need to be perfect. Upload what you have and we'll guide the rest.";

    // Create a borrower-to-banker message draft (borrower-safe, actionable)
    const bankerDraft =
      `Hi team — I'm having trouble locating: ${itemTitle}. ` +
      (stuckReason ? `Reason: ${stuckReason}. ` : "") +
      `What's the best substitute I can upload now to keep things moving?`;

    return NextResponse.json({
      ok: true,
      reassurance,
      substitutes,
      bankerDraft,
      cta: "Send this note to my bank",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
