import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getRequestId } from "@/lib/obs/requestId";
import { requireOpenAIKey } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = getRequestId();

  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "not_authenticated", requestId }, { status: 401 });
  }

  const { sdp, model } = await req.json().catch(() => ({ sdp: null, model: null }));
  if (!sdp || typeof sdp !== "string") {
    return NextResponse.json({ ok: false, error: "missing_sdp", requestId }, { status: 400 });
  }

  const apiKey = requireOpenAIKey();
  const m = typeof model === "string" && model.trim() ? model.trim() : "gpt-4o-realtime-preview-2024-12-17";

  const baseUrl = "https://api.openai.com/v1/realtime";
  const r = await fetch(`${baseUrl}?model=${encodeURIComponent(m)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/sdp",
    },
    body: sdp,
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return NextResponse.json(
      { ok: false, error: "realtime_connect_failed", status: r.status, body: text.slice(0, 800), requestId },
      { status: 502 }
    );
  }

  const answerSdp = await r.text();
  return new NextResponse(answerSdp, { status: 200, headers: { "Content-Type": "application/sdp", "x-request-id": requestId } });
}
