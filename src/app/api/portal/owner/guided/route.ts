// src/app/api/portal/owner/guided/route.ts
import { NextResponse } from "next/server";
import { requireValidOwnerPortal } from "@/lib/portal/ownerAuth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { dealId, ownerId } = await requireValidOwnerPortal(req);
    const sb = supabaseAdmin();

    const { data: owner, error: oErr } = await sb
      .from("deal_owners")
      .select(
        "id, full_name, email, requires_personal_package, ownership_percent",
      )
      .eq("id", ownerId)
      .maybeSingle();

    if (oErr) throw oErr;

    const { data: items, error: iErr } = await sb
      .from("deal_owner_checklist_items")
      .select("*")
      .eq("owner_id", ownerId)
      .order("sort_order", { ascending: true });

    if (iErr) throw iErr;

    const { data: state, error: sErr } = await sb
      .from("deal_owner_checklist_state")
      .select("*")
      .eq("owner_id", ownerId);

    if (sErr) throw sErr;

    const stateByItem = new Map((state ?? []).map((r: any) => [r.item_id, r]));
    const merged = (items ?? []).map((it: any) => ({
      id: it.id,
      code: it.code,
      title: it.title,
      description: it.description,
      required: it.required,
      status: (stateByItem.get(it.id)?.status ?? "missing") as
        | "missing"
        | "received"
        | "verified",
      completedAt: stateByItem.get(it.id)?.completed_at ?? null,
    }));

    const required = merged.filter((x) => x.required);
    const done = required.filter((x) => x.status !== "missing");
    const progress = {
      requiredTotal: required.length,
      requiredDone: done.length,
      percent: required.length
        ? Math.round((done.length / required.length) * 100)
        : 100,
    };

    return NextResponse.json({
      ok: true,
      owner: owner ?? { full_name: "Owner" },
      progress,
      checklist: merged,
      dealId,
      ownerId,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
