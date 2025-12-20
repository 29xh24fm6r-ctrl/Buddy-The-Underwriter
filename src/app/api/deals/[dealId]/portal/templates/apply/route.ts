// src/app/api/deals/[dealId]/portal/templates/apply/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const onlyActive = body?.onlyActive === false ? false : true;

  // Load deal to get bank_id
  const { data: deal, error: dErr } = await sb.from("deals").select("id, bank_id").eq("id", dealId).single();
  if (dErr || !deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  // Load templates
  let tq = sb
    .from("borrower_request_templates")
    .select("id, title, category, description, doc_type, year_mode, sort_order, active")
    .eq("bank_id", deal.bank_id)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (onlyActive) tq = tq.eq("active", true);

  const { data: templates = [], error: tErr } = await tq;
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  // Load existing requests for deal (to avoid duplicates)
  const { data: existing = [], error: rErr } = await sb
    .from("borrower_document_requests")
    .select("id, template_id, title, category")
    .eq("deal_id", dealId);

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const existingByTemplate = new Map<string, any>();
  for (const r of existing) if (r.template_id) existingByTemplate.set(r.template_id, r);

  const created: any[] = [];
  const skipped: any[] = [];

  for (const tpl of templates as any[]) {
    const already = existingByTemplate.get(tpl.id);
    if (already) {
      skipped.push({ templateId: tpl.id, requestId: already.id, reason: "already_exists" });
      continue;
    }

    // Create request from template
    const { data: reqRow, error: cErr } = await sb
      .from("borrower_document_requests")
      .insert({
        deal_id: dealId,
        bank_id: deal.bank_id,
        template_id: tpl.id,
        title: tpl.title,
        category: tpl.category ?? null,
        description: tpl.description ?? null,
        status: "requested",
      })
      .select("id, title, category, status, template_id")
      .single();

    if (cErr || !reqRow) {
      skipped.push({ templateId: tpl.id, reason: "create_failed", error: cErr?.message || "unknown" });
      continue;
    }

    // Audit link
    await sb
      .from("borrower_deal_template_apps")
      .insert({
        deal_id: dealId,
        bank_id: deal.bank_id,
        template_id: tpl.id,
        request_id: reqRow.id,
      })
      .catch(() => null);

    created.push({ templateId: tpl.id, requestId: reqRow.id, title: reqRow.title });
  }

  return NextResponse.json({
    ok: true,
    createdCount: created.length,
    skippedCount: skipped.length,
    created,
    skipped,
  });
}
