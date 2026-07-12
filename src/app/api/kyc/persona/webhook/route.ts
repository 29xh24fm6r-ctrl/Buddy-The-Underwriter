import "server-only";

/** SPEC S3 A-4 — POST /api/kyc/persona/webhook */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyPersonaWebhookSignature } from "@/lib/identity/kyc/verifyPersonaWebhook";
import { handlePersonaWebhook } from "@/lib/identity/kyc/service";
import { createPersonaInquiry, fetchPersonaInquiry, generatePersonaOneTimeLink } from "@/lib/identity/kyc/persona";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const secret = process.env.PERSONA_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[/api/kyc/persona/webhook] PERSONA_WEBHOOK_SECRET not configured");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const valid = verifyPersonaWebhookSignature(rawBody, req.headers.get("Persona-Signature"), secret);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await handlePersonaWebhook(payload, {
      sb: supabaseAdmin(),
      persona: { createPersonaInquiry, fetchPersonaInquiry, generatePersonaOneTimeLink },
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 422 });
    }
    return NextResponse.json({ ok: true, verification_id: result.verification_id, status: result.status });
  } catch (e) {
    console.error("[/api/kyc/persona/webhook]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
