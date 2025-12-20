// src/app/api/portal/share/view/route.ts
import { NextResponse } from "next/server";
import { requireValidShareToken } from "@/lib/portal/shareAuth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { share, dealId, checklistItemIds } = await requireValidShareToken(req);
    const sb = supabaseAdmin();

    // Pull borrower-safe checklist item labels (only scoped IDs)
    const { data: items, error: iErr } = await sb
      .from("deal_portal_checklist_items")
      .select("id, title, description")
      .eq("deal_id", dealId)
      .in("id", checklistItemIds);

    if (iErr) throw iErr;

    // Deal display (best-effort; borrower-safe)
    let dealName = "Application";
    try {
      const { data: d } = await sb.from("deals").select("id, name").eq("id", dealId).maybeSingle();
      if (d?.name) dealName = d.name;
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: true,
      view: {
        dealName,
        requestedItems: (items ?? []).map((x: any) => ({
          id: String(x.id),
          title: String(x.title),
          description: x.description ? String(x.description) : null,
        })),
        note: share.note ? String(share.note) : null,
        recipientName: share.recipient_name ? String(share.recipient_name) : null,
        expiresAt: String(share.expires_at),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
