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

  // 2) Seed checklist (idempotent) when we have a ruleset.
  // IMPORTANT: Even without intake/loan_type, we still want to stamp documents
  // from filename (step 4) so uploads BEFORE intake can reconcile later.
  const rows = rs ? buildChecklistRows(dealId, rs.items) : [];

  if (rs) {
    const { error: seedErr } = await sb
      .from("deal_checklist_items")
      .upsert(rows, { onConflict: "deal_id,checklist_key" });

    if (seedErr) throw new Error(`checklist_seed_failed: ${seedErr.message}`);
  }

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

  // 5) Backstop: mark checklist items received when matching docs exist.
  // We still keep the DB trigger path (preferred), but this prevents "0 received"
  // in environments where migrations/triggers haven't been applied yet.
  const { data: matchedDocs, error: matchedDocsErr } = await sb
    .from("deal_documents")
    .select("id, checklist_key")
    .eq("deal_id", dealId)
    .not("checklist_key", "is", null);

  if (matchedDocsErr) {
    throw new Error(`docs_matched_read_failed: ${matchedDocsErr.message}`);
  }

  const { data: checklistItems, error: checklistItemsErr } = await sb
    .from("deal_checklist_items")
    // NOTE: min_required is optional today; safe to select even if null in rows.
    .select("id, checklist_key, status, min_required")
    .eq("deal_id", dealId);

  if (checklistItemsErr) {
    throw new Error(`checklist_read_failed: ${checklistItemsErr.message}`);
  }

  const docsByKey = new Map<string, any[]>();
  for (const d of matchedDocs || []) {
    const key = String((d as any)?.checklist_key || "").trim();
    if (!key) continue;
    const arr = docsByKey.get(key) ?? [];
    arr.push(d);
    docsByKey.set(key, arr);
  }

  let checklistMarkedReceived = 0;

  // IMPORTANT: Reconcile must be checklist-driven, not document-driven.
  // Loop each checklist item and see if we have enough docs for that key.
  for (const item of checklistItems || []) {
    const key = String((item as any)?.checklist_key || "").trim();
    if (!key) continue;

    const docsForKey = docsByKey.get(key) ?? [];
    if (docsForKey.length === 0) continue;

    const minRequiredRaw = (item as any)?.min_required;
    const minRequired = minRequiredRaw ? Number(minRequiredRaw) : 0;
    if (minRequired && docsForKey.length < minRequired) continue;

    if ((item as any)?.status !== "received") {
      const { error: updChecklistErr } = await sb
        .from("deal_checklist_items")
        .update({
          status: "received",
          received_at: new Date().toISOString(),
        })
        .eq("id", (item as any).id);

      if (updChecklistErr) {
        throw new Error(`checklist_mark_received_failed: ${updChecklistErr.message}`);
      }

      checklistMarkedReceived += 1;
    }
  }

  // DB trigger handles satisfaction computation and checklist status updates.

  return {
    ok: true,
    ruleset: rs?.key ?? null,
    seeded: rows.length,
    docsMatched,
    checklistMarkedReceived,
    message: rs ? undefined : "No ruleset for loan type (documents still stamped)",
  };
}

/**
 * Match and stamp a single document with checklist_key + doc_year.
 * Called at upload time (all 4 writers).
 */
export async function matchAndStampDealDocument(opts: {
  sb: any; // supabase client (admin)
  dealId: string;
  documentId: string;
  originalFilename: string | null;
  mimeType: string | null;
  extractedFields?: any;
  metadata?: any;
}) {
  const { sb, dealId, documentId, originalFilename } = opts;

  // Run filename matcher
  const m = matchChecklistKeyFromFilename(originalFilename || "");
  
  if (!m.matchedKey || m.confidence < 0.6) {
    // Not confident enough, leave unmatched
    return { matched: false, reason: "low_confidence" };
  }

  // Stamp the document with checklist_key + doc_year
  const { error: updErr } = await sb
    .from("deal_documents")
    .update({
      checklist_key: m.matchedKey,
      doc_year: m.docYear ?? null,
      match_confidence: m.confidence,
      match_reason: m.reason,
      match_source: m.source || "filename",
    })
    .eq("id", documentId);

  if (updErr) {
    console.error("[matchAndStampDealDocument] update failed:", updErr);
    return { matched: false, error: updErr.message };
  }

  return {
    matched: true,
    checklist_key: m.matchedKey,
    doc_year: m.docYear ?? null,
    confidence: m.confidence,
  };
}

/**
 * Reconcile checklist for a deal (wrapper for reconcileDealChecklist).
 * Called after document stamping to update satisfaction + status.
 */
export async function reconcileChecklistForDeal(opts: { sb: any; dealId: string }) {
  const { dealId } = opts;
  return reconcileDealChecklist(dealId);
}
