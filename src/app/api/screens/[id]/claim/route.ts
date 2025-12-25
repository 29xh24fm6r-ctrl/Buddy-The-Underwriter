import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isValidScreenId } from "@/lib/screens/idgen";

export const runtime = "edge";

/**
 * POST /api/screens/:id/claim
 * Claim screen artifact (auth required)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const id = params.id;

    if (!isValidScreenId(id)) {
      return NextResponse.json({ error: "Invalid screen ID" }, { status: 400 });
    }

    const sb = await getSupabaseServerClient();

    // Check auth
    const {
      data: { user },
    } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Authentication required", redirect: `/auth?next=/s/${id}` },
        { status: 401 },
      );
    }

    // Claim the screen (set owner_id)
    const { error } = await sb
      .from("screen_artifacts")
      .update({ owner_id: user.id, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("is_public", true)
      .is("owner_id", null); // Only claim if unclaimed

    if (error) {
      console.error("Claim error:", error);
      return NextResponse.json(
        { error: "Failed to claim screen" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Claim error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
