import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    runtime: "edge",
    timestamp: new Date().toISOString(),
  });
}
