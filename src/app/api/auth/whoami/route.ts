// src/app/api/auth/whoami/route.ts

import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId, sessionId } = await clerkAuth();

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated", userId: null, sessionId: null },
      { status: 401 },
    );
  }

  return NextResponse.json({ ok: true, userId, sessionId });
}
