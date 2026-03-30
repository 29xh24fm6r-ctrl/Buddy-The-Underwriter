import { NextResponse } from "next/server";
import { safeClerkAuth, ClerkTimeoutError } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";

export async function GET() {
  const start = Date.now();
  console.log("[GET /api/debug/clerk] enter");

  try {
    const a = await safeClerkAuth(3000);
    return NextResponse.json({
      ok: true,
      userId: a?.userId ?? null,
      sessionId: a?.sessionId ? a.sessionId.slice(0, 8) + "..." : null,
      duration_ms: Date.now() - start,
    });
  } catch (err) {
    if (err instanceof ClerkTimeoutError) {
      return NextResponse.json({
        ok: false,
        error: "clerk_auth_timeout",
        duration_ms: Date.now() - start,
      }, { status: 503 });
    }

    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "unknown",
      duration_ms: Date.now() - start,
    }, { status: 500 });
  }
}
