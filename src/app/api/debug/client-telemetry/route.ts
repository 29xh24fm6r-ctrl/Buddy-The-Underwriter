import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type TelemetryPayload = {
  request_id?: string | null;
  stage?: string | null;
  message?: string | null;
  meta?: Record<string, unknown> | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as TelemetryPayload | null;

    const payload: TelemetryPayload = {
      request_id: body?.request_id ?? req.headers.get("x-request-id") ?? null,
      stage: body?.stage ?? null,
      message: body?.message ?? null,
      meta: body?.meta ?? null,
    };

    console.log("[client-telemetry]", {
      ...payload,
      host: req.headers.get("host"),
      referer: req.headers.get("referer"),
      userAgent: req.headers.get("user-agent"),
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[client-telemetry] error", {
      message: e?.message ?? String(e),
      name: e?.name,
    });
    return NextResponse.json({ ok: false, error: "failed" }, { status: 200 });
  }
}
