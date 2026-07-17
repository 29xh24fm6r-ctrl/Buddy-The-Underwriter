import "server-only";

/**
 * POST /api/brokerage/session
 *
 * Email-verification gate for the /start "workspace" entry flow — a
 * borrower gives name + email, gets a 6-digit code, and verifying it
 * creates (or reattaches to) their session before any chat happens.
 *
 * Both actions method-merged onto this one route.ts (rather than two
 * separate files) to stay under the route-slot warning threshold — see
 * src/lib/routes/__tests__/routeConsolidationGuard.test.ts and the same
 * convention already used by /api/brokerage/concierge for factPath vs.
 * userMessage bodies.
 */

import { NextRequest, NextResponse } from "next/server";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import {
  sendVerificationCode,
  verifyCodeAndCreateSession,
} from "@/lib/brokerage/emailVerification";

type SendBody = { action: "send"; name?: string; email: string };
type VerifyBody = { action: "verify"; email: string; code: string; name?: string };
type Body = SendBody | VerifyBody;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body?.email || typeof body.email !== "string" || !EMAIL_RE.test(body.email.trim())) {
    return NextResponse.json({ ok: false, error: "valid_email_required" }, { status: 400 });
  }

  let bankId: string;
  try {
    bankId = await getBrokerageBankId();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[brokerage-session] brokerage_tenant_missing:", msg);
    return NextResponse.json(
      { ok: false, errorCode: "brokerage_tenant_missing", error: msg },
      { status: 500 },
    );
  }

  if (body.action === "send") {
    const name = typeof body.name === "string" ? body.name.slice(0, 200) : null;
    const result = await sendVerificationCode({ email: body.email, name, bankId });
    if (!result.ok) {
      if ("retryAfterSeconds" in result) {
        return NextResponse.json(
          { ok: false, error: result.error },
          { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
        );
      }
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "verify") {
    if (!body.code || typeof body.code !== "string") {
      return NextResponse.json({ ok: false, error: "code_required" }, { status: 400 });
    }
    const name = typeof body.name === "string" ? body.name.slice(0, 200) : null;
    const result = await verifyCodeAndCreateSession({
      email: body.email,
      code: body.code,
      name,
      bankId,
    });
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }
    return NextResponse.json({ ok: true, dealId: result.dealId });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
