import "server-only";

/**
 * /api/banks/[bankId]/[resource]
 * resource ∈ {"etran-credentials", "third-party-vendors"}
 *
 * Consolidates the former separate banks/[bankId]/etran/credentials and
 * banks/[bankId]/third-party/vendors route files into one dynamic-segment
 * dispatcher — route/page slot budget discipline (see the Drift Log).
 * Path changes from /etran/credentials to /etran-credentials (caller
 * updated: EtranCredentialAdminPanel.tsx) and /third-party/vendors to
 * /third-party-vendors (no caller found).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeClerkAuth } from "@/lib/auth/clerkServer";
import { requireBankAdmin } from "@/lib/auth/requireBankAdmin";
import { storeEtranCredentials } from "@/lib/etran/credentials";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const VENDOR_TYPES = new Set(["appraiser", "business_valuator", "environmental_consultant", "insurance_carrier", "title_company", "ucc_search_service"]);

type Ctx = { params: Promise<{ bankId: string; resource: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { bankId, resource } = await ctx.params;
    const { userId } = await safeClerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    await requireBankAdmin(bankId, userId);
    const sb = supabaseAdmin();

    if (resource === "etran-credentials") {
      const { data } = await sb
        .from("bank_etran_credentials")
        .select("sba_lender_id, sba_service_center, endpoint_environment, cert_expires_at, last_rotation_at, updated_at")
        .eq("bank_id", bankId)
        .maybeSingle();

      return NextResponse.json({ ok: true, configured: !!data, credentials: data ?? null });
    }

    if (resource === "third-party-vendors") {
      const vendorType = new URL(req.url).searchParams.get("vendor_type");
      let query = sb.from("third_party_vendors").select("*").eq("bank_id", bankId).eq("is_active", true);
      if (vendorType) query = query.eq("vendor_type", vendorType);
      const { data: vendors } = await query.order("legal_name", { ascending: true });

      return NextResponse.json({ ok: true, vendors: vendors ?? [] });
    }

    return NextResponse.json({ ok: false, error: `unsupported_resource: ${resource}` }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    console.error("[/api/banks/[bankId]/[resource]] GET", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { bankId, resource } = await ctx.params;
    const { userId } = await safeClerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    await requireBankAdmin(bankId, userId);
    const sb = supabaseAdmin();

    if (resource === "etran-credentials") {
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
    }

    if (resource === "third-party-vendors") {
      const body = await req.json().catch(() => ({}) as Record<string, unknown>);
      const vendorType = typeof body.vendor_type === "string" ? body.vendor_type : "";
      const legalName = typeof body.legal_name === "string" ? body.legal_name : "";
      if (!VENDOR_TYPES.has(vendorType) || !legalName) {
        return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
      }

      const { data: vendor, error } = await sb
        .from("third_party_vendors")
        .insert({
          bank_id: bankId,
          vendor_type: vendorType,
          legal_name: legalName,
          contact_email: typeof body.contact_email === "string" ? body.contact_email : null,
          contact_phone: typeof body.contact_phone === "string" ? body.contact_phone : null,
          service_regions: Array.isArray(body.service_regions) ? body.service_regions : null,
          certifications: Array.isArray(body.certifications) ? body.certifications : null,
          notes: typeof body.notes === "string" ? body.notes : null,
        })
        .select("*")
        .single();

      if (error || !vendor) {
        return NextResponse.json({ ok: false, error: "insert_failed", detail: error?.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, vendor });
    }

    return NextResponse.json({ ok: false, error: `unsupported_resource: ${resource}` }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    console.error("[/api/banks/[bankId]/[resource]] POST", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
