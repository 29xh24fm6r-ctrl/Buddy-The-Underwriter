// src/app/api/deals/[dealId]/drafts/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftRow = {
  id: string;
  deal_id: string;
  status: "pending_approval" | "approved" | "sent" | "rejected" | string;
  subject: string | null;
  body: string | null;
  kind: string | null;
  fingerprint: string | null;
  created_at: string | null;
  updated_at: string | null;

  approved_by?: string | null;
  approved_at?: string | null;

  rejected_by?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;

  sent_at?: string | null;
  sent_via?: string | null;
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "missing_dealId" },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    // Cast query to any to avoid typed `never[]` results
    const q = (sb.from("draft_borrower_requests") as any)
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });

    const { data, error } = (await q) as {
      data: DraftRow[] | null;
      error: any;
    };

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message ?? String(error) },
        { status: 500 },
      );
    }

    const drafts: DraftRow[] = data ?? [];

    // Group by status (safe even if status is unknown)
    const grouped = {
      pending_approval: drafts.filter((d) => d.status === "pending_approval"),
      approved: drafts.filter((d) => d.status === "approved"),
      sent: drafts.filter((d) => d.status === "sent"),
      rejected: drafts.filter((d) => d.status === "rejected"),
    };

    return NextResponse.json({
      ok: true,
      drafts,
      grouped,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err ?? "unknown_error") },
      { status: 500 },
    );
  }
}
