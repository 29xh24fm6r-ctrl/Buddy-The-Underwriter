import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { logActivity, type ActivityKind, type ActivityChannel, type ActivityDirection } from "@/lib/comms/activities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set(["note", "task", "call", "email", "sms", "meeting", "stage_change", "system"]);
const VALID_CHANNELS = new Set(["email", "sms", "call", "meeting", "portal", "system"]);
const VALID_DIRECTIONS = new Set(["inbound", "outbound"]);

async function gate(): Promise<{ userId: string } | NextResponse> {
  try {
    return await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
}

/**
 * POST /api/admin/brokerage/crm/activities — log one timeline entry.
 * Exactly one of dealId / organizationId / personId / leadId must be
 * provided (enforced again at the DB level). Supports the PR4 structured
 * fields (direction/channel/outcome/duration/follow-up/etc.) and
 * participantPersonIds for multi-person involvement.
 */
export async function POST(req: NextRequest) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;
  const { userId } = gated;

  const body = await req.json().catch(() => ({}) as any);
  const kind = typeof body?.kind === "string" ? body.kind : "note";
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ ok: false, error: "invalid kind" }, { status: 400 });
  }
  if (body?.channel && !VALID_CHANNELS.has(body.channel)) {
    return NextResponse.json({ ok: false, error: "invalid channel" }, { status: 400 });
  }
  if (body?.direction && !VALID_DIRECTIONS.has(body.direction)) {
    return NextResponse.json({ ok: false, error: "invalid direction" }, { status: 400 });
  }

  const targets = [body?.dealId, body?.organizationId, body?.personId, body?.leadId].filter(Boolean);
  if (targets.length !== 1) {
    return NextResponse.json(
      { ok: false, error: "exactly one of dealId, organizationId, personId, leadId is required" },
      { status: 400 },
    );
  }

  const brokerageBankId = await getBrokerageBankId();

  try {
    const activity = await logActivity({
      bankId: brokerageBankId,
      kind: kind as ActivityKind,
      title: typeof body?.title === "string" ? body.title : "",
      dealId: body?.dealId ?? null,
      organizationId: body?.organizationId ?? null,
      personId: body?.personId ?? null,
      leadId: body?.leadId ?? null,
      participantPersonIds: Array.isArray(body?.participantPersonIds) ? body.participantPersonIds : undefined,
      direction: (body?.direction as ActivityDirection) ?? null,
      channel: (body?.channel as ActivityChannel) ?? null,
      outcome: typeof body?.outcome === "string" ? body.outcome : null,
      durationSeconds: typeof body?.durationSeconds === "number" ? body.durationSeconds : null,
      followUpRequired: !!body?.followUpRequired,
      followUpDueAt: body?.followUpDueAt ?? null,
      actorClerkUserId: userId,
      assignedToClerkUserId: body?.assignedToClerkUserId ?? null,
      dueAt: body?.dueAt ?? null,
      properties: body?.properties ?? {},
    });
    return NextResponse.json({ ok: true, activity });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
