import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

export async function GET() {
  const { userId, sessionId } = await auth(); // ✅ MUST be awaited in route handlers
  const user = await currentUser().catch(() => null);

  return NextResponse.json({
    _marker: "debug_v2_await_auth",
    userId: userId ?? null,
    sessionId: sessionId ?? null,
    hasUser: !!user,
    email: user?.emailAddresses?.[0]?.emailAddress ?? null,
  });
}
