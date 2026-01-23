import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || `upload_session_${Date.now()}`;
  return NextResponse.json(
    { ok: false, error: "deprecated_use_bootstrap", requestId },
    { status: 410 },
  );
}
