import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId, sessionId } = await clerkAuth();
  return NextResponse.json({ userId, sessionId });
}
