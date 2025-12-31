import { RULESETS } from "./rules";
import { matchChecklistKeyFromFilename } from "./matchers";
import type { ChecklistDefinition, ChecklistRuleSet } from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Normalize loan types into stable keys. Extend as needed. */
export function normalizeLoanType(raw: string | null | undefined): string {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return "UNKNOWN";
  // common normalizations
  if (v.includes("CRE") && v.includes("OWNER")) return "CRE_OWNER_OCCUPIED";
  if (v.includes("CRE") && v.includes("INVESTOR")) return "CRE_INVESTOR";
  return v.replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
}

export function getRuleSetForLoanType(loanTypeRaw: string | null | undefined): ChecklistRuleSet | null {
  const norm = normalizeLoanType(loanTypeRaw);
  const rs = RULESETS.find((r) => r.loan_type_norm === norm) || null;
  return rs;
}

export function buildChecklistRows(dealId: string, rules: ChecklistDefinition[]) {
  return rules.map((r) => ({
    deal_id: dealId,
    checklist_key: r.checklist_key,
    title: r.title,
    required: r.required,
    description: r.description ?? null,
    status: r.required ? "missing" : "pending",
  }));
}

/**
 * Reconcile a deal:
 * - ensure checklist seeded (based on intake.loan_type)
 * - match docs to checklist_key (filename matcher v1)
 * - let DB trigger mark checklist received
 */
export async function reconcileDealChecklist(dealId: string) {
  const sb = supabaseAdmin();

  // 1) Read intake loan_type
  const { data: intake, error: intakeErr } = await sb
    .from("deal_intake")
    .select("loan_type")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (intakeErr) throw new Error(`intake_read_failed: ${intakeErr.message}`);

  const rs = getRuleSetForLoanType(intake?.loan_type ?? null);
  if (!rs) {
    return { ok: true, seeded: 0, docsMatched: 0, message: "No ruleset for loan type" };
  }

  // 2) Seed checklist (idempotent)
  const rows = buildChecklistRows(dealId, rs.items);

  const { error: seedErr } = await sb
    .from("deal_checklist_items")
    .upsert(rows, { onConflict: "deal_id,checklist_key" });

  if (seedErr) throw new Error(`checklist_seed_failed: ${seedErr.message}`);

  // 3) Fetch deal_documents with NULL checklist_key OR NULL doc_year
  const { data: docs, error: docsErr } = await sb
    .from("deal_documents")
    .select("id, original_filename, checklist_key, doc_year")
    .eq("deal_id", dealId);

  if (docsErr) throw new Error(`docs_read_failed: ${docsErr.message}`);

  let docsMatched = 0;

  // 4) For each doc missing checklist_key or doc_year, attempt match
  for (const d of docs || []) {
    const needsKey = !d.checklist_key;
    const needsYear = !d.doc_year;
    if (!needsKey && !needsYear) continue;

    const m = matchChecklistKeyFromFilename(d.original_filename || "");
    if (!m.matchedKey || m.confidence < 0.6) continue;

    const { error: updErr } = await sb
      .from("deal_documents")
      .update({
        checklist_key: d.checklist_key || m.matchedKey,
        doc_year: d.doc_year || (m.docYear ?? null),
        match_confidence: m.confidence,
        match_reason: m.reason,
        match_source: m.source || "filename",
      })
      .eq("id", d.id);

    if (!updErr) docsMatched += 1;
  }

  // DB trigger handles satisfaction computation and checklist status updates.

  return {
    ok: true,
    ruleset: rs.key,
    seeded: rows.length,
    docsMatched,
  };
}
