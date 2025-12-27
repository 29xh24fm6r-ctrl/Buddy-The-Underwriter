import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "buddy-the-underwriter",
    env: process.env.VERCEL_ENV ?? "unknown",
    timestamp: new Date().toISOString(),
  });
}
