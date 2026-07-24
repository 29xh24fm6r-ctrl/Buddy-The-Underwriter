import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { computeIntelligenceAlerts } from "@/lib/intelligence/alerts";
import { setAlertFeedback, clearAlertFeedback } from "@/lib/intelligence/alertFeedback";
import type { AlertEntityType } from "@/lib/intelligence/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ENTITY_TYPES: AlertEntityType[] = ["lead", "deal", "organization", "task", "person"];
const VALID_STATES = ["acknowledged", "dismissed", "snoozed"] as const;

/**
 * GET /api/admin/brokerage/crm/intelligence/alerts?scope=personal|team
 * Explainable intelligence — spec section 7.7. scope=personal filters
 * feedback to the caller's own dismissals in addition to team-wide ones;
 * scope=team (default) only respects team-wide dismissals.
 */
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const bankId = await getBrokerageBankId();
  const scope = req.nextUrl.searchParams.get("scope") ?? "team";
  const alerts = await computeIntelligenceAlerts(bankId, scope === "personal" ? userId : null);
  return NextResponse.json({ ok: true, alerts });
}

/**
 * POST /api/admin/brokerage/crm/intelligence/alerts
 * Body: { action: "set", entityType, entityId, alertKey, state, reason?, snoozeUntilIso?, personal? }
 *     | { action: "clear", entityType, entityId, alertKey, personal? }
 */
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const bankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  if (!VALID_ENTITY_TYPES.includes(body?.entityType)) {
    return NextResponse.json({ ok: false, error: `entityType must be one of ${VALID_ENTITY_TYPES.join(", ")}` }, { status: 400 });
  }
  if (typeof body?.entityId !== "string" || typeof body?.alertKey !== "string") {
    return NextResponse.json({ ok: false, error: "entityId and alertKey are required" }, { status: 400 });
  }
  const feedbackUserId: string | null = body?.personal ? userId : null;

  try {
    if (body?.action === "clear") {
      await clearAlertFeedback(bankId, body.entityType, body.entityId, body.alertKey, feedbackUserId);
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "set") {
      if (!VALID_STATES.includes(body?.state)) {
        return NextResponse.json({ ok: false, error: `state must be one of ${VALID_STATES.join(", ")}` }, { status: 400 });
      }
      if ((body.state === "dismissed" || body.state === "snoozed") && (typeof body?.reason !== "string" || !body.reason.trim())) {
        return NextResponse.json({ ok: false, error: "reason is required to dismiss or snooze an alert" }, { status: 400 });
      }
      const feedback = await setAlertFeedback({
        bankId,
        entityType: body.entityType,
        entityId: body.entityId,
        alertKey: body.alertKey,
        state: body.state,
        userId: feedbackUserId,
        reason: body.reason ?? null,
        snoozeUntilIso: body.snoozeUntilIso ?? null,
      });
      return NextResponse.json({ ok: true, feedback });
    }
    return NextResponse.json({ ok: false, error: "action must be set or clear" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
