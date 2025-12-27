import { getSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const supabase = getSupabaseServerClient();

  const { data } = await supabase
    .from("ai_events")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at");

  return NextResponse.json({ ledger: data });
}
