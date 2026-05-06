import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  _: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user)
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );

  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();

  const dealRes = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealRes.error)
    return NextResponse.json(
      { ok: false, error: "deal_fetch_failed", detail: dealRes.error.message },
      { status: 500 },
    );
  if (!dealRes.data)
    return NextResponse.json(
      { ok: false, error: "deal_not_found" },
      { status: 404 },
    );
  if (String(dealRes.data.bank_id) !== String(bankId))
    return NextResponse.json(
      { ok: false, error: "wrong_bank" },
      { status: 403 },
    );

  // Fetch conditions + linked evidence in parallel
  const [q, linksRes] = await Promise.all([
    sb
      .from("deal_conditions")
      .select(
        "id,title,description,category,status,source,source_key,required_docs,due_date,borrower_message_subject,borrower_message_body,reminder_subscription_id,created_at,updated_at",
      )
      .eq("deal_id", dealId)
      .order("status", { ascending: true })
      .order("created_at", { ascending: false }),
    sb
      .from("condition_document_links")
      .select("condition_id, document_id, link_source, match_confidence, match_reason, created_at")
      .eq("deal_id", dealId),
  ]);

  if (q.error)
    return NextResponse.json(
      { ok: false, error: "list_failed", detail: q.error.message },
      { status: 500 },
    );

  // Attach linked evidence to each condition
  const links = linksRes.data ?? [];
  const linksByCondition = new Map<string, typeof links>();
  for (const l of links) {
    const arr = linksByCondition.get(l.condition_id) ?? [];
    arr.push(l);
    linksByCondition.set(l.condition_id, arr);
  }

  const conditions = (q.data ?? []).map((c: any) => ({
    ...c,
    linked_evidence: linksByCondition.get(c.id) ?? [],
    linked_doc_count: (linksByCondition.get(c.id) ?? []).length,
  }));

  // SPEC-07: canonical shape is `{ conditions }`. `items` is kept as a
  // deprecated alias for one cycle to avoid breaking ConditionsToCloseCard
  // (and any other legacy consumer) before they migrate.
  return NextResponse.json({ ok: true, conditions, items: conditions });
}
