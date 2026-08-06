import "server-only";

/**
 * GET  /api/brokerage/session/applications
 *   Lists existing applications (deals) for the identity proven by the
 *   application-chooser cookie set during email verification. 401 if the
 *   cookie is missing, expired, or invalid — never falls back to any other
 *   identity source.
 *
 * POST /api/brokerage/session/applications
 *   Body: { action: "resume" | "view" | "new"; dealId?: string }
 *   Finalizes the borrower's explicit choice from the Welcome Back screen.
 *
 *   - "resume": only allowed for a deal in the "active" bucket. Verifies
 *     the deal belongs to the verified email AND the current bank before
 *     creating any session.
 *   - "view": only allowed for a deal in the "completed" bucket. Same
 *     ownership/tenant verification. Server-side, this only authorizes
 *     read access to the deal via the normal session cookie — enforcing
 *     that the borrower-facing chapters themselves render read-only for a
 *     completed deal is a separate, not-yet-implemented follow-up (see
 *     inline note below); this route does not claim to solve that.
 *   - "new": creates a brand-new deal via the existing fresh-deal path,
 *     reusing only the verified email (and name, if supplied at
 *     verification time) — never copies anything from any prior deal.
 *
 *   The client-supplied dealId is never trusted alone: every action
 *   re-derives the deal's owner email, bank_id, and status bucket
 *   server-side before proceeding. An expired/invalid chooser cookie fails
 *   every action closed (401), including "new".
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getApplicationChooserIdentity,
  clearApplicationChooserCookie,
} from "@/lib/brokerage/applicationChooser";
import { createBorrowerSession } from "@/lib/brokerage/sessionToken";
import { getOrCreateBorrowerSession } from "@/lib/brokerage/session";
import { claimBorrowerSession } from "@/lib/brokerage/sessionToken";
import {
  listBorrowerApplications,
  type ApplicationBucket,
} from "@/lib/brokerage/listBorrowerApplications";

function auditLog(event: {
  action: "resume" | "view" | "new" | "rejected";
  email: string;
  bankId: string;
  dealId?: string | null;
  reason?: string;
}) {
  // Structured log line — same convention already used for security events
  // in this codebase (see emailVerification.ts's "P0 SECURITY:" lines).
  // No dedicated audit-event table write introduced here; this is
  // intentionally the smallest safe logging for this change.
  console.log(
    `[application-chooser] action=${event.action} email=${event.email} bank=${event.bankId} ` +
      `deal=${event.dealId ?? "n/a"}${event.reason ? ` reason=${event.reason}` : ""}`,
  );
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const identity = await getApplicationChooserIdentity();
  if (!identity) {
    return NextResponse.json({ ok: false, error: "no_pending_choice_session" }, { status: 401 });
  }

  const applications = await listBorrowerApplications({
    email: identity.email,
    bankId: identity.bankId,
  });

  return NextResponse.json({ ok: true, applications });
}

type Body =
  | { action: "resume"; dealId: string }
  | { action: "view"; dealId: string }
  | { action: "new" };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const identity = await getApplicationChooserIdentity();
  if (!identity) {
    return NextResponse.json({ ok: false, error: "no_pending_choice_session" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (body.action === "new") {
    const session = await getOrCreateBorrowerSession();
    await claimBorrowerSession({ tokenHash: session.tokenHash, email: identity.email });
    await clearApplicationChooserCookie();
    auditLog({ action: "new", email: identity.email, bankId: identity.bankId, dealId: session.deal_id });
    return NextResponse.json({ ok: true, dealId: session.deal_id });
  }

  if (body.action === "resume" || body.action === "view") {
    const dealId = body.dealId;
    if (!dealId || typeof dealId !== "string") {
      return NextResponse.json({ ok: false, error: "deal_id_required" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: deal, error } = await sb
      .from("deals")
      .select("id, borrower_email, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (error || !deal) {
      auditLog({
        action: "rejected",
        email: identity.email,
        bankId: identity.bankId,
        dealId,
        reason: "deal_not_found",
      });
      return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
    }

    const d = deal as any;

    // Never trust the client-supplied dealId alone — re-verify ownership
    // and tenant server-side before doing anything else.
    if (d.borrower_email?.toLowerCase() !== identity.email) {
      auditLog({
        action: "rejected",
        email: identity.email,
        bankId: identity.bankId,
        dealId,
        reason: "email_mismatch",
      });
      return NextResponse.json({ ok: false, error: "email_mismatch" }, { status: 403 });
    }
    if (d.bank_id !== identity.bankId) {
      auditLog({
        action: "rejected",
        email: identity.email,
        bankId: identity.bankId,
        dealId,
        reason: "bank_mismatch",
      });
      return NextResponse.json({ ok: false, error: "bank_mismatch" }, { status: 403 });
    }

    // Re-derive the status bucket server-side and check it matches the
    // requested action — a client cannot "resume" a completed deal or
    // "view" an active one by changing the action string.
    const applications = await listBorrowerApplications({
      email: identity.email,
      bankId: identity.bankId,
    });
    const match = applications.find((a) => a.id === dealId);
    const bucket: ApplicationBucket | null = match?.bucket ?? null;

    if (body.action === "resume" && bucket !== "active") {
      auditLog({
        action: "rejected",
        email: identity.email,
        bankId: identity.bankId,
        dealId,
        reason: `resume_not_allowed_for_bucket_${bucket ?? "unknown"}`,
      });
      return NextResponse.json({ ok: false, error: "resume_not_allowed" }, { status: 403 });
    }
    if (body.action === "view" && bucket !== "completed") {
      auditLog({
        action: "rejected",
        email: identity.email,
        bankId: identity.bankId,
        dealId,
        reason: `view_not_allowed_for_bucket_${bucket ?? "unknown"}`,
      });
      return NextResponse.json({ ok: false, error: "view_not_allowed" }, { status: 403 });
    }

    await createBorrowerSession({
      dealId,
      bankId: identity.bankId,
      claimedEmail: identity.email,
    });
    await clearApplicationChooserCookie();

    auditLog({ action: body.action, email: identity.email, bankId: identity.bankId, dealId });

    return NextResponse.json({ ok: true, dealId });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
