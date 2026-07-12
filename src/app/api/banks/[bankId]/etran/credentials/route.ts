import "server-only";

/**
 * SPEC S5 B-6 — GET/POST /api/banks/[bankId]/etran/credentials
 *
 * GET returns metadata only (never the decrypted PEM — `bank_etran_credentials`
 * denies all row-level access via RLS; even this route, running as service
 * role, never selects the *_pem_encrypted columns below).
 * POST stores/rotates credentials via storeEtranCredentials(), which routes
 * through the SECURITY DEFINER encrypt RPC (20260605_d_etran_rpc.sql) —
 * plaintext PEM is never written to this table by this route directly.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeClerkAuth } from "@/lib/auth/clerkServer";
import { requireBankAdmin } from "@/lib/auth/requireBankAdmin";
import { storeEtranCredentials } from "@/lib/etran/credentials";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bankId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { bankId } = await ctx.params;
    const { userId } = await safeClerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    await requireBankAdmin(bankId, userId);

    const sb = supabaseAdmin();
    const { data } = await sb
      .from("bank_etran_credentials")
      .select("sba_lender_id, sba_service_center, endpoint_environment, cert_expires_at, last_rotation_at, updated_at")
      .eq("bank_id", bankId)
      .maybeSingle();

    return NextResponse.json({ ok: true, configured: !!data, credentials: data ?? null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    console.error("[/api/banks/[bankId]/etran/credentials] GET", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { bankId } = await ctx.params;
    const { userId } = await safeClerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    await requireBankAdmin(bankId, userId);

    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const sbaLenderId = typeof body.sba_lender_id === "string" ? body.sba_lender_id.trim() : "";
    const sbaServiceCenter = typeof body.sba_service_center === "string" ? body.sba_service_center.trim() : "";
    const clientCertPem = typeof body.client_cert_pem === "string" ? body.client_cert_pem : "";
    const clientKeyPem = typeof body.client_key_pem === "string" ? body.client_key_pem : "";
    const endpointEnvironment = body.endpoint_environment === "production" ? "production" : "sandbox";
    const certExpiresAt = typeof body.cert_expires_at === "string" && body.cert_expires_at ? new Date(body.cert_expires_at) : null;

    if (!sbaLenderId || !sbaServiceCenter || !clientCertPem || !clientKeyPem) {
      return NextResponse.json(
        { ok: false, error: "sba_lender_id, sba_service_center, client_cert_pem, and client_key_pem are required" },
        { status: 400 },
      );
    }

    const result = await storeEtranCredentials({
      bankId,
      sbaLenderId,
      sbaServiceCenter,
      clientCertPem,
      clientKeyPem,
      endpointEnvironment,
      certExpiresAt,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: result.reason === "ENCRYPTION_KEY_MISSING" ? 503 : 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    console.error("[/api/banks/[bankId]/etran/credentials] POST", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
