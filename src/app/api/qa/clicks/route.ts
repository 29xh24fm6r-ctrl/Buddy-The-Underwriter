import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { clerkAuth, clerkCurrentUser } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { logDemoUsageEvent } from "@/lib/tenant/demoTelemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sessionId: z.string().min(4).max(200),
  payload: z.record(z.string(), z.any()),
});

function isQaRequest(req: Request) {
  if (process.env.QA_MODE === "1" || process.env.NEXT_PUBLIC_QA_MODE === "1") return true;
  return req.headers.get("x-qa-mode") === "1";
}

function stripQuery(path?: string | null) {
  const value = String(path || "");
  const idx = value.indexOf("?");
  return idx === -1 ? value : value.slice(0, idx);
}

async function getPrimaryEmail(): Promise<string | null> {
  const user = await clerkCurrentUser();
  const primary = user?.emailAddresses?.find(
    (e) => e.id === user.primaryEmailAddressId,
  );
  return (
    primary?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null
  );
}

export async function POST(req: Request) {
  if (!isQaRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "qa_mode_disabled" },
      { status: 403 },
    );
  }

  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let parsed;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 },
    );
  }

  try {
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const { error } = await sb.from("qa_click_events").insert({
      bank_id: bankId,
      clerk_user_id: userId,
      session_id: parsed.sessionId,
      path: String(parsed.payload?.path ?? ""),
      event_type: "click",
      payload_json: parsed.payload,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: "insert_failed", detail: error.message },
        { status: 500 },
      );
    }

    const email = await getPrimaryEmail();
    const route = stripQuery(parsed.payload?.path ?? "");
    const testId = parsed.payload?.element?.testId ?? null;
    const qaId = parsed.payload?.element?.qaId ?? null;
    const label = testId || qaId || parsed.payload?.element?.id || null;

    await logDemoUsageEvent({
      email,
      bankId,
      path: route,
      eventType: "click",
      label,
      meta: {
        sessionId: parsed.sessionId,
        tag: parsed.payload?.element?.tag ?? null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "qa_capture_failed" },
      { status: 500 },
    );
  }
}
