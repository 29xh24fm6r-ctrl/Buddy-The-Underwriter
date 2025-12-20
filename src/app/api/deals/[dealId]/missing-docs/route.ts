import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("deal_missing_docs")
      .select("key,label,severity,reason,status,updated_at")
      .eq("deal_id", dealId)
      .order("severity", { ascending: true });

    if (error) throw new Error(error.message);

    const missing = (data ?? [])
      .filter((r) => r.status === "missing")
      .map((r) => ({
        key: r.key,
        label: r.label,
        severity: r.severity,
        reason: r.reason,
      }));

    return NextResponse.json({ ok: true, missing });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "missing_docs_get_failed" }, { status: 500 });
  }
}
