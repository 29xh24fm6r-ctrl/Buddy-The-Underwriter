// src/app/api/deals/[dealId]/portal/seed-requests/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-way sync:
 * - Creates borrower_document_requests for open deal_conditions and open deal_mitigants
 * - Idempotent: matches by (deal_id, title)
 */
export async function POST(_req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .single();

  if (dealErr || !deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const { data: conditions = [] } = await sb
    .from("deal_conditions")
    .select("id,title,status,due_at")
    .eq("deal_id", dealId)
    .neq("status", "satisfied");

  const { data: mitigants = [] } = await sb
    .from("deal_mitigants")
    .select("id,title,status,due_at")
    .eq("deal_id", dealId)
    .neq("status", "satisfied");

  const desired = [
    ...conditions.map((c: any) => ({
      deal_id: dealId,
      bank_id: deal.bank_id,
      title: c.title,
      description: "Requested due to a deal condition.",
      category: "condition",
      status: "requested",
      due_at: c.due_at ?? null,
    })),
    ...mitigants.map((m: any) => ({
      deal_id: dealId,
      bank_id: deal.bank_id,
      title: m.title,
      description: "Requested due to a deal mitigant.",
      category: "mitigant",
      status: "requested",
      due_at: m.due_at ?? null,
    })),
  ];

  // Fetch existing titles
  const { data: existing = [] } = await sb
    .from("borrower_document_requests")
    .select("id,title")
    .eq("deal_id", dealId);

  const existingTitles = new Set((existing || []).map((r: any) => String(r.title)));

  const toInsert = desired.filter((r) => !existingTitles.has(String(r.title)));

  if (toInsert.length) {
    const { error } = await sb.from("borrower_document_requests").insert(toInsert);
    if (error) return NextResponse.json({ error: "Failed to seed requests" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    inserted: toInsert.length,
    totalDesired: desired.length,
  });
}
