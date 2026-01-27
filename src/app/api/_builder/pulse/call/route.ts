import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { pulseToolCall } from "@/lib/pulse/pulseMcpClient";
import { requireBuilderObserver } from "@/lib/auth/requireBuilderObserver";
import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
  dealId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const gate = await requireBuilderObserver(req);
  if (!gate.ok)
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.status },
    );

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "bad_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { tool, arguments: args, dealId } = parsed.data;

  try {
    const result = await pulseToolCall({ name: tool, arguments: args });

    await emitBuddySignalServer({
      type: "pulse.mcp.tool.called",
      ts: Date.now(),
      source: "api/_builder/pulse/call",
      dealId,
      payload: { tool, ok: true },
    });

    return NextResponse.json({ ok: true, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown_error";

    await emitBuddySignalServer({
      type: "pulse.mcp.tool.failed",
      ts: Date.now(),
      source: "api/_builder/pulse/call",
      dealId,
      payload: { tool, error: msg },
    });

    return NextResponse.json(
      { ok: false, error: "pulse_tool_failed", message: msg },
      { status: 500 },
    );
  }
}
