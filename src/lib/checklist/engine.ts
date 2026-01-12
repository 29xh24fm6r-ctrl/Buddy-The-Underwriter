import { RULESETS } from "./rules";
import { matchChecklistKeyFromFilename } from "./matchers";
import type { ChecklistDefinition, ChecklistRuleSet } from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { inferDocumentMetadata } from "@/lib/documents/inferDocumentMetadata";

type CanonicalDocTypeBucket =
  | "business_tax_return"
  | "personal_tax_return"
  | "income_statement"
  | "balance_sheet"
  | "financial_statement";

function acceptableDocTypesForChecklistKey(checklistKeyRaw: string): CanonicalDocTypeBucket[] | null {
  const key = String(checklistKeyRaw || "").toUpperCase();
  if (!key) return null;

  if (key.startsWith("IRS_BUSINESS")) return ["business_tax_return"];
  if (key.startsWith("IRS_PERSONAL")) return ["personal_tax_return"];

  if (key === "FIN_STMT_PL_YTD") return ["income_statement", "financial_statement"];
  if (key === "FIN_STMT_BS_YTD") return ["balance_sheet", "financial_statement"];
  // Back-compat legacy key (older deals): treat as requiring either statement.
  if (key === "FIN_STMT_YTD") return ["income_statement", "balance_sheet", "financial_statement"];

  return null;
}

