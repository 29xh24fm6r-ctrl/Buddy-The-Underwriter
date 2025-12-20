// src/app/api/portal/deals/[dealId]/ownership/findings/route.ts
import { NextResponse } from "next/server";
import { requireValidInvite } from "@/lib/portal/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Borrower-safe ownership findings view.
 * 
 * Returns:
 * - Proposed owner cards (name, percent, confidence tag, evidence snippet)
 * - Confirmed owners (already in deal_owners)
 * - What happens next text
 */
function confidenceTag(c: number) {
  if (c >= 0.78) return "High";
  if (c >= 0.58) return "Medium";
  return "Low";
}

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const invite = await requireValidInvite(token);
    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    // Get proposed findings
    const { data: findings, error: fErr } = await sb
      .from("deal_ownership_findings")
      .select("*")
      .eq("deal_id", dealId)
      .eq("status", "proposed")
      .order("confidence", { ascending: false });

    if (fErr) throw fErr;

    // Get confirmed owners
    const { data: owners, error: oErr } = await sb
      .from("deal_owners")
      .select("id, full_name, ownership_percent, requires_personal_package")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true });

    if (oErr) throw oErr;

    // Map findings to borrower-safe cards
    const proposedCards = (findings ?? []).map((f: any) => ({
      id: String(f.id),
      fullName: String(f.full_name),
      ownershipPercent: f.ownership_percent ? Number(f.ownership_percent) : null,
      confidenceTag: confidenceToTag(Number(f.confidence ?? 0.5)),
      evidenceLabel: f.evidence_doc_label ? String(f.evidence_doc_label) : null,
      evidencePage: f.evidence_page ? Number(f.evidence_page) : null,
      evidenceSnippet: f.evidence_snippet ? String(f.evidence_snippet).slice(0, 120) : null,
    }));

    const confirmedCards = (owners ?? []).map((o: any) => ({
      id: String(o.id),
      fullName: String(o.full_name),
      ownershipPercent: o.ownership_percent ? Number(o.ownership_percent) : null,
      requiresPersonalPackage: Boolean(o.requires_personal_package),
    }));

    // Calculate coverage
    const totalPercent = confirmedCards.reduce((sum, c) => sum + (c.ownershipPercent ?? 0), 0);
    const coverage = totalPercent >= 80 ? "complete" : totalPercent >= 50 ? "partial" : "minimal";

    return NextResponse.json({
      ok: true,
      proposed: proposedCards,
      confirmed: confirmedCards,
      coverage: {
        totalPercent: Math.round(totalPercent * 10) / 10,
        status: coverage,
        message:
          coverage === "complete"
            ? "Ownership is confirmed."
            : coverage === "partial"
            ? "We have partial ownership. Please confirm or add the remaining owners."
            : "We need ownership details to proceed.",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}

function confidenceToTag(confidence: number): string {
  if (confidence >= 0.75) return "High";
  if (confidence >= 0.55) return "Medium";
  return "Low";
}
