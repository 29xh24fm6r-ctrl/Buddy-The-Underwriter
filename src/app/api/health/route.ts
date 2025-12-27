import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  // validates required env (OpenAI + Clerk + Supabase URL/key)
  const env = getEnv();

  return NextResponse.json(
    {
      ok: true,
      ts: new Date().toISOString(),
      service: "buddy-the-underwriter",
      nodeEnv: env.nodeEnv,
      hasServiceRole: env.hasServiceRole,
    },
    { status: 200 }
  );
}
