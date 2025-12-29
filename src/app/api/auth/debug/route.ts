import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

export async function GET() {
  const a = auth();
  const user = await currentUser().catch(() => null);

  return NextResponse.json({
    userId: a.userId ?? null,
    sessionId: a.sessionId ?? null,
    hasUser: !!user,
    email: user?.emailAddresses?.[0]?.emailAddress ?? null,
  });
}
