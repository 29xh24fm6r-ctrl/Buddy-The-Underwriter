import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import {
  sendQAVerificationCode,
  verifyQACode,
} from "@/lib/qaIdentity";

const MAX_BODY_BYTES = 8_192;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: Record<string, unknown>, status: number, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

async function parseBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return null;
  }
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await parseBody(req);
  if (!body) return json({ ok: false, error: "invalid_payload" }, 400);

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "valid_email_required" }, 400);
  }

  let bankId: string;
  try {
    bankId = await getBrokerageBankId();
  } catch {
    return json({ ok: false, error: "brokerage_tenant_missing" }, 503);
  }

  if (body.action === "send") {
    try {
      const result = await sendQAVerificationCode({ email, bankId });
      if (!result.ok) {
        if ("retryAfterSeconds" in result && result.retryAfterSeconds) {
          return json(
            { ok: false, error: result.error },
            429,
            { "retry-after": String(result.retryAfterSeconds) },
          );
        }
        return json(
          { ok: false, error: result.error },
          result.error === "not_qa_email" ? 403 : 503,
        );
      }
      return json({ ok: true, deterministic: result.deterministic }, 200);
    } catch {
      return json({ ok: false, error: "verification_unavailable" }, 503);
    }
  }

  if (body.action === "verify") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code || code.length > 64) {
      return json({ ok: false, error: "code_required" }, 400);
    }

    try {
      const result = await verifyQACode({ email, code, bankId });
      if (!result.ok) {
        const unavailable = result.error === "qa_state_unavailable";
        return json(
          { ok: false, error: result.error },
          unavailable ? 503 : result.error === "not_found" ? 404 : 400,
        );
      }
      if ("qaNeedsChooser" in result) {
        return json(
          { ok: true, dealId: null, qaNeedsChooser: true },
          200,
        );
      }
      return json(
        {
          ok: true,
          dealId: result.dealId,
          isNewDeal: result.isNewDeal,
        },
        200,
      );
    } catch {
      return json({ ok: false, error: "verification_unavailable" }, 503);
    }
  }

  return json({ ok: false, error: "unknown_action" }, 400);
}
