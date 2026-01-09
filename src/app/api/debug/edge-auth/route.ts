import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId, sessionId } = await clerkAuth();
    return NextResponse.json({ ok: true, runtime: "edge", userId, sessionId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, runtime: "edge", error: String(e?.message || e) },
      { status: 500 },
    );
  }
}
