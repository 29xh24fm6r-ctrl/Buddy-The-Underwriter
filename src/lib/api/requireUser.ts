// src/lib/api/requireUser.ts
import { NextResponse } from "next/server";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";

export async function requireUser() {
  const a = await clerkAuth();
  if (!isClerkConfigured()) {
    return {
      ok: false as const,
      res: NextResponse.json(
        {
          ok: false,
          error: "Auth not configured (Clerk keys missing/placeholder).",
        },
        { status: 503 }
      ),
      userId: null as string | null,
    };
  }
  if (!a.userId) {
    return {
      ok: false as const,
      res: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
      userId: null as string | null,
    };
  }
  return { ok: true as const, userId: a.userId };
}
