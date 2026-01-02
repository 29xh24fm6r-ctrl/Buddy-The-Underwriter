import { NextResponse } from "next/server";
import { clerkAuth, clerkCurrentUser } from "@/lib/auth/clerkServer";

export async function GET() {
  const { userId, sessionId } = await clerkAuth(); // ✅ MUST be awaited in route handlers
  const user = await clerkCurrentUser().catch(() => null);

  return NextResponse.json({
    _marker: "debug_v2_await_auth",
    userId: userId ?? null,
    sessionId: sessionId ?? null,
    hasUser: !!user,
    email: user?.emailAddresses?.[0]?.emailAddress ?? null,
  });
}
