import "server-only";

/**
 * GET /api/qa/borrower/applications
 *
 * Lists QA test applications for the configured QA borrower.
 * Requires the ?email= query parameter to match BORROWER_QA_EMAIL.
 *
 * POST /api/qa/borrower/applications
 *
 * Creates a new QA test application or resumes an existing one.
 *
 * Body shapes:
 *   { action: "create"; email: string }
 *   { action: "resume"; email: string; dealId: string }
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §5
 */

import { NextRequest, NextResponse } from "next/server";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import {
  isQABorrowerEmail,
  listQATestApplications,
  createQATestApplication,
  markDealAsTestApplication,
} from "@/lib/qaIdentity";
import { supabaseAdmin } from "@/lib/supabase/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "valid_email_required" },
      { status: 400 },
    );
  }

  if (!isQABorrowerEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "not_qa_email" },
      { status: 403 },
    );
  }

  let bankId: string;
  try {
    bankId = await getBrokerageBankId();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "brokerage_tenant_missing" },
      { status: 500 },
    );
  }

  const applications = await listQATestApplications({ email, bankId });

  return NextResponse.json({ ok: true, applications });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { action: string; email: string; dealId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "valid_email_required" },
      { status: 400 },
    );
  }

  if (!isQABorrowerEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "not_qa_email" },
      { status: 403 },
    );
  }

  let bankId: string;
  try {
    bankId = await getBrokerageBankId();
  } catch {
    return NextResponse.json(
      { ok: false, error: "brokerage_tenant_missing" },
      { status: 500 },
    );
  }

  if (body.action === "create") {
    const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const hashBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawToken),
    );
    const tokenHash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    let dealId: string;
    try {
      dealId = await createQATestApplication({
        bankId,
        email,
        tokenHash,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, dealId, isNew: true });
  }

  if (body.action === "resume") {
    if (!body.dealId) {
      return NextResponse.json(
        { ok: false, error: "dealId_required" },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    // Verify the deal belongs to the QA borrower
    const { data: deal, error } = await sb
      .from("deals")
      .select("id, is_test, test_identity, borrower_email, bank_id")
      .eq("id", body.dealId)
      .maybeSingle();

    if (error || !deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    const d = deal as any;
    if (!d.is_test || d.test_identity !== "borrower_qa") {
      return NextResponse.json(
        { ok: false, error: "not_a_test_application" },
        { status: 403 },
      );
    }

    if (d.borrower_email?.toLowerCase() !== email) {
      return NextResponse.json(
        { ok: false, error: "email_mismatch" },
        { status: 403 },
      );
    }

    // Ensure it's marked as test (idempotent)
    await markDealAsTestApplication(body.dealId);

    // Create a new session token for this device
    const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const hashBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawToken),
    );
    const tokenHash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await sb.from("borrower_session_tokens").insert({
      token_hash: tokenHash,
      deal_id: body.dealId,
      bank_id: d.bank_id,
      claimed_email: email,
      claimed_at: new Date().toISOString(),
      expires_at: new Date(
        Date.now() + 90 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });

    return NextResponse.json({
      ok: true,
      dealId: body.dealId,
      sessionToken: rawToken,
    });
  }

  return NextResponse.json(
    { ok: false, error: "unknown_action" },
    { status: 400 },
  );
}
