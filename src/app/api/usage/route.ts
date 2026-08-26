import { NextRequest, NextResponse } from "next/server";
import { resolveUserApiContext } from "@/lib/server/userApiContext";
import { checkContinueLimit } from "@/lib/usage/limits";

export const runtime = "nodejs";

/**
 * GET /api/usage
 * Get current user's usage stats (auth required)
 */
export async function GET(_req: NextRequest) {
  try {
    const actor = await resolveUserApiContext();
    if (!actor.ok) {
      return NextResponse.json(
        { error: actor.error },
        { status: actor.status },
      );
    }

    const limitCheck = await checkContinueLimit(actor.actorProfileId);

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
