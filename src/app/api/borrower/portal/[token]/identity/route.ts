import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  initiateKyc,
  reconcilePendingVerifications,
  reconcileVerification,
  kycReturnBaseUrl,
} from "@/lib/identity/kyc/service";
import {
  createDiditSession,
  fetchDiditSession,
  getDiditSessionDecision,
} from "@/lib/identity/kyc/didit";
import { OWNER_THRESHOLD_PERCENT } from "@/lib/ownership/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

/**
 * Read per-request rather than at module load. A module-level capture binds
 * the value into the cold-start closure, so a corrected env var only takes
 * effect for lambdas started after the change.
 */
function diditWorkflowId(): string {
  return process.env.DIDIT_WORKFLOW_ID ?? "";
}

const diditClient = { createDiditSession, fetchDiditSession, getDiditSessionDecision };

/**
 * Statuses from which the borrower can start a brand-new session. `created`
 * and `pending` are NOT here — those reuse the existing session URL, and
 * reconciliation runs before every read so a row only stays pending while
 * the vendor session genuinely still is.
 */
const RESTARTABLE_STATUSES = ["expired", "failed", "declined"];
const TERMINAL_SUCCESS = ["approved", "completed"];

/** Where Didit should send this borrower back to when they finish. */
function returnUrlForToken(token: string): string {
  const base = kycReturnBaseUrl();
  return base ? `${base}/kyc/complete?token=${encodeURIComponent(token)}` : "";
}

