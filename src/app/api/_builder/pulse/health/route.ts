import "server-only";

import { NextResponse } from "next/server";
import { getPulseMcpStatus } from "@/lib/pulse/pulseMcpClient";
import { requireBuilderObserver } from "@/lib/auth/requireBuilderObserver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await requireBuilderObserver(req);
  if (!gate.ok)
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.status },
    );

  const status = await getPulseMcpStatus();
  return NextResponse.json({ ok: true, status });
}
