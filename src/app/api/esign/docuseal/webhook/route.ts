import "server-only";

/** SPEC S3 B-7 — POST /api/esign/docuseal/webhook */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyDocusealWebhookSignature } from "@/lib/esign/docuseal/verifyDocusealWebhook";
import { handleDocusealWebhook } from "@/lib/esign/docuseal/service";
import {
  createDocusealSubmission,
  fetchDocusealSubmission,
  downloadDocusealSignedPdf,
  downloadDocusealAuditTrail,
} from "@/lib/esign/docuseal/client";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const secret = process.env.DOCUSEAL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[/api/esign/docuseal/webhook] DOCUSEAL_WEBHOOK_SECRET not configured");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const valid = verifyDocusealWebhookSignature(rawBody, req.headers.get("X-Docuseal-Signature"), secret);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let payload: { event_type: string; data: Record<string, any> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await handleDocusealWebhook(payload, {
      sb: supabaseAdmin(),
      docuseal: { createDocusealSubmission, fetchDocusealSubmission, downloadDocusealSignedPdf, downloadDocusealAuditTrail },
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason, detail: (result as any).detail }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[/api/esign/docuseal/webhook]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
