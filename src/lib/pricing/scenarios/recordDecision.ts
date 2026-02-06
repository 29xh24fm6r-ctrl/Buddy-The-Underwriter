import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";
import { writeEvent } from "@/lib/ledger/writeEvent";

export type PricingDecisionInput = {
  dealId: string;
  bankId: string;
  pricingScenarioId: string;
  decision: "APPROVED" | "REJECTED" | "RESTRUCTURE";
  rationale: string;
  risks?: Array<{ risk: string; severity: string }>;
  mitigants?: Array<{ mitigant: string; strength: string }>;
  decidedBy: string;
};

export type RecordDecisionResult =
  | { ok: true; decisionId: string; termsId: string }
  | { ok: false; error: string; status: number };

export async function recordPricingDecision(
  input: PricingDecisionInput,
): Promise<RecordDecisionResult> {
  const sb = supabaseAdmin();

  // 1. Load the selected scenario
  const { data: scenario, error: scenErr } = await sb
    .from("pricing_scenarios")
    .select("*")
    .eq("id", input.pricingScenarioId)
    .eq("deal_id", input.dealId)
    .maybeSingle();

  if (scenErr || !scenario) {
    return { ok: false, error: "scenario_not_found", status: 404 };
  }

  // 2. Verify snapshot still exists (immutable, so should always be present)
  const { data: snap } = await sb
    .from("financial_snapshots")
    .select("id")
    .eq("id", scenario.financial_snapshot_id)
    .maybeSingle();

  if (!snap) {
    return { ok: false, error: "snapshot_missing", status: 422 };
  }

  // 3. Delete existing decision if any (unique per deal_id, upsert semantics)
  await sb.from("pricing_decisions").delete().eq("deal_id", input.dealId);

  // 4. Insert pricing_decisions
  const { data: decision, error: decErr } = await sb
    .from("pricing_decisions")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      pricing_scenario_id: input.pricingScenarioId,
      financial_snapshot_id: scenario.financial_snapshot_id,
      decision: input.decision,
      rationale: input.rationale,
      risks: input.risks ?? [],
      mitigants: input.mitigants ?? [],
      decided_by: input.decidedBy,
      decided_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (decErr || !decision) {
    return { ok: false, error: `decision_insert_failed: ${decErr?.message}`, status: 500 };
  }

  // 5. Extract terms from scenario structure and insert pricing_terms
  const structure = scenario.structure as any;
  const { data: terms, error: termsErr } = await sb
    .from("pricing_terms")
    .insert({
      pricing_decision_id: decision.id,
      interest_rate: structure.all_in_rate_pct ?? null,
      spread: structure.spread_bps ? structure.spread_bps / 100 : null,
      index_code: structure.index_code ?? null,
      base_rate: structure.base_rate_pct ?? null,
      amort_years: structure.amort_months ? Math.round(structure.amort_months / 12) : null,
      term_years: structure.term_months ? Math.round(structure.term_months / 12) : null,
      loan_amount: structure.loan_amount ?? null,
      fees: structure.fees ?? null,
      prepayment: structure.prepayment ?? null,
      guaranty: structure.guaranty ?? null,
    })
    .select("id")
    .single();

  if (termsErr || !terms) {
    return { ok: false, error: `terms_insert_failed: ${termsErr?.message}`, status: 500 };
  }

  // 6. Write canonical memo narratives for pricing sections
  const metrics = scenario.metrics as any;
  const overlays = (scenario.policy_overlays ?? []) as any[];

  const narratives = {
    loan_structure: buildLoanStructureNarrative(structure, scenario.product_type),
    pricing_rationale: input.rationale,
    risk_and_mitigants: buildRiskNarrative(input.risks ?? [], input.mitigants ?? []),
    returns_and_coverage: buildReturnsNarrative(metrics),
    global_cash_flow_impact: buildGcfNarrative(metrics),
    policy_compliance: buildPolicyNarrative(overlays),
  };

  const inputHash = `decision_${decision.id}`;
  await sb.from("canonical_memo_narratives").upsert(
    {
      deal_id: input.dealId,
      bank_id: input.bankId,
      input_hash: inputHash,
      narratives,
      model: "pricing_decision_engine_v1",
      generated_at: new Date().toISOString(),
    },
    { onConflict: "deal_id,bank_id,input_hash" },
  );

  // 7. Emit ledger events
  await logPipelineLedger(sb, {
    bank_id: input.bankId,
    deal_id: input.dealId,
    event_key: "pricing.decision.made",
    status: "ok",
    payload: {
      decisionId: decision.id,
      scenarioKey: scenario.scenario_key,
      decision: input.decision,
      snapshotId: scenario.financial_snapshot_id,
    },
  });

  await logPipelineLedger(sb, {
    bank_id: input.bankId,
    deal_id: input.dealId,
    event_key: "pricing.pipeline.cleared",
    status: "ok",
    payload: { decisionId: decision.id, decision: input.decision },
  });

  // Lifecycle ledger
  writeEvent({
    dealId: input.dealId,
    kind: "pricing.decision.made",
    scope: "pricing",
    action: "decision_recorded",
    output: {
      decisionId: decision.id,
      termsId: terms.id,
      decision: input.decision,
      scenarioKey: scenario.scenario_key,
    },
  }).catch(() => {});

  return { ok: true, decisionId: decision.id, termsId: terms.id };
}

