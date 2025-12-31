import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";
import type { ChecklistItem } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECKLIST_DEFINITIONS: Record<string, { title: string; required: boolean }> = {
  PFS_CURRENT: { title: "Personal Financial Statement (current)", required: true },
  IRS_BUSINESS_2Y: { title: "Business tax returns (last 2 years)", required: true },
  IRS_PERSONAL_2Y: { title: "Personal tax returns (last 2 years)", required: true },
  FIN_STMT_YTD: { title: "Year-to-date financial statement", required: true },
  AR_AP_AGING: { title: "A/R and A/P aging", required: false },
  BANK_STMT_3M: { title: "Bank statements (last 3 months)", required: false },
  SBA_1919: { title: "SBA Form 1919", required: false },
  SBA_912: { title: "SBA Form 912 (Statement of Personal History)", required: false },
  SBA_413: { title: "SBA Form 413 (PFS)", required: false },
  SBA_DEBT_SCHED: { title: "Business debt schedule", required: false },
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    // ✅ Only select columns that exist in deal_checklist_items schema
    const { data: items, error } = await sb
      .from("deal_checklist_items")
      .select(
        "id, deal_id, checklist_key, title, description, required, status, received_at, received_file_id, created_at"
      )
      .eq("deal_id", dealId);

    if (error) {
      console.error("[/api/deals/[dealId]/checklist/list]", error);
      return NextResponse.json({ ok: false, items: [], error: "Failed to load checklist" });
    }

    const enrichedItems: ChecklistItem[] = (items || []).map((item: any) => {
      const def = CHECKLIST_DEFINITIONS[item.checklist_key];
      return {
        ...item,
        title: item.title || def?.title || item.checklist_key,
        required:
          typeof item.required === "boolean" ? item.required : (def?.required ?? false),
      };
    });

    enrichedItems.sort((a: any, b: any) => {
      // 1) required first
      if (a.required !== b.required) return a.required ? -1 : 1;

      // 2) created_at asc (earliest first)
      if (a.created_at && b.created_at && a.created_at !== b.created_at) {
        return String(a.created_at).localeCompare(String(b.created_at));
      }

      // 3) stable tie-breaker by checklist_key
      return String(a.checklist_key).localeCompare(String(b.checklist_key));
    });

    return NextResponse.json({ ok: true, items: enrichedItems });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/checklist/list]", error);
    return NextResponse.json({ ok: false, items: [], error: "Failed to load checklist" });
  }
}
