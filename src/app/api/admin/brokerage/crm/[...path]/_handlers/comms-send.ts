import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { sendCrmEmail, sendCrmTemplateEmail } from "@/lib/comms/sendEmail";
import { sendCrmTemplateSms, sendCrmSms } from "@/lib/comms/sendSms";
import { logCallOutcome, logMeeting } from "@/lib/comms/manual";
import { DoNotContactError } from "@/lib/comms/doNotContact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/brokerage/crm/comms/send
 * Body: { channel: "email"|"sms"|"call"|"meeting", ... }
 *
 * One dispatcher for every real send + manual log this PR supports —
 * mirrors the actions-dispatcher precedent from PR2/PR3 rather than one
 * route per channel. "call"/"meeting" never send anything (no telephony
 * provider exists) — they're the manual-outcome-logging workflow §6.3
 * asks for when no provider is provisioned.
 */
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);
  const channel = body?.channel;

  const target = {
    dealId: body?.dealId ?? null,
    organizationId: body?.organizationId ?? null,
    personId: body?.personId ?? null,
    leadId: body?.leadId ?? null,
  };

  try {
    switch (channel) {
      case "email": {
        if (typeof body?.to !== "string" || !body.to) {
          return NextResponse.json({ ok: false, error: "to is required" }, { status: 400 });
        }
        const result = body?.templateTriggerKey
          ? await sendCrmTemplateEmail({ bankId: brokerageBankId, to: body.to, ...target, participantPersonIds: body?.participantPersonIds, triggerKey: body.templateTriggerKey, mergeFields: body?.mergeFields, actorClerkUserId: userId })
          : await sendCrmEmail({ bankId: brokerageBankId, to: body.to, ...target, participantPersonIds: body?.participantPersonIds, subject: body?.subject ?? "", body: body?.body ?? "", followUpRequired: !!body?.followUpRequired, followUpDueAt: body?.followUpDueAt ?? null, actorClerkUserId: userId });
        return NextResponse.json({ ok: true, ...result });
      }
      case "sms": {
        if (typeof body?.to !== "string" || !body.to) {
          return NextResponse.json({ ok: false, error: "to is required" }, { status: 400 });
        }
        const result = body?.templateTriggerKey
          ? await sendCrmTemplateSms({ bankId: brokerageBankId, to: body.to, ...target, triggerKey: body.templateTriggerKey, mergeFields: body?.mergeFields, actorClerkUserId: userId })
          : await sendCrmSms({ bankId: brokerageBankId, to: body.to, ...target, body: body?.body ?? "", actorClerkUserId: userId });
        return NextResponse.json({ ok: true, ...result });
      }
      case "call": {
        if (!["inbound", "outbound"].includes(body?.direction)) {
          return NextResponse.json({ ok: false, error: "direction must be inbound or outbound" }, { status: 400 });
        }
        if (typeof body?.outcome !== "string" || !body.outcome) {
          return NextResponse.json({ ok: false, error: "outcome is required" }, { status: 400 });
        }
        const activity = await logCallOutcome({ bankId: brokerageBankId, ...target, direction: body.direction, outcome: body.outcome, durationSeconds: body?.durationSeconds ?? null, followUpRequired: !!body?.followUpRequired, followUpDueAt: body?.followUpDueAt ?? null, actorClerkUserId: userId });
        return NextResponse.json({ ok: true, activity });
      }
      case "meeting": {
        if (typeof body?.title !== "string" || !body.title) {
          return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });
        }
        const result = await logMeeting({ bankId: brokerageBankId, ...target, title: body.title, participantPersonIds: body?.participantPersonIds, meetingLink: body?.meetingLink ?? null, durationSeconds: body?.durationSeconds ?? null, outcome: body?.outcome ?? null, commitmentsMade: body?.commitmentsMade, actorClerkUserId: userId });
        return NextResponse.json({ ok: true, ...result });
      }
      default:
        return NextResponse.json({ ok: false, error: "channel must be email, sms, call, or meeting" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof DoNotContactError) {
      return NextResponse.json({ ok: false, error: e.message, code: "do_not_contact" }, { status: 403 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