// ─── Narrative Builders ───────────────────────────────────────────────────────

function buildLoanStructureNarrative(structure: any, productType: string): string {
  const parts: string[] = [];
  parts.push(`**Product**: ${productType}`);
  parts.push(`**Loan Amount**: $${Number(structure.loan_amount ?? 0).toLocaleString("en-US")}`);
  parts.push(`**Rate**: ${structure.index_code} + ${structure.spread_bps}bps = ${Number(structure.all_in_rate_pct ?? 0).toFixed(2)}%`);
  parts.push(`**Term**: ${structure.term_months ?? "—"} months`);
  parts.push(`**Amortization**: ${structure.amort_months ?? "—"} months`);
  if (structure.interest_only_months > 0) {
    parts.push(`**Interest Only**: ${structure.interest_only_months} months`);
  }
  parts.push(`**Guaranty**: ${structure.guaranty ?? "—"}`);
  if (structure.fees?.origination_pct) {
    parts.push(`**Origination Fee**: ${structure.fees.origination_pct}%`);
  }
  if (structure.fees?.sba_guaranty_fee_pct) {
    parts.push(`**SBA Guaranty Fee**: ${structure.fees.sba_guaranty_fee_pct}%`);
  }
  return parts.join("\n");
}

function buildRiskNarrative(
  risks: Array<{ risk: string; severity: string }>,
  mitigants: Array<{ mitigant: string; strength: string }>,
): string {
  const parts: string[] = [];
  if (risks.length) {
    parts.push("**Risks:**");
    for (const r of risks) {
      parts.push(`- [${r.severity.toUpperCase()}] ${r.risk}`);
    }
  }
  if (mitigants.length) {
    parts.push("\n**Mitigants:**");
    for (const m of mitigants) {
      parts.push(`- [${m.strength.toUpperCase()}] ${m.mitigant}`);
    }
  }
  return parts.join("\n") || "No additional risks or mitigants identified.";
}

function buildReturnsNarrative(metrics: any): string {
  const parts: string[] = [];
  if (metrics.dscr != null) parts.push(`**DSCR**: ${Number(metrics.dscr).toFixed(2)}x`);
  if (metrics.dscr_stressed_300bps != null) parts.push(`**Stressed DSCR (+300bps)**: ${Number(metrics.dscr_stressed_300bps).toFixed(2)}x`);
  if (metrics.ltv_pct != null) parts.push(`**LTV**: ${(Number(metrics.ltv_pct) * 100).toFixed(1)}%`);
  if (metrics.debt_yield_pct != null) parts.push(`**Debt Yield**: ${(Number(metrics.debt_yield_pct) * 100).toFixed(1)}%`);
  if (metrics.annual_debt_service != null) parts.push(`**Annual Debt Service**: $${Number(metrics.annual_debt_service).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  return parts.join("\n") || "Coverage metrics pending.";
}

function buildGcfNarrative(metrics: any): string {
  if (metrics.global_cf_impact != null) {
    return `**Global Cash Flow**: $${Number(metrics.global_cf_impact).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return "Global cash flow impact not yet computed.";
}

function buildPolicyNarrative(overlays: any[]): string {
  if (!overlays.length) return "All policy requirements satisfied.";
  const parts: string[] = [];
  for (const o of overlays) {
    const status = o.applied ? "Applied" : "Waived";
    parts.push(`- **${o.source}**${o.section ? ` (${o.section})` : ""}: ${o.rule} — ${status}${o.impact ? `. ${o.impact}` : ""}`);
  }
  return parts.join("\n");
}
