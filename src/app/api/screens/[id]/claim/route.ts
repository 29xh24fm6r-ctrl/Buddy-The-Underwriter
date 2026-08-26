import { NextRequest, NextResponse } from "next/server";
import { resolveUserApiContext } from "@/lib/server/userApiContext";
import { isValidScreenId } from "@/lib/screens/idgen";

export const runtime = "nodejs";

/**
 * POST /api/screens/:id/claim
 * Claim a public, unowned screen artifact (Clerk auth required).
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!isValidScreenId(id)) {
      return NextResponse.json({ error: "Invalid screen ID" }, { status: 400 });
    }

    const actor = await resolveUserApiContext();
    if (!actor.ok) {
      return NextResponse.json(
        {
          error: actor.error,
          redirect: `/auth?next=/s/${id}`,
        },
        { status: actor.status },
      );
    }

    const { data, error } = await actor.sb
      .from("screen_artifacts")
      .update({
        owner_id: actor.actorProfileId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("is_public", true)
      .is("owner_id", null)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[screen claim] update failed", {
        screenId: id,
        code: error.code,
      });
      return NextResponse.json(
        { error: "Failed to claim screen" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Screen is unavailable or already claimed" },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[screen claim] unexpected failure", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
