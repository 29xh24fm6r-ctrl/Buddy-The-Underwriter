import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { safeClerkAuth, clerkCurrentUser } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { logDemoUsageEvent } from "@/lib/tenant/demoTelemetry";
import { sanitizeQaClickCapture } from "@/lib/qaClickTelemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;
const SANDBOX_BANK_CODE = "SANDBOX";

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isQaCaptureEnabled() {
  return process.env.QA_MODE === "1";
}

async function getPrimaryEmail(): Promise<string | null> {
  const user = await clerkCurrentUser();
  const primary = user?.emailAddresses?.find(
    (email) => email.id === user.primaryEmailAddressId,
  );
  return (
    primary?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null
  );
}

export async function POST(req: NextRequest) {
  if (!isQaCaptureEnabled()) {
    return json({ ok: false, error: "qa_mode_disabled" }, 403);
  }

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

  const parsed = sanitizeQaClickCapture(raw);
  if (!parsed) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  try {
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const { data: bank, error: bankError } = await sb
      .from("banks")
      .select("id, code, is_sandbox")
      .eq("id", bankId)
      .maybeSingle();

    if (bankError) {
      return json({ ok: false, error: "qa_scope_check_failed" }, 503);
    }
    if (!bank || (!bank.is_sandbox && bank.code !== SANDBOX_BANK_CODE)) {
      return json({ ok: false, error: "qa_scope_forbidden" }, 403);
    }

    const { data: inserted, error: insertError } = await sb
      .from("qa_click_events")
      .insert({
        bank_id: bankId,
        clerk_user_id: userId,
        session_id: parsed.sessionId,
        path: parsed.payload.path,
        event_type: "click",
        payload_json: parsed.payload,
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      return json({ ok: false, error: "insert_failed" }, 503);
    }

    const email = await getPrimaryEmail();
    const label =
      parsed.payload.element.testId ?? parsed.payload.element.qaId ?? null;

    await logDemoUsageEvent({
      email,
      bankId,
      path: parsed.payload.path,
      eventType: "click",
      label,
      meta: {
        sessionId: parsed.sessionId,
        tag: parsed.payload.element.tag,
      },
    });

    return json({ ok: true }, 202);
  } catch {
    return json({ ok: false, error: "qa_capture_failed" }, 503);
  }
}
