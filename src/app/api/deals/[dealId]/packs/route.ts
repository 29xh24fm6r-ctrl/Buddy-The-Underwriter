import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PackRow = {
  id: string;
  deal_id: string;
  name: string;
  description?: string;
  created_at: string;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;

  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "unauthorized" ? 401 : 404;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const sb = supabaseAdmin();

    const dealRes = await sb
      .from("deals")
      .select("id, bank_id, pack_template_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealRes.error) {
      return NextResponse.json(
        { ok: false, error: "deal_fetch_failed", detail: dealRes.error.message },
        { status: 500 },
      );
    }
    if (!dealRes.data) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }
    if (String(dealRes.data.bank_id) !== String(access.bankId)) {
      return NextResponse.json(
        { ok: false, error: "tenant_mismatch" },
        { status: 404 },
      );
    }

    // Prefer pack application history if it exists.
    const appRes = await sb
      .from("borrower_pack_applications")
      .select("id, pack_id, created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })
      .limit(25);

    const packs: PackRow[] = [];

    if (!appRes.error && appRes.data && appRes.data.length) {
      const packIds = Array.from(
        new Set(appRes.data.map((r: any) => String(r.pack_id)).filter(Boolean)),
      );

      const tmplRes = await sb
        .from("borrower_pack_templates")
        .select("id, name")
        .eq("bank_id", access.bankId)
        .in("id", packIds);

      const byId = new Map<string, { id: string; name: string }>();
      for (const t of (tmplRes.data ?? []) as Array<any>) {
        byId.set(String(t.id), { id: String(t.id), name: String(t.name || "Pack") });
      }

      for (const app of appRes.data as Array<any>) {
        const tmpl = byId.get(String(app.pack_id));
        packs.push({
          id: String(app.id),
          deal_id: dealId,
          name: tmpl?.name || "Pack",
          created_at: String(app.created_at || new Date().toISOString()),
        });
      }

      return NextResponse.json({ ok: true, packs });
    }

    // Fallback: show current chosen pack template (if any)
    const packTemplateId = dealRes.data.pack_template_id
      ? String(dealRes.data.pack_template_id)
      : "";

    if (!packTemplateId) {
      return NextResponse.json({ ok: true, packs: [] });
    }

    const tmpl = await sb
      .from("borrower_pack_templates")
      .select("id, name")
      .eq("bank_id", access.bankId)
      .eq("id", packTemplateId)
      .maybeSingle();

    if (tmpl.error) {
      return NextResponse.json(
        { ok: false, error: "pack_template_fetch_failed", detail: tmpl.error.message },
        { status: 500 },
      );
    }

    if (!tmpl.data) {
      return NextResponse.json({ ok: true, packs: [] });
    }

    packs.push({
      id: String(tmpl.data.id),
      deal_id: dealId,
      name: String((tmpl.data as any).name || "Pack"),
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, packs });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
