import "server-only";

/**
 * POST /api/qa/borrower/auth
 *
 * QA borrower authentication gate — send OTP and verify OTP, method-merged
 * onto a single route.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §1, §6
 *
 * Body shapes:
 *   { action: "send"; email: string }
 *   { action: "verify"; email: string; code: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import {
  sendQAVerificationCode,
  verifyQACode,
} from "@/lib/qaIdentity";

type SendBody = { action: "send"; email: string };
type VerifyBody = { action: "verify"; email: string; code: string };
type Body = SendBody | VerifyBody;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  if (
    !body?.email ||
    typeof body.email !== "string" ||
    !EMAIL_RE.test(body.email.trim())
  ) {
    return NextResponse.json(
      { ok: false, error: "valid_email_required" },
      { status: 400 },
    );
  }

  let bankId: string;
  try {
    bankId = await getBrokerageBankId();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[qa-auth] brokerage_tenant_missing:", msg);
    return NextResponse.json(
      { ok: false, errorCode: "brokerage_tenant_missing", error: msg },
      { status: 500 },
    );
  }

  if (body.action === "send") {
    const result = await sendQAVerificationCode({
      email: body.email,
      bankId,
    });

    if (!result.ok) {
      const status = result.error === "not_qa_email" ? 403 : 500;
      if ("retryAfterSeconds" in result && result.retryAfterSeconds) {
        return NextResponse.json(
          { ok: false, error: result.error },
          {
            status: 429,
            headers: { "retry-after": String(result.retryAfterSeconds) },
          },
        );
      }
      return NextResponse.json(
        { ok: false, error: result.error },
        { status },
      );
    }

    return NextResponse.json({
      ok: true,
      deterministic:
        "deterministic" in result ? result.deterministic : false,
    });
  }

  if (body.action === "verify") {
    if (!body.code || typeof body.code !== "string") {
      return NextResponse.json(
        { ok: false, error: "code_required" },
        { status: 400 },
      );
    }

    const result = await verifyQACode({
      email: body.email,
      code: body.code,
      bankId,
    });

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json(
        { ok: false, error: result.error },
        { status },
      );
    }

    return NextResponse.json({
      ok: true,
      dealId: result.dealId,
      isNewDeal: result.isNewDeal,
    });
  }

  return NextResponse.json(
    { ok: false, error: "unknown_action" },
    { status: 400 },
  );
}