function computeDefaultRequiredYearsFromChecklistKey(checklistKeyRaw: string): number[] | null {
  const key = String(checklistKeyRaw || "").toUpperCase();
  if (!key) return null;

  const m = key.match(/_(\d)Y\b/);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Tax returns are typically filed for last calendar year.
  const currentYear = new Date().getUTCFullYear();
  const lastFiled = currentYear - 1;
  const years: number[] = [];
  for (let i = 0; i < n; i++) years.push(lastFiled - i);
  return years;
}

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
    const rowsWithYears = rows.map((r) => {
      const years = computeDefaultRequiredYearsFromChecklistKey(r.checklist_key);
      return years ? ({ ...r, required_years: years } as any) : r;
    });

    const attempt1 = await sb
      .from("deal_checklist_items")
      .upsert(rowsWithYears as any, { onConflict: "deal_id,checklist_key" });

    let seedErr = attempt1.error;
    if (seedErr) {
      const msg = String(seedErr.message || "");
      if (msg.toLowerCase().includes("does not exist") && msg.includes("required_years")) {
        const attempt2 = await sb
          .from("deal_checklist_items")
          .upsert(rows as any, { onConflict: "deal_id,checklist_key" });
        seedErr = attempt2.error;
      }
    }

    if (seedErr) throw new Error(`checklist_seed_failed: ${seedErr.message}`);
  }

  // 3) Fetch deal_documents with NULL checklist_key OR missing year metadata
  let docs: any[] = [];
  {
    const attempt = await sb
      .from("deal_documents")
      // doc_years/document_type may not exist yet in some environments.
      .select("id, original_filename, checklist_key, doc_year, doc_years, document_type")
      .eq("deal_id", dealId);

    if (attempt.error) {
      const msg = String(attempt.error.message || "");
      if (msg.toLowerCase().includes("does not exist") && (msg.includes("doc_years") || msg.includes("document_type"))) {
        const fallback = await sb
          .from("deal_documents")
          .select("id, original_filename, checklist_key, doc_year")
          .eq("deal_id", dealId);
        if (fallback.error) throw new Error(`docs_read_failed: ${fallback.error.message}`);
        docs = fallback.data || [];
      } else {
        throw new Error(`docs_read_failed: ${attempt.error.message}`);
      }
    } else {
      docs = attempt.data || [];
    }
  }

  let docsMatched = 0;

  // Optional: pull OCR text for docs that still need year/type.
  // This lets us infer (e.g.) Form 1120 + tax year 2023 even when the filename is ambiguous.
  const ocrTextByDocId = new Map<string, string>();
  try {
    const needsOcrIds = (docs || [])
      .filter((d: any) => {
        const needsYear = !d.doc_year;
        const needsYears = !(d as any)?.doc_years;
        const needsType = !(d as any)?.document_type;
        return needsYear || needsYears || needsType;
      })
      .map((d: any) => String(d.id))
      .filter(Boolean);

    if (needsOcrIds.length) {
      const ocrRes = await (sb as any)
        .from("document_ocr_results")
        .select("attachment_id, extracted_text")
        .eq("deal_id", dealId)
        .in("attachment_id", needsOcrIds.slice(0, 200));

      if (!ocrRes.error) {
        for (const r of ocrRes.data || []) {
          const id = String((r as any)?.attachment_id || "");
          const t = String((r as any)?.extracted_text || "");
          if (id && t) ocrTextByDocId.set(id, t);
        }
      }
    }
  } catch {
    // ignore
  }

  // 4) For each doc missing checklist_key or year metadata, attempt match (filename-only here).
  for (const d of docs || []) {
    const needsKey = !d.checklist_key;
    const needsYear = !d.doc_year;
    const needsYears = !(d as any)?.doc_years;
    const needsType = !(d as any)?.document_type;
    if (!needsKey && !needsYear && !needsYears && !needsType) continue;

    const m = matchChecklistKeyFromFilename(d.original_filename || "");
    const extractedText = ocrTextByDocId.get(String(d.id)) ?? null;
    const meta = inferDocumentMetadata({
      originalFilename: d.original_filename || null,
      extractedText,
    });
    const docYears = meta.doc_years ?? (Array.isArray(m.yearsFound) && m.yearsFound.length ? m.yearsFound : null);
    const docYear = meta.doc_year ?? (m.docYear ?? null);
    const documentType = meta.document_type !== "unknown" ? meta.document_type : null;
    const matchConfidence = Math.max(Number(m.confidence ?? 0) || 0, Number(meta.confidence ?? 0) || 0);
    const matchReason = [m.reason, meta.reason].filter(Boolean).join(" | ");

    const hasYearOrType = Boolean(documentType) || Boolean(docYear) || (Array.isArray(docYears) && docYears.length > 0);
    const hasConfidentKey = Boolean(m.matchedKey) && Number(m.confidence ?? 0) >= 0.6;
    if (!hasConfidentKey && !hasYearOrType) continue;

    // Best-effort update: tolerate schema drift (doc_years/document_type may not exist).
    const attempt1 = await sb
      .from("deal_documents")
      .update({
        checklist_key: hasConfidentKey ? (d.checklist_key || m.matchedKey) : d.checklist_key,
        doc_year: d.doc_year || docYear,
        doc_years: (d as any)?.doc_years || docYears,
        document_type: (d as any)?.document_type || documentType,
        match_confidence: matchConfidence,
        match_reason: matchReason,
        match_source: extractedText ? "ocr" : (m.source || "filename"),
      } as any)
      .eq("id", d.id);

    let updErr = attempt1.error;
    if (updErr) {
      const msg = String(updErr.message || "");
      if (msg.toLowerCase().includes("does not exist") && (msg.includes("doc_years") || msg.includes("document_type"))) {
        const attempt2 = await sb
          .from("deal_documents")
          .update({
            checklist_key: d.checklist_key || m.matchedKey,
            doc_year: d.doc_year || docYear,
            match_confidence: matchConfidence,
            match_reason: matchReason,
            match_source: m.source || "filename",
          } as any)
          .eq("id", d.id);
        updErr = attempt2.error;
      }
    }

    if (!updErr) docsMatched += 1;
  }

  // 5) Backstop: mark checklist items received when matching docs exist.
  // We still keep the DB trigger path (preferred), but this prevents "0 received"
  // in environments where migrations/triggers haven't been applied yet.
  // 5) Backstop: year-aware checklist satisfaction (schema-tolerant).
  // Prefer the DB trigger path, but keep this to avoid "0 received" in environments
  // where migrations/triggers haven't been applied yet.
  let matchedDocs: any[] = [];
  {
    const attempt = await sb
      .from("deal_documents")
      .select("id, checklist_key, doc_year, doc_years, document_type")
      .eq("deal_id", dealId);

    if (attempt.error) {
      const msg = String(attempt.error.message || "");
      if (msg.toLowerCase().includes("does not exist") && (msg.includes("doc_years") || msg.includes("document_type"))) {
        const fallback = await sb
          .from("deal_documents")
          .select("id, checklist_key, doc_year")
          .eq("deal_id", dealId)
          ;
        if (fallback.error) throw new Error(`docs_matched_read_failed: ${fallback.error.message}`);
        matchedDocs = fallback.data || [];
      } else {
        throw new Error(`docs_matched_read_failed: ${attempt.error.message}`);
      }
    } else {
      matchedDocs = attempt.data || [];
    }
  }

  let checklistItems: any[] = [];
  let hasRequiredYearsColumn = true;
  let hasSatisfiedYearsColumn = true;
  {
    const attempt = await sb
      .from("deal_checklist_items")
      .select("id, checklist_key, status, received_at, required_years, satisfied_years")
      .eq("deal_id", dealId);

    if (attempt.error) {
      const msg = String(attempt.error.message || "");
      if (msg.toLowerCase().includes("does not exist") && (msg.includes("required_years") || msg.includes("satisfied_years"))) {
        hasRequiredYearsColumn = !msg.includes("required_years");
        hasSatisfiedYearsColumn = !msg.includes("satisfied_years");
        const fallback = await sb
          .from("deal_checklist_items")
          .select("id, checklist_key, status, received_at")
          .eq("deal_id", dealId);
        if (fallback.error) throw new Error(`checklist_read_failed: ${fallback.error.message}`);
        checklistItems = fallback.data || [];
      } else {
        throw new Error(`checklist_read_failed: ${attempt.error.message}`);
      }
    } else {
      checklistItems = attempt.data || [];
    }
  }

  const docsByKey = new Map<string, any[]>();
  const docsByType = new Map<string, any[]>();
  for (const d of matchedDocs || []) {
    const key = String((d as any)?.checklist_key || "").trim();
    if (key) {
      const arr = docsByKey.get(key) ?? [];
      arr.push(d);
      docsByKey.set(key, arr);
    }

    const dt = String((d as any)?.document_type || "").trim();
    if (dt) {
      const arr = docsByType.get(dt) ?? [];
      arr.push(d);
      docsByType.set(dt, arr);
    }
  }

  let checklistMarkedReceived = 0;

  for (const item of checklistItems || []) {
    const itemKey = String((item as any)?.checklist_key || "").trim();
    if (!itemKey) continue;

    const acceptableTypes = acceptableDocTypesForChecklistKey(itemKey);
    const docsForItem = acceptableTypes
      ? acceptableTypes.flatMap((t) => docsByType.get(t) ?? [])
      : (docsByKey.get(itemKey) ?? []);
    if (docsForItem.length === 0) continue;

    const requiredYearsFromDb = Array.isArray((item as any)?.required_years)
      ? ((item as any).required_years as any[]).map((x) => Number(x)).filter((x) => Number.isFinite(x))
      : null;

    const requiredYears =
      (hasRequiredYearsColumn ? requiredYearsFromDb : null) ??
      computeDefaultRequiredYearsFromChecklistKey(itemKey);

    const satisfiedYearsSet = new Set<number>();
    for (const d of docsForItem) {
      const ys = (d as any)?.doc_years;
      if (Array.isArray(ys)) {
        for (const y of ys) {
          const n = Number(y);
          if (Number.isFinite(n)) satisfiedYearsSet.add(n);
        }
      }
      const y1 = Number((d as any)?.doc_year);
      if (Number.isFinite(y1)) satisfiedYearsSet.add(y1);
    }
    const satisfiedYears = Array.from(satisfiedYearsSet).sort((a, b) => b - a);

    const isSatisfied = requiredYears && requiredYears.length
      ? requiredYears.every((y) => satisfiedYearsSet.has(y))
      : docsForItem.length > 0;

    // Always attempt to persist satisfied_years (even when partial), when column exists.
    if (hasSatisfiedYearsColumn) {
      const upd = await sb
        .from("deal_checklist_items")
        .update({ satisfied_years: satisfiedYears } as any)
        .eq("id", (item as any).id);
      if (upd.error) {
        const msg = String(upd.error.message || "");
        if (!(msg.toLowerCase().includes("does not exist") && msg.includes("satisfied_years"))) {
          throw new Error(`checklist_update_satisfied_years_failed: ${upd.error.message}`);
        }
        hasSatisfiedYearsColumn = false;
      }
    }

    if (!isSatisfied) continue;

    if ((item as any)?.status !== "received") {
      const attempt = await sb
        .from("deal_checklist_items")
        .update({
          status: "received",
          received_at: (item as any)?.received_at ?? new Date().toISOString(),
        } as any)
        .eq("id", (item as any).id);

      if (attempt.error) {
        throw new Error(`checklist_mark_received_failed: ${attempt.error.message}`);
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
  const { sb, documentId, originalFilename } = opts;

  // Run filename matcher + metadata inference (best-effort)
  const m = matchChecklistKeyFromFilename(originalFilename || "");
  const meta = inferDocumentMetadata({ originalFilename: originalFilename || null });

  const docYears = meta.doc_years ?? (Array.isArray(m.yearsFound) && m.yearsFound.length ? m.yearsFound : null);
  const docYear = meta.doc_year ?? (m.docYear ?? null);
  const documentType = meta.document_type !== "unknown" ? meta.document_type : null;
  const matchConfidence = Math.max(Number(m.confidence ?? 0) || 0, Number(meta.confidence ?? 0) || 0);
  const matchReason = [m.reason, meta.reason].filter(Boolean).join(" | ");

  const hasConfidentKey = Boolean(m.matchedKey) && Number(m.confidence ?? 0) >= 0.6;
  const hasYearOrType = Boolean(documentType) || Boolean(docYear) || (Array.isArray(docYears) && docYears.length > 0);
  if (!hasConfidentKey && !hasYearOrType) {
    // Not confident enough to do anything
    return { matched: false, reason: "low_confidence" };
  }

  // Stamp the document with checklist_key + year metadata. Tolerate schema drift.
  const attempt1 = await sb
    .from("deal_documents")
    .update({
      checklist_key: hasConfidentKey ? m.matchedKey : undefined,
      doc_year: docYear,
      doc_years: docYears,
      document_type: documentType,
      match_confidence: matchConfidence,
      match_reason: matchReason,
      match_source: m.source || "filename",
    } as any)
    .eq("id", documentId);

  let updErr = attempt1.error;
  if (updErr) {
    const msg = String(updErr.message || "");
    if (msg.toLowerCase().includes("does not exist") && (msg.includes("doc_years") || msg.includes("document_type"))) {
      const attempt2 = await sb
        .from("deal_documents")
        .update({
          checklist_key: hasConfidentKey ? m.matchedKey : undefined,
          doc_year: docYear,
          match_confidence: matchConfidence,
          match_reason: matchReason,
          match_source: m.source || "filename",
        } as any)
        .eq("id", documentId);
      updErr = attempt2.error;
    }
  }

  if (updErr) {
    console.error("[matchAndStampDealDocument] update failed:", updErr);
    return { matched: false, error: updErr.message };
  }

  if (!hasConfidentKey) {
    return {
      matched: false,
      reason: "meta_only",
      doc_year: docYear,
      confidence: matchConfidence,
    } as any;
  }

  return {
    matched: true,
    checklist_key: m.matchedKey,
    doc_year: docYear,
    confidence: matchConfidence,
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
