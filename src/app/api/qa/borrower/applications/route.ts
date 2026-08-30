import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  getBorrowerSession,
  createBorrowerSession,
} from "@/lib/brokerage/sessionToken";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import {
  isQABorrowerEmail,
  listQATestApplications,
  createQATestApplication,
  markDealAsTestApplication,
} from "@/lib/qaIdentity";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getQAChooserEmail,
  clearQAChooserCookie,
} from "@/lib/brokerage/qaChooser";

const MAX_BODY_BYTES = 8_192;
const DEAL_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function requireQABorrowerSession(): Promise<{
  email: string;
  dealId: string | null;
  bankId: string;
}> {
  const session = await getBorrowerSession();
  if (session) {
    const claimedEmail = session.claimed_email?.toLowerCase().trim();
    if (claimedEmail && isQABorrowerEmail(claimedEmail) && session.claimed_at) {
      return {
        email: claimedEmail,
        dealId: session.deal_id,
        bankId: session.bank_id,
      };
    }
  }

  const qaEmail = await getQAChooserEmail();
  if (qaEmail && isQABorrowerEmail(qaEmail)) {
    try {
      const bankId = await getBrokerageBankId();
      return { email: qaEmail, dealId: null, bankId };
    } catch {
      throw new Error("qa_session_unavailable");
    }
  }

  throw new Error(session ? "not_qa_session" : "no_session_cookie");
}

async function parseBody(
  req: NextRequest,
): Promise<{ action: "create" } | { action: "resume"; dealId: string } | null> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return null;
  }

  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
    const body = JSON.parse(text) as Record<string, unknown>;
    if (body.action === "create") return { action: "create" };
    if (
      body.action === "resume" &&
      typeof body.dealId === "string" &&
      DEAL_ID_RE.test(body.dealId)
    ) {
      return { action: "resume", dealId: body.dealId };
    }
  } catch {
    return null;
  }
  return null;
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  let ctx: Awaited<ReturnType<typeof requireQABorrowerSession>>;
  try {
    ctx = await requireQABorrowerSession();
  } catch {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const applications = await listQATestApplications({
      email: ctx.email,
      bankId: ctx.bankId,
    });
    return json({ ok: true, applications }, 200);
  } catch {
    return json({ ok: false, error: "applications_unavailable" }, 503);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let ctx: Awaited<ReturnType<typeof requireQABorrowerSession>>;
  try {
    ctx = await requireQABorrowerSession();
  } catch {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const body = await parseBody(req);
  if (!body) return json({ ok: false, error: "invalid_payload" }, 400);

  if (body.action === "create") {
    try {
      const result = await createQATestApplication({
        bankId: ctx.bankId,
        email: ctx.email,
      });
      await createBorrowerSession({
        dealId: result.dealId,
        bankId: ctx.bankId,
        claimedEmail: ctx.email,
      });
      await clearQAChooserCookie().catch(() => {});
      return json({ ok: true, dealId: result.dealId, isNew: true }, 201);
    } catch {
      return json({ ok: false, error: "create_failed" }, 503);
    }
  }

  const sb = supabaseAdmin();
  const { data: deal, error: dealError } = await sb
    .from("deals")
    .select(
      "id, is_test, test_identity, test_run_id, test_created_at, borrower_email, bank_id",
    )
    .eq("id", body.dealId)
    .eq("bank_id", ctx.bankId)
    .maybeSingle();

  if (dealError) return json({ ok: false, error: "resume_state_unavailable" }, 503);
  if (!deal) return json({ ok: false, error: "deal_not_found" }, 404);

  const candidate = deal as any;
  if (
    candidate.is_test !== true ||
    candidate.test_identity !== "borrower_qa"
  ) {
    return json({ ok: false, error: "not_a_test_application" }, 403);
  }
  if (candidate.borrower_email?.toLowerCase() !== ctx.email) {
    return json({ ok: false, error: "borrower_mismatch" }, 403);
  }

  try {
    await markDealAsTestApplication(body.dealId);

    const { data: refreshed, error: refreshError } = await sb
      .from("deals")
      .select("test_run_id, test_created_at, test_suite, test_identity")
      .eq("id", body.dealId)
      .eq("bank_id", ctx.bankId)
      .eq("is_test", true)
      .maybeSingle();

    if (
      refreshError ||
      !refreshed?.test_run_id ||
      !refreshed?.test_created_at ||
      refreshed.test_identity !== "borrower_qa"
    ) {
      return json({ ok: false, error: "resume_state_unavailable" }, 503);
    }

    await createBorrowerSession({
      dealId: body.dealId,
      bankId: ctx.bankId,
      claimedEmail: ctx.email,
    });
    await clearQAChooserCookie().catch(() => {});

    return json(
      {
        ok: true,
        dealId: body.dealId,
        testRunId: refreshed.test_run_id,
        testCreatedAt: refreshed.test_created_at,
        testSuite: refreshed.test_suite,
        testIdentity: refreshed.test_identity,
      },
      200,
    );
  } catch {
    return json({ ok: false, error: "resume_failed" }, 503);
  }
}
