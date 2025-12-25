/**
 * GET /api/packs/rankings
 *
 * Fetch pack rankings for a deal from borrower_pack_rankings view
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const dealId = searchParams.get("dealId");

  if (!dealId) {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }

  try {
    const sb = getSupabaseServerClient();

    // Query the borrower_pack_rankings view
    const { data: rankings, error } = await sb
      .from("borrower_pack_rankings")
      .select("*")
      .eq("deal_id", dealId)
      .order("rank", { ascending: true });

    if (error) {
      console.error("Error fetching pack rankings:", error);
      return NextResponse.json(
        { error: "Failed to fetch pack rankings" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      dealId,
      rankings: rankings || [],
      count: rankings?.length || 0,
    });
  } catch (error) {
    console.error("Pack rankings API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
