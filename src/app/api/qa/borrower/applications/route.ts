import "server-only";

/**
 * GET /api/qa/borrower/applications
 *
 * Lists QA test applications. Resolves the QA borrower identity from the
 * canonical verified borrower session cookie.
 *
 * POST /api/qa/borrower/applications
 *
 * Creates a new QA test application or resumes an existing one.
 * Resolves identity from session cookie — email is never a direct
 * authorization parameter.
 *
 * P0-1: Auth via session cookie, not email query/body.
 *       A caller who only knows BORROWER_QA_EMAIL cannot list, create,
 *       resume, or obtain a session token.
 *
 * P0-2: Never returns raw session tokens in JSON. Session cookies are
 *       set via the canonical `createBorrowerSession` utility.
 *
 * Body shapes (POST):
 *   { action: "create" }
 *   { action: "resume"; dealId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getBorrowerSession, createBorrowerSession } from "@/lib/brokerage/sessionToken";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import {
  isQABorrowerEmail,
  listQATestApplications,
  createQATestApplication,
  markDealAsTestApplication,
} from "@/lib/qaIdentity";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * P0-1: Resolve the QA borrower from the verified session cookie.
 * Only succeeds when:
 *   1. A valid session cookie is present
 *   2. The session's claimed_email matches BORROWER_QA_EMAIL
 *
 * A caller who only knows BORROWER_QA_EMAIL cannot pass this check.
 */
async function requireQABorrowerSession(): Promise<{
  email: string;
  dealId: string;
  bankId: string;
}> {
  const session = await getBorrowerSession();
  if (!session) {
    throw new NoSessionError("no_session_cookie");
  }

  const claimedEmail = session.claimed_email?.toLowerCase().trim();
  if (!claimedEmail || !isQABorrowerEmail(claimedEmail)) {
    throw new NoSessionError("not_qa_session");
  }

  // P0-1: session MUST be claimed/verified — unclaimed sessions are rejected
  if (!session.claimed_at) {
    throw new NoSessionError("session_not_verified");
  }

  return {
    email: claimedEmail,
    dealId: session.deal_id,
    bankId: session.bank_id,
  };
}

class NoSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoSessionError";
  }
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  let ctx: { email: string; bankId: string };
  try {
    ctx = await requireQABorrowerSession();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 401 },
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

  const applications = await listQATestApplications({
    email: ctx.email,
    bankId,
  });

  return NextResponse.json({ ok: true, applications });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let ctx: { email: string; dealId: string; bankId: string };
  try {
    ctx = await requireQABorrowerSession();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 401 },
    );
  }

  let body: { action: string; dealId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
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
    // P0-4: Atomic deal creation via RPC.
    // Session is created by the canonical createBorrowerSession below.
    // ONE session row — no orphan, no duplicate.
    let dealId: string;
    try {
      const result = await createQATestApplication({
        bankId,
        email: ctx.email,
      });
      dealId = result.dealId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 500 },
      );
    }

    // Single canonical session — no raw token in JSON
    await createBorrowerSession({
      dealId,
      bankId,
      claimedEmail: ctx.email,
    });

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

    // Verify the deal is a QA test application
    const { data: deal, error } = await sb
      .from("deals")
      .select("id, is_test, test_identity, test_run_id, test_created_at, borrower_email, bank_id")
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

    // Verify this deal belongs to the QA borrower
    if (d.borrower_email?.toLowerCase() !== ctx.email) {
      return NextResponse.json(
        { ok: false, error: "email_mismatch" },
        { status: 403 },
      );
    }

    // P0-5: mark is idempotent — preserves existing test_run_id & test_created_at
    await markDealAsTestApplication(body.dealId);

    // Re-fetch to return preserved metadata (P0-5 proof)
    const { data: refreshed } = await sb
      .from("deals")
      .select("test_run_id, test_created_at, test_suite, test_identity")
      .eq("id", body.dealId)
      .maybeSingle();

    const preserved = refreshed as any;

    // P0-2: Set new session cookie — no raw token in JSON
    await createBorrowerSession({
      dealId: body.dealId,
      bankId: d.bank_id,
      claimedEmail: ctx.email,
    });

    return NextResponse.json({
      ok: true,
      dealId: body.dealId,
      testRunId: preserved?.test_run_id,
      testCreatedAt: preserved?.test_created_at,
      testSuite: preserved?.test_suite,
      testIdentity: preserved?.test_identity,
    });
  }

  return NextResponse.json(
    { ok: false, error: "unknown_action" },
    { status: 400 },
  );
}
