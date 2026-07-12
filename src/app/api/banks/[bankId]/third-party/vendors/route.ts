import "server-only";

/** SPEC S5 A-6 — GET/POST /api/banks/[bankId]/third-party/vendors */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeClerkAuth } from "@/lib/auth/clerkServer";
import { requireBankAdmin } from "@/lib/auth/requireBankAdmin";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const VENDOR_TYPES = new Set(["appraiser", "business_valuator", "environmental_consultant", "insurance_carrier", "title_company", "ucc_search_service"]);

type Ctx = { params: Promise<{ bankId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { bankId } = await ctx.params;
    const { userId } = await safeClerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    await requireBankAdmin(bankId, userId);

    const vendorType = new URL(req.url).searchParams.get("vendor_type");
    const sb = supabaseAdmin();
    let query = sb.from("third_party_vendors").select("*").eq("bank_id", bankId).eq("is_active", true);
    if (vendorType) query = query.eq("vendor_type", vendorType);
    const { data: vendors } = await query.order("legal_name", { ascending: true });

    return NextResponse.json({ ok: true, vendors: vendors ?? [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    console.error("[/api/banks/[bankId]/third-party/vendors] GET", e);
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
    const vendorType = typeof body.vendor_type === "string" ? body.vendor_type : "";
    const legalName = typeof body.legal_name === "string" ? body.legal_name : "";
    if (!VENDOR_TYPES.has(vendorType) || !legalName) {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const sb = supabaseAdmin();
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    console.error("[/api/banks/[bankId]/third-party/vendors] POST", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
