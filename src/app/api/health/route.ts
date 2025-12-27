import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env/server";

export const runtime = "nodejs";

export async function GET() {
  // Validates env at runtime
  serverEnv();

  const now = new Date().toISOString();
  return NextResponse.json(
    {
      ok: true,
      ts: now,
      service: "buddy-the-underwriter",
    },
    { status: 200 }
  );
}
