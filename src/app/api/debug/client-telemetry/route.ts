import { NextRequest, NextResponse } from "next/server";
import { safeClerkAuth } from "@/lib/auth/clerkServer";
import { sanitizeClientTelemetry } from "@/lib/observability/clientTelemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  let userId: string | null = null;
  try {
    ({ userId } = await safeClerkAuth(3_000));
  } catch {
    return json({ ok: false, error: "authentication_unavailable" }, 503);
  }
  if (!userId) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "payload_too_large" }, 413);
  }

  let raw: unknown;
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: "payload_too_large" }, 413);
    }
    raw = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  const payload = sanitizeClientTelemetry(
    raw,
    req.headers.get("x-request-id"),
  );
  if (!payload) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  console.info("[client-telemetry]", payload);
  return json({ ok: true }, 202);
}
