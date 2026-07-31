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

const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID ?? "";

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

  if (!DIDIT_WORKFLOW_ID) {
    return NextResponse.json(
      { ok: false, error: "Identity verification is not configured yet. Your banker will follow up." },
      { status: 503 },
    );
  }

  const sb = supabaseAdmin();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  const result = await initiateKyc(
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
      workflowId: DIDIT_WORKFLOW_ID,
    },
  );

  if (!result.ok) {
    const status = result.reason === "OWNER_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ ok: false, error: result.reason }, { status });
  }

  return NextResponse.json({
    ok: true,
    sessionUrl: result.sessionUrl,
    reused: result.reused,
  });
}
