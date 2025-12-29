import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

export async function GET() {
  const { userId, sessionId } = await auth(); // ✅ await
  const user = await currentUser();

  return NextResponse.json({
    userId,
    sessionId,
    hasUser: !!user,
    email: user?.emailAddresses?.[0]?.emailAddress ?? null,
  });
}
