import { RULESETS } from "./rules";
import { matchChecklistKeyFromFilename } from "./matchers";
import type { ChecklistDefinition, ChecklistRuleSet } from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { inferDocumentMetadata } from "@/lib/documents/inferDocumentMetadata";
import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";
import { sendSmsWithConsent } from "@/lib/sms/send";

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

function inferChecklistKeyFromDocumentType(documentTypeRaw: unknown): string | null {
  const dt = String(documentTypeRaw || "").trim();
  if (!dt) return null;

  // Map canonical inferred types to stable checklist keys.
  // This is intentionally conservative; it only covers the core keys that exist across rulesets.
  if (dt === "business_tax_return") return "IRS_BUSINESS_3Y";
  if (dt === "personal_tax_return") return "IRS_PERSONAL_3Y";
  if (dt === "income_statement") return "FIN_STMT_PL_YTD";
  if (dt === "balance_sheet") return "FIN_STMT_BS_YTD";

  // A combined financial statement could satisfy either; prefer P&L key for stamping.
  // Checklist satisfaction later can still use document_type when available.
  if (dt === "financial_statement") return "FIN_STMT_PL_YTD";

  return null;
}

function computeDefaultRequiredYearsFromChecklistKey(checklistKeyRaw: string): number[] | null {
  const key = String(checklistKeyRaw || "").toUpperCase();
  if (!key) return null;

  const m = key.match(/_(\d)Y\b/);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Tax returns are typically filed for the prior calendar year, but in Q1/Q2
  // the most recently-filed return is often two years back (e.g. Jan 2026 → 2024).
  // Use a simple UTC cutoff around the US filing deadline (Apr 15).
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth(); // 0=Jan
  const utcDay = now.getUTCDate();
  const beforeFilingDeadline = utcMonth < 3 || (utcMonth === 3 && utcDay < 16); // before Apr 16
  const lastFiled = beforeFilingDeadline ? currentYear - 2 : currentYear - 1;

  const years: number[] = [];
  for (let i = 0; i < n; i++) years.push(lastFiled - i);
  return years;
}

