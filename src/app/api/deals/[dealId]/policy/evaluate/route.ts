import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { evaluateRules } from "@/lib/policy/rulesEngine";
import type { PolicyEvaluationResult, UWContext } from "@/lib/policy/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildNextActions(results: PolicyEvaluationResult["results"]) {
  // Dedup mitigants across triggered rules. Keep highest priority.
  const map = new Map<
    string,
    { key: string; label: string; priority: number; reason_rule_keys: string[] }
  >();

  for (const r of results) {
    if (r.result === "pass") continue;
    for (const m of r.mitigants || []) {
      const pri = Number.isFinite(m.priority as any) ? Number(m.priority) : 3;
      const existing = map.get(m.key);
      if (!existing) {
        map.set(m.key, {
          key: m.key,
          label: m.label,
          priority: pri,
          reason_rule_keys: [r.rule_key],
        });
      } else {
        existing.priority = Math.min(existing.priority, pri);
        if (!existing.reason_rule_keys.includes(r.rule_key))
          existing.reason_rule_keys.push(r.rule_key);
      }
    }
  }

  return Array.from(map.values())
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 12);
}

export async function POST(
  req: NextRequest,
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
  if (!dealId)
    return NextResponse.json(
      { ok: false, error: "missing_deal_id" },
      { status: 400 },
    );

  const bankId = await getCurrentBankId();

  const dealRes = await sb
    .from("deals")
    .select("id, bank_id, deal_type, borrower_email, next_action_json")
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

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const uwCtx: UWContext = {
    deal_type: dealRes.data.deal_type || undefined,
    ...(body?.context || {}),
  };

  // Load active rules
  const rulesRes = await sb
    .from("bank_policy_rules")
    .select(
      "id,bank_id,rule_key,title,description,scope,predicate,decision,mitigants,exception_template,severity,active",
    )
    .eq("bank_id", bankId)
    .eq("active", true)
    .order("severity", { ascending: true });

  if (rulesRes.error)
    return NextResponse.json(
      {
        ok: false,
        error: "rules_fetch_failed",
        detail: rulesRes.error.message,
      },
      { status: 500 },
    );

  const rules = (rulesRes.data ?? []) as any[];

  const citRes = await sb
    .from("bank_policy_rule_citations")
    .select(
      "rule_id, asset_id, chunk_id, note, bank_policy_chunks:chunk_id(content,page_num,section)",
    )
    .eq("bank_id", bankId);

  const evidenceByRuleId: Record<string, any[]> = {};
  for (const row of (citRes.data ?? []) as any[]) {
    const rid = String(row.rule_id);
    const chunk = row.bank_policy_chunks;
    const snippet = String(chunk?.content || "").slice(0, 280);

    if (!evidenceByRuleId[rid]) evidenceByRuleId[rid] = [];
    evidenceByRuleId[rid].push({
      asset_id: String(row.asset_id),
      chunk_id: String(row.chunk_id),
      page_num: chunk?.page_num ?? null,
      section: chunk?.section ?? null,
      snippet,
      note: row.note ?? null,
    });
  }

  const results = evaluateRules(rules, uwCtx, evidenceByRuleId);

  const warns = results.filter((r) => r.result === "warn").length;
  const fails = results.filter((r) => r.result === "fail").length;
  const infos = results.filter((r) => r.result === "info").length;
  const mitigants_total = results.reduce(
    (acc, r) => acc + (r.mitigants?.length || 0),
    0,
  );

  const next_actions = buildNextActions(results);

  // Optional: store policy next actions into deals.next_action_json for cockpit UI
  await sb
    .from("deals")
    .update({
      next_action_json: {
        kind: "policy_mitigants",
        updated_at: new Date().toISOString(),
        summary: { warns, fails, mitigants_total },
        next_actions,
      },
    })
    .eq("id", dealId)
    .eq("bank_id", bankId);

  const payload: PolicyEvaluationResult = {
    ok: true,
    bank_id: String(bankId),
    deal_id: dealId,
    context: uwCtx,
    summary: { warns, fails, infos, mitigants_total },
    results,
    next_actions,
  };

  return NextResponse.json(payload);
}