/**
 * GET — per-owner identity verification state for the borrower portal.
 *
 * Reconciles before reading. Webhook delivery is best-effort: on
 * 2026-08-25 a borrower finished on Didit, the completion webhook was
 * never delivered, and the row sat at "created" with the sealing gate
 * closed and no control on screen that could move it. Reconciling here
 * means the borrower simply reloading their own page repairs the state,
 * with no banker and no webhook involved.
 *
 * Reconciliation failures are swallowed on purpose — a vendor outage must
 * degrade this endpoint to "shows last known status" rather than break the
 * page entirely.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  let reconciled = { examined: 0, changed: 0, failed: 0 };
  try {
    const result = await reconcilePendingVerifications(
      { dealId: ctx.dealId, limit: 25 },
      { sb, didit: diditClient },
    );
    reconciled = { examined: result.examined, changed: result.changed, failed: result.failed };
  } catch (e) {
    console.error(`[portal/identity] reconcile failed deal=${ctx.dealId}`, e);
  }

  const { data: owners } = await sb
    .from("ownership_entities")
    .select("id, display_name, ownership_pct")
    .eq("deal_id", ctx.dealId)
    .order("ownership_pct", { ascending: false, nullsFirst: false });

  const allOwners = (owners ?? []) as Array<{
    id: string;
    display_name: string;
    ownership_pct: number | null;
  }>;

  const qualifyingOwners = allOwners.filter(
    (o) => Number(o.ownership_pct ?? 0) >= OWNER_THRESHOLD_PERCENT,
  );

  const ownerIds = qualifyingOwners.map((o) => o.id);

  const { data: verifications } = await sb
    .from("borrower_identity_verifications")
    .select("id, ownership_entity_id, status, vendor_artifacts_url, created_at, completed_at")
    .eq("deal_id", ctx.dealId)
    .in("ownership_entity_id", ownerIds.length > 0 ? ownerIds : ["__none__"]);

  const verificationMap = new Map<string, Record<string, unknown>>();
  for (const v of verifications ?? []) {
    const existing = verificationMap.get(v.ownership_entity_id as string);
    if (!existing || (v.created_at as string) > (existing.created_at as string)) {
      verificationMap.set(v.ownership_entity_id as string, v);
    }
  }

  const result = qualifyingOwners.map((o) => {
    const v = verificationMap.get(o.id);
    const status = v ? String(v.status) : null;
    const verified = status !== null && TERMINAL_SUCCESS.includes(status);
    return {
      ownershipEntityId: o.id,
      displayName: o.display_name,
      ownershipPct: o.ownership_pct,
      verification: v
        ? {
            id: v.id,
            status: v.status,
            sessionUrl: v.vendor_artifacts_url ?? null,
            completedAt: v.completed_at ?? null,
          }
        : null,
      verified,
      // Exactly which controls the panel may render for this owner. Computed
      // server-side so "what can this borrower do right now" has one
      // definition, and so there is ALWAYS at least one true action for any
      // owner who is not already verified.
      actions: {
        canStart: !v || RESTARTABLE_STATUSES.includes(status ?? ""),
        canResume: Boolean(v && !verified && v.vendor_artifacts_url),
        canRefresh: Boolean(v) && !verified,
      },
    };
  });

  const ownershipTotal = allOwners.reduce((sum, o) => sum + Number(o.ownership_pct ?? 0), 0);

  return NextResponse.json({
    ok: true,
    owners: result,
    reconciled,
    // Surfaced so the panel can tell the borrower *why* sealing is blocked
    // when the blocker is a broken ownership table rather than a missing
    // verification (deal b296dec2 carried three owners totalling 149%).
    ownership: {
      total: Number(ownershipTotal.toFixed(2)),
      valid: Math.abs(ownershipTotal - 100) <= 0.01,
      ownerCount: allOwners.length,
    },
    allVerified: result.length > 0 && result.every((o) => o.verified),
  });
}

/**
 * POST — start, resume, or force-refresh a verification.
 *
 * body: { ownershipEntityId, action?: "start" | "refresh" }
 *
 * "refresh" exists so the borrower is never without a move. Before this,
 * a row stuck at "created" offered only a link back to a Didit session
 * they had already completed, which is a dead end by construction.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const ownershipEntityId = body?.ownershipEntityId as string | undefined;
  const action = (body?.action as string | undefined) ?? "start";

  if (!ownershipEntityId) {
    return NextResponse.json({ ok: false, error: "ownershipEntityId is required" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  if (action === "refresh") {
    const { data: latest } = await sb
      .from("borrower_identity_verifications")
      .select("id")
      .eq("deal_id", ctx.dealId)
      .eq("ownership_entity_id", ownershipEntityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_VERIFICATION",
          message: "Nothing to refresh yet — start verification first.",
        },
        { status: 404 },
      );
    }

    const result = await reconcileVerification(latest.id as string, { sb, didit: diditClient });
    if (!result.ok) {
      console.error(`[portal/identity] refresh failed deal=${ctx.dealId}`, result.reason, result.detail);
      return NextResponse.json(
        {
          ok: false,
          error: result.reason,
          message:
            "We could not reach the verification service just now. Please try again in a moment.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      action: "refresh",
      status: result.status,
      changed: result.changed,
    });
  }

  const workflowId = diditWorkflowId();
  if (!workflowId) {
    return NextResponse.json(
      {
        ok: false,
        error: "NOT_CONFIGURED",
        message: "Identity verification is not set up yet. Your banker will follow up.",
      },
      { status: 503 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  // Reconcile this owner's existing row FIRST. initiateKyc reuses any row
  // still in a pending status, so a stale "created" row whose vendor
  // session is actually Approved would otherwise hand the borrower back
  // the same finished session URL forever.
  try {
    const { data: existing } = await sb
      .from("borrower_identity_verifications")
      .select("id")
      .eq("deal_id", ctx.dealId)
      .eq("ownership_entity_id", ownershipEntityId)
      .in("status", ["created", "pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      await reconcileVerification(existing.id as string, { sb, didit: diditClient });
    }
  } catch (e) {
    console.error(`[portal/identity] pre-start reconcile failed deal=${ctx.dealId}`, e);
  }

  // createDiditSession THROWS on a vendor error; initiateKyc does not catch
  // it. Without this the handler 500s with a non-JSON body, the browser's
  // res.json() rejects, and the panel's catch swallows it — the borrower
  // clicks "Verify ID" and nothing whatsoever happens. Production has been
  // throwing `Didit API /session/ failed: 400 — {"workflow_id":"Invalid
  // workflow_id."}` on this path since 2026-08-06 with no user-visible sign.
  let result: Awaited<ReturnType<typeof initiateKyc>>;
  try {
    result = await initiateKyc(
      {
        dealId: ctx.dealId,
        bankId: ctx.bankId,
        ownershipEntityId,
        initiatorUserId: `portal:${token.slice(0, 8)}`,
        initiatorIp: ip,
        initiatorUserAgent: ua,
        returnUrl: returnUrlForToken(token) || undefined,
      },
      { sb, didit: diditClient, workflowId },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[portal/identity] vendor session failed deal=${ctx.dealId}`, detail);
    return NextResponse.json(
      {
        ok: false,
        error: "VENDOR_SESSION_FAILED",
        message:
          "We could not start identity verification. Your banker has been notified.",
        detail,
      },
      { status: 502 },
    );
  }

  if (!result.ok) {
    const status = result.reason === "OWNER_NOT_FOUND" ? 404 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: result.reason,
        message:
          result.reason === "OWNER_NOT_FOUND"
            ? "We could not find that owner on your application."
            : "We could not start identity verification. Your banker has been notified.",
      },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    sessionUrl: result.sessionUrl,
    reused: result.reused,
  });
}
