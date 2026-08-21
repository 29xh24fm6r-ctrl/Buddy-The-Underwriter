import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { initiateKyc } from "@/lib/identity/kyc/service";
import {
  createDiditSession,
  fetchDiditSession,
  getDiditSessionDecision,
} from "@/lib/identity/kyc/didit";

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

  const { data: owners } = await sb
    .from("ownership_entities")
    .select("id, display_name, ownership_pct")
    .eq("deal_id", ctx.dealId)
    .order("ownership_pct", { ascending: false, nullsFirst: false });

  const qualifyingOwners = (owners ?? []).filter(
    (o: { ownership_pct: number | null }) => (o.ownership_pct ?? 0) >= 20,
  );

  const ownerIds = qualifyingOwners.map((o: { id: string }) => o.id);

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

  const result = qualifyingOwners.map((o: { id: string; display_name: string; ownership_pct: number | null }) => {
    const v = verificationMap.get(o.id);
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
    };
  });

  return NextResponse.json({ ok: true, owners: result });
}

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

  if (!ownershipEntityId) {
    return NextResponse.json({ ok: false, error: "ownershipEntityId is required" }, { status: 400 });
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

  const sb = supabaseAdmin();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;

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
      },
      {
        sb,
        didit: { createDiditSession, fetchDiditSession, getDiditSessionDecision },
        workflowId,
      },
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
