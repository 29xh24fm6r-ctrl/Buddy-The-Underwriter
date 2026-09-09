import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { createStarterTemplateLibrary, listTemplates, upsertTemplate, TEMPLATE_TRIGGER_KEYS } from "@/lib/comms/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brokerageBankId = await getBrokerageBankId();
  try {
    const templates = await listTemplates(brokerageBankId);
    return NextResponse.json({ ok: true, templates, triggerKeys: TEMPLATE_TRIGGER_KEYS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (body?.action !== "create_starter_library") {
    return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
  }
  try {
    const brokerageBankId = await getBrokerageBankId();
    const result = await createStarterTemplateLibrary(brokerageBankId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

/** PUT { triggerKey, channel, subject?, body, active? } — create or update a template (versioned). */
export async function PUT(req: NextRequest) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  if (!(TEMPLATE_TRIGGER_KEYS as readonly string[]).includes(body?.triggerKey)) {
    return NextResponse.json({ ok: false, error: `triggerKey must be one of: ${TEMPLATE_TRIGGER_KEYS.join(", ")}` }, { status: 400 });
  }
  if (body?.channel !== "email" && body?.channel !== "sms") {
    return NextResponse.json({ ok: false, error: "channel must be email or sms" }, { status: 400 });
  }
  if (typeof body?.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ ok: false, error: "body is required" }, { status: 400 });
  }

  try {
    const template = await upsertTemplate({
      bankId: brokerageBankId,
      triggerKey: body.triggerKey,
      channel: body.channel,
      subject: body?.subject ?? null,
      body: body.body,
      active: body?.active ?? true,
    });
    return NextResponse.json({ ok: true, template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