function parseRequiredDistinctYearCountFromChecklistKey(checklistKeyRaw: string): number | null {
  const key = String(checklistKeyRaw || "").toUpperCase();
  if (!key) return null;
  const m = key.match(/_(\d)Y\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeDocIntelDocTypeToCanonicalBucket(docTypeRaw: unknown): CanonicalDocTypeBucket | null {
  const raw = String(docTypeRaw ?? "").trim();
  if (!raw) return null;

  // Canonical values (preferred)
  if (raw === "business_tax_return") return "business_tax_return";
  if (raw === "personal_tax_return") return "personal_tax_return";
  if (raw === "income_statement") return "income_statement";
  if (raw === "balance_sheet") return "balance_sheet";
  if (raw === "financial_statement") return "financial_statement";

  // Tolerate older / alternate doc_type strings (e.g. OpenAI/legacy)
  // Normalize to a token soup.
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const has = (t: string) => s.includes(t);

  const looksIncome =
    has("income_statement") ||
    has("profit_and_loss") ||
    has("profit_loss") ||
    has("p_l") ||
    has("pl") ||
    has("statement_of_operations") ||
    has("statement_of_income");

  const looksBalance =
    has("balance_sheet") ||
    has("statement_of_financial_position") ||
    has("financial_position");

  if (looksIncome && looksBalance) return "financial_statement";
  if (looksIncome) return "income_statement";
  if (looksBalance) return "balance_sheet";

  // Tax returns: accept both descriptive types and form codes.
  if (has("business") && has("tax")) return "business_tax_return";
  if (has("personal") && has("tax")) return "personal_tax_return";

  // Form tokens seen in the wild.
  if (/(^|_)irs_?(1120s|1120|1065)(_|$)/.test(s) || /(^|_)1120s?(_|$)/.test(s) || /(^|_)1065(_|$)/.test(s)) {
    return "business_tax_return";
  }
  if (/(^|_)irs_?1040(_|$)/.test(s) || /(^|_)1040(_|$)/.test(s)) {
    return "personal_tax_return";
  }

  // If doc type is too broad, ignore it.
  if (has("unknown") || has("other") || has("document")) return null;

  return null;
}

function coerceYearArray(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
  return out.length ? Array.from(new Set(out)).sort((a, b) => b - a) : null;
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
  const docIntelByDocId = new Map<
    string,
    {
      docType: CanonicalDocTypeBucket | null;
      taxYear: number | null;
      detYears: number[] | null;
      confidence01: number | null;
    }
  >();
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

      // Also pull doc-intel results; this is the most reliable source for doc_type + tax_year.
      // Tolerate environments where the table or columns don't exist.
      const intelRes = await (sb as any)
        .from("doc_intel_results")
        .select("file_id, doc_type, tax_year, confidence, extracted_json")
        .eq("deal_id", dealId)
        .in("file_id", needsOcrIds.slice(0, 200));

      if (!intelRes.error) {
        for (const r of intelRes.data || []) {
          const id = String((r as any)?.file_id || "");
          if (!id) continue;

          const docType = normalizeDocIntelDocTypeToCanonicalBucket((r as any)?.doc_type);
          const taxYearRaw = (r as any)?.tax_year;
          const taxYearNum = Number(taxYearRaw);
          const taxYear = Number.isFinite(taxYearNum) ? Math.trunc(taxYearNum) : null;

          const extractedJson = (r as any)?.extracted_json;
          const detYears = coerceYearArray(extractedJson?.det?.doc_years);

          const confRaw = Number((r as any)?.confidence);
          const confidence01 = Number.isFinite(confRaw)
            ? confRaw > 1
              ? Math.max(0, Math.min(1, confRaw / 100))
              : Math.max(0, Math.min(1, confRaw))
            : null;

          docIntelByDocId.set(id, { docType, taxYear, detYears, confidence01 });
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
    const intel = docIntelByDocId.get(String(d.id)) ?? null;
    const meta = inferDocumentMetadata({
      originalFilename: d.original_filename || null,
      extractedText,
    });

    const docYears =
      meta.doc_years ??
      intel?.detYears ??
      (Array.isArray(m.yearsFound) && m.yearsFound.length ? m.yearsFound : null);

    const docYear =
      meta.doc_year ??
      (Number.isFinite(Number(intel?.taxYear)) ? (intel?.taxYear as number) : null) ??
      (m.docYear ?? null);

    const documentType =
      meta.document_type !== "unknown"
        ? meta.document_type
        : intel?.docType
          ? intel.docType
          : null;

    const inferredChecklistKey = inferChecklistKeyFromDocumentType(documentType);
    const matchConfidence = Math.max(
      Number(m.confidence ?? 0) || 0,
      Number(meta.confidence ?? 0) || 0,
      Number(intel?.confidence01 ?? 0) || 0,
    );
    const matchReason = [m.reason, meta.reason].filter(Boolean).join(" | ");

    const hasYearOrType =
      Boolean(documentType) || Boolean(docYear) || (Array.isArray(docYears) && docYears.length > 0);
    const hasConfidentKey = Boolean(m.matchedKey) && Number(m.confidence ?? 0) >= 0.6;
    if (!hasConfidentKey && !hasYearOrType) continue;

    // Best-effort update: tolerate schema drift (doc_years/document_type may not exist).
    const attempt1 = await sb
      .from("deal_documents")
      .update({
        // Prefer existing checklist_key, else use confident filename match, else use OCR-derived inferred type.
        checklist_key: d.checklist_key || (hasConfidentKey ? m.matchedKey : inferredChecklistKey),
        doc_year: d.doc_year || docYear,
        doc_years: (d as any)?.doc_years || docYears,
        document_type: (d as any)?.document_type || documentType,
        match_confidence: matchConfidence,
        match_reason: matchReason,
        match_source: intel ? "doc_intel" : extractedText ? "ocr" : (m.source || "filename"),
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

  // Pull AI mapping evidence (high-confidence only). This allows checklist satisfaction even
  // when stamping couldn't happen at upload time, and avoids relying on filenames.
  const mappingYearsByKey = new Map<string, Set<number>>();
  const mappingBestByKey = new Map<string, number>();
  const mappingSuggestByKey = new Map<string, number>();
  try {
    const mapRes = await (sb as any)
      .from("deal_doc_mappings")
      .select("checklist_key, doc_year, confidence, status")
      .eq("deal_id", dealId)
      .limit(1000);

    if (!mapRes.error) {
      for (const m of mapRes.data || []) {
        const key = String((m as any)?.checklist_key || "").trim();
        if (!key) continue;

        const confRaw = Number((m as any)?.confidence);
        const conf = Number.isFinite(confRaw)
          ? confRaw > 1
            ? Math.max(0, Math.min(1, confRaw / 100))
            : Math.max(0, Math.min(1, confRaw))
          : 0;

        const status = String((m as any)?.status || "");
        const suggested = status === "suggested" || (conf >= 0.7 && conf < 0.9);
        if (suggested) {
          const prevS = mappingSuggestByKey.get(key) ?? 0;
          if (conf > prevS) mappingSuggestByKey.set(key, conf);
        }

        const ok = status === "auto_accepted" || conf >= 0.9;
        if (!ok) continue;

        const prev = mappingBestByKey.get(key) ?? 0;
        if (conf > prev) mappingBestByKey.set(key, conf);

        const y = Number((m as any)?.doc_year);
        if (Number.isFinite(y)) {
          const set = mappingYearsByKey.get(key) ?? new Set<number>();
          set.add(Math.trunc(y));
          mappingYearsByKey.set(key, set);
        }
      }
    }
  } catch {
    // ignore
  }

  for (const item of checklistItems || []) {
    const itemKey = String((item as any)?.checklist_key || "").trim();
    if (!itemKey) continue;

    const acceptableTypes = acceptableDocTypesForChecklistKey(itemKey);
    const docsForItem = acceptableTypes
      ? (() => {
          const byType = acceptableTypes.flatMap((t) => docsByType.get(t) ?? []);
          // Schema drift / older envs may not have document_type populated; fall back to checklist_key.
          return byType.length ? byType : (docsByKey.get(itemKey) ?? []);
        })()
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

    // Add AI mapping evidence years (high-confidence only)
    const mappedYears = mappingYearsByKey.get(itemKey);
    if (mappedYears && mappedYears.size) {
      for (const y of mappedYears) satisfiedYearsSet.add(y);
    }
    const satisfiedYears = Array.from(satisfiedYearsSet).sort((a, b) => b - a);

    // For tax return requirements (IRS_*_nY), satisfy by DISTINCT YEAR COUNT.
    // This matches real-world intake (any 3 years, not necessarily a precomputed set).
    const requiredDistinctYearCount =
      itemKey.toUpperCase().startsWith("IRS_BUSINESS") || itemKey.toUpperCase().startsWith("IRS_PERSONAL")
        ? parseRequiredDistinctYearCountFromChecklistKey(itemKey)
        : null;

    const isSatisfied = requiredDistinctYearCount
      ? satisfiedYearsSet.size >= requiredDistinctYearCount
      : requiredYears && requiredYears.length
        ? requiredYears.every((y) => satisfiedYearsSet.has(y))
        : docsForItem.length > 0;

    // If there are no docs but we have a high-confidence mapping for this key, treat as satisfied.
    const hasHighConfidenceMapping = (mappingBestByKey.get(itemKey) ?? 0) >= 0.9;
    const satisfiedByMappingOnly = docsForItem.length === 0 && hasHighConfidenceMapping;

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

    if (!isSatisfied && !satisfiedByMappingOnly) continue;

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

  // If we have mid-confidence AI mappings, mark items as needs_review (without receiving).
  // This is schema-tolerant: if the system rejects the status value, ignore.
  try {
    const toReview = (checklistItems || [])
      .filter((it: any) => {
        const key = String(it?.checklist_key || "").trim();
        if (!key) return false;
        const s = String(it?.status || "");
        if (s === "received" || s === "satisfied" || s === "waived") return false;
        const conf = mappingSuggestByKey.get(key) ?? 0;
        return conf >= 0.7;
      })
      .map((it: any) => String(it.id))
      .filter(Boolean);

    if (toReview.length) {
      const upd = await sb
        .from("deal_checklist_items")
        .update({ status: "needs_review" } as any)
        .in("id", toReview);

      if (upd.error) {
        const msg = String(upd.error.message || "");
        if (!msg.toLowerCase().includes("invalid") && !msg.toLowerCase().includes("constraint")) {
          throw new Error(`checklist_mark_needs_review_failed: ${upd.error.message}`);
        }
      }
    }
  } catch {
    // ignore
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
  const skipFilename = Boolean(opts?.metadata?.skip_filename_match);
  const filenameForMatch = skipFilename ? "" : (originalFilename || "");

  // Run filename matcher + metadata inference (best-effort)
  const m = matchChecklistKeyFromFilename(filenameForMatch);
  const meta = inferDocumentMetadata({ originalFilename: skipFilename ? null : (originalFilename || null) });

  const docYears = meta.doc_years ?? (Array.isArray(m.yearsFound) && m.yearsFound.length ? m.yearsFound : null);
  const docYear = meta.doc_year ?? (m.docYear ?? null);
  const documentType = meta.document_type !== "unknown" ? meta.document_type : null;
  const matchConfidence = Math.max(Number(m.confidence ?? 0) || 0, Number(meta.confidence ?? 0) || 0);
  const matchReason = [m.reason, meta.reason].filter(Boolean).join(" | ");

  const hasConfidentKey = Boolean(m.matchedKey) && Number(m.confidence ?? 0) >= 0.6;
  const hasYearOrType = Boolean(documentType) || Boolean(docYear) || (Array.isArray(docYears) && docYears.length > 0);
  if (!hasConfidentKey && !hasYearOrType) {
    // Not confident enough to do anything
    return { matched: false, reason: skipFilename ? "content_pending" : "low_confidence" };
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
      match_source: skipFilename ? "content_pending" : m.source || "filename",
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
  const { dealId, sb: sbOverride } = opts;
  const result = await reconcileDealChecklist(dealId);

  try {
    const sb = sbOverride ?? supabaseAdmin();
    const { data: rows } = await sb
      .from("deal_checklist_items")
      .select("status, checklist_key, required")
      .eq("deal_id", dealId);

    if (rows) {
      const received = rows.filter((r: any) => r.status === "received" || r.status === "satisfied").length;
      const missing = rows.filter(
        (r: any) => r.status === "missing" || r.status === "pending" || r.status === "needs_review"
      ).length;
      const requiredRows = rows.filter((r: any) => r.required);
      const requiredSatisfied = requiredRows.filter(
        (r: any) => r.status === "received" || r.status === "satisfied"
      ).length;
      const satisfiedKeys = rows
        .filter((r: any) => r.status === "received" || r.status === "satisfied")
        .map((r: any) => r.checklist_key)
        .filter(Boolean);

      emitBuddySignalServer({
        type: "checklist.updated",
        source: "engine.reconcileChecklistForDeal",
        ts: Date.now(),
        dealId,
        payload: {
          received,
          missing,
          satisfied: satisfiedKeys,
        },
      });

      await writeEvent({
        dealId,
        kind: "deal.checklist.updated",
        actorUserId: null,
        input: {
          received,
          missing,
          total: rows.length,
        },
      });

      emitBuddySignalServer({
        type: "deal.checklist.updated",
        source: "engine.reconcileChecklistForDeal",
        ts: Date.now(),
        dealId,
        payload: {
          received,
          missing,
          total: rows.length,
        },
      });

      if (requiredRows.length > 0 && requiredSatisfied >= requiredRows.length) {
        const { data: existingCompletion } = await sb
          .from("deal_events")
          .select("id")
          .eq("deal_id", dealId)
          .eq("kind", "deal.borrower.completed")
          .limit(1)
          .maybeSingle();

        if (!existingCompletion) {
          await writeEvent({
            dealId,
            kind: "deal.borrower.completed",
            actorUserId: null,
            input: {
              required: requiredRows.length,
              received: requiredSatisfied,
            },
          });

          const { data: intake } = await sb
            .from("deal_intake")
            .select("borrower_phone")
            .eq("deal_id", dealId)
            .maybeSingle();

          const phone = String((intake as any)?.borrower_phone ?? "").trim();
          if (phone) {
            try {
              await sendSmsWithConsent({
                dealId,
                to: phone,
                body: "Thanks! We’ve received all requested documents for your loan.",
                label: "borrower_completed",
                metadata: {
                  required: requiredRows.length,
                  received: requiredSatisfied,
                },
              });
            } catch (e: any) {
              console.warn("[checklist] completion SMS failed", {
                dealId,
                error: e?.message ?? String(e),
              });
            }
          }
        }
      }

    }
  } catch {
    // ignore signal failures
  }

  return result;
}
