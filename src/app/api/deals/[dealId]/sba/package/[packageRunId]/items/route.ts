import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  ctx: { params: Promise<{ dealId: string; packageRunId: string }> },
) {
  try {
    const { packageRunId } = await ctx.params;
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("sba_package_run_items")
      .select(
        "id,template_code,title,sort_order,required,status,fill_run_id,output_storage_path,output_file_name,error,updated_at",
      )
      .eq("package_run_id", packageRunId)
      .order("sort_order", { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "sba_package_items_get_failed" },
      { status: 500 },
    );
  }
}
