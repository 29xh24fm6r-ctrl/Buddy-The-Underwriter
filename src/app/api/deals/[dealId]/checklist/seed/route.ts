import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Preset = "core" | "sba7a" | "sba504";

const PRESETS: Record<
  Preset,
  { checklist_key: string; title: string; required: boolean }[]
> = {
  core: [
    {
      checklist_key: "PFS_CURRENT",
      title: "Personal Financial Statement (current)",
      required: true,
    },
    {
      checklist_key: "IRS_BUSINESS_2Y",
      title: "Business tax returns (last 2 years)",
      required: true,
    },
    {
      checklist_key: "IRS_PERSONAL_2Y",
      title: "Personal tax returns (last 2 years)",
      required: true,
    },
    {
      checklist_key: "FIN_STMT_YTD",
      title: "Year-to-date financial statement",
      required: true,
    },
    {
      checklist_key: "AR_AP_AGING",
      title: "A/R and A/P aging",
      required: false,
    },
    {
      checklist_key: "BANK_STMT_3M",
      title: "Bank statements (last 3 months)",
      required: false,
    },
  ],
  sba7a: [
    { checklist_key: "SBA_1919", title: "SBA Form 1919", required: true },
    {
      checklist_key: "SBA_912",
      title: "SBA Form 912 (Statement of Personal History)",
      required: false,
    },
    { checklist_key: "SBA_413", title: "SBA Form 413 (PFS)", required: true },
    {
      checklist_key: "SBA_DEBT_SCHED",
      title: "Business debt schedule",
      required: true,
    },
  ],
  sba504: [
    { checklist_key: "SBA_1244", title: "SBA Form 1244", required: true },
    { checklist_key: "SBA_413", title: "SBA Form 413 (PFS)", required: true },
    {
      checklist_key: "PROJECT_SOURCES_USES",
      title: "Sources & Uses / Project cost breakdown",
      required: true,
    },
  ],
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId)
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );

    const { dealId } = await ctx.params;
    const body = (await req.json().catch(() => null)) as {
      preset?: Preset;
    } | null;
    const preset = (body?.preset || "core") as Preset;

    const rows = (PRESETS[preset] || PRESETS.core).map((x) => ({
      deal_id: dealId,
      checklist_key: x.checklist_key,
      title: x.title,
      required: x.required,
    }));

    const { error } = await supabaseAdmin()
      .from("deal_checklist_items")
      .upsert(rows, { onConflict: "deal_id,checklist_key" });

    if (error) {
      console.error("[/api/deals/[dealId]/checklist/seed]", error);
      return NextResponse.json({
        ok: false,
        error: "Failed to seed checklist",
      });
    }

    // Normalize status for newly seeded rows without clobbering existing received items.
    try {
      const sb = supabaseAdmin();
      await sb
        .from("deal_checklist_items")
        .update({ status: "missing" })
        .eq("deal_id", dealId)
        .in(
          "checklist_key",
          rows.map((r) => r.checklist_key),
        )
        .is("status", null);
    } catch (e) {
      console.warn("[/api/deals/[dealId]/checklist/seed] status normalization failed (non-fatal):", e);
    }

    // Emit ledger event
    await writeEvent({
      dealId,
      kind: "checklist.seeded",
      actorUserId: userId,
      input: {
        preset,
        checklist_keys: rows.map((r) => r.checklist_key),
        count_inserted: rows.length,
      },
      meta: { route: "checklist/seed" },
    });

    return NextResponse.json({ ok: true, count: rows.length, event_emitted: true });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/checklist/seed]", error);
    return NextResponse.json({
      ok: false,
      error: "Failed to seed checklist",
    });
  }
}

