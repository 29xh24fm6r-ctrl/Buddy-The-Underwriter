import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { checkContinueLimit } from "@/lib/usage/limits";

export const runtime = "nodejs";

/**
 * GET /api/usage
 * Get current user's usage stats (auth required)
 */
export async function GET(req: NextRequest) {
  try {
    const sb = await getSupabaseServerClient();

    const {
      data: { user },
    } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const limitCheck = await checkContinueLimit(user.id);

    return NextResponse.json({
      ok: true,
      usage: limitCheck.usage,
      allowed: limitCheck.allowed,
    });
  } catch (err) {
    console.error("Usage check error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
