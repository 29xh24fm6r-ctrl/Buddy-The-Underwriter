import "server-only";
import { createClient } from "@supabase/supabase-js";
import { processMissingDocsOutbound } from "@/lib/outbound/outboundOrchestrator";

type SupabaseAdmin = any; // Use any to avoid type conflicts with different Supabase client types

type RuleRow = {
  condition_key: string;
  doc_type: string;
  min_confidence: number;
  enabled: boolean;
  priority: number;
  matcher: any;
};

type ConditionRow = {
  id: string;
  deal_id: string | null;
  application_id: string | null;
  condition_type: string | null;
  satisfied: boolean;
  satisfied_at: string | null;
  satisfied_by: string | null;
  evidence: any[] | null;
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeDocType(raw: string | null | undefined) {
  return (raw ?? "UNKNOWN").toUpperCase().trim();
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function asObj(x: any) {
  return x && typeof x === "object" ? x : {};
}

/**
 * MEGA 11: Extract tax year from payload
 * Conservative, deterministic approach - no expensive scanning
 */
function extractTaxYear(payload: any): string | null {
  const p = asObj(payload);
  const ex = asObj(p.extracted ?? p.fields ?? p.data ?? p.document ?? null);

  // Try direct fields first
  const direct =
    ex.tax_year ??
    ex.taxYear ??
    p.tax_year ??
    p.taxYear ??
    ex.TaxYear ??
    ex["Tax Year"] ??
    null;

  const s = String(direct ?? "").trim();
  if (/^\d{4}$/.test(s)) return s;

  // Try to extract from OCR text (common patterns: "2023", "Tax Year 2023")
  const text = String(p.text ?? p.ocr_text ?? p.full_text ?? p.extracted_text ?? "").trim();
  if (text) {
    const m = text.match(/\b(20\d{2}|19\d{2})\b/);
    if (m) return m[1];
  }
  return null;
}

/**
 * MEGA 11: Extract statement month in ISO format (YYYY-MM)
 * Handles common formats: "07/2025", "July 2025", "2025-07"
 */
function extractStatementMonthISO(payload: any): string | null {
  const p = asObj(payload);
  const ex = asObj(p.extracted ?? p.fields ?? p.data ?? p.document ?? null);

  // Try direct fields first
  const direct =
    ex.statement_month_iso ??
    ex.statementMonthIso ??
    ex.statement_month ??
    ex.statementMonth ??
    p.statement_month_iso ??
    p.statementMonthIso ??
    p.statement_month ??
    p.statementMonth ??
    null;

  const s = String(direct ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;

  // Try to parse from text
  const text = String(p.text ?? p.ocr_text ?? p.full_text ?? p.extracted_text ?? "").trim();
  if (!text) return null;

  // Match MM/YYYY format (e.g., "07/2025")
  const mmYYYY = text.match(/\b(0?[1-9]|1[0-2])\/(20\d{2}|19\d{2})\b/);
  if (mmYYYY) {
    const mm = String(mmYYYY[1]).padStart(2, "0");
    const yy = mmYYYY[2];
    return `${yy}-${mm}`;
  }

  // Match "Month YYYY" format (e.g., "July 2025")
  const monthName = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2}|19\d{2})\b/i
  );
  if (monthName) {
    const map: Record<string, string> = {
      january: "01",
      february: "02",
      march: "03",
      april: "04",
      may: "05",
      june: "06",
      july: "07",
      august: "08",
      september: "09",
      october: "10",
      november: "11",
      december: "12",
    };
    const mm = map[monthName[1].toLowerCase()];
    const yy = monthName[2];
    if (mm) return `${yy}-${mm}`;
  }

  return null;
}

/**
 * MEGA 11: Compute distinct key value based on rule's distinct_key type
 */
function computeDistinctKey(distinctKey: string, payload: any): string | null {
  switch ((distinctKey ?? "any").toLowerCase()) {
    case "tax_year":
      return extractTaxYear(payload);
    case "statement_month_iso":
      return extractStatementMonthISO(payload);
    case "any":
      return "any";
    default:
      return null;
  }
}

/**
 * Cancel unsent draft messages when conditions auto-satisfy
 * Prevents sending stale "missing doc" requests after upload
 */
async function cancelUnsentDrafts(sb: SupabaseAdmin, dealId: string) {
  await (sb as any)
    .from("deal_message_drafts")
    .update({ status: "canceled", updated_at: nowIso() })
    .eq("deal_id", dealId)
    .in("status", ["draft", "pending_approval"]);
}

/**
 * Recompute Next Best Action based on current condition state
 * Updates deals.next_action_json with latest priority
 */
async function recomputeNextAction(sb: SupabaseAdmin, dealId: string) {
  const { data, error } = await (sb as any)
    .from("conditions_to_close")
    .select("id,satisfied")
    .eq("deal_id", dealId);

  if (error) throw error;

  const remaining = (data ?? []).filter((r: any) => !r.satisfied).length;

  const nextAction =
    remaining > 0
      ? { kind: "REQUEST_MISSING_DOCS", title: "Request missing documents", evidence: [`${remaining} open`] }
      : { kind: "UNDERWRITER_REVIEW", title: "Send for underwriting review", evidence: ["All satisfied"] };

  await (sb as any).from("deals").update({ next_action_json: nextAction }).eq("id", dealId);
}

/**
 * MEGA 11: Extract required distinct count from rule matcher
 */
function requiredDistinctCount(rule: RuleRow): number {
  const m = asObj(rule.matcher);
  return Math.max(1, num(m.required_distinct_count ?? m.years_required ?? m.months_required, 1));
}

/**
 * MEGA 11: Extract distinct key type from rule matcher
 */
function distinctKeyType(rule: RuleRow): string {
  const m = asObj(rule.matcher);
  return String(m.distinct_key ?? "any");
}

/**
 * MEGA 11: Check if rule allows satisfaction without distinct keys
 * (fallback to count-based matching if metadata extraction fails)
 */
function allowSatisfyWithoutKey(rule: RuleRow): boolean {
  const m = asObj(rule.matcher);
  return Boolean(m.allow_satisfy_without_distinct_key ?? false);
}

/**
 * MEGA 11: Evaluate if condition should be marked satisfied
 * Based on evidence array and rule's aggregation requirements
 * 
 * Returns: { ok: boolean, why: string }
 */
function evaluateSatisfied(rule: RuleRow, evidence: any[]): { ok: boolean; why: string } {
  const need = requiredDistinctCount(rule);
  const keyType = distinctKeyType(rule);
  const allowNoKey = allowSatisfyWithoutKey(rule);

  // Single-doc rules (MEGA 10 backward compatibility)
  if (need <= 1) {
    return { ok: evidence.length >= 1, why: "required_distinct_count=1" };
  }

  // Multi-doc aggregation (MEGA 11)
  const keys = new Set<string>();
  for (const ev of evidence) {
    const k = ev?.distinct_key_value;
    if (typeof k === "string" && k.trim()) {
      keys.add(k.trim());
    }
  }

  // Check if we have enough distinct keys
  if (keys.size >= need) {
    return { ok: true, why: `distinct ${keyType}: ${keys.size}/${need}` };
  }

  // Fallback: if evidence exists but keys missing, optionally allow satisfy
  if (allowNoKey && evidence.length >= need) {
    return { ok: true, why: `fallback evidence_count ${evidence.length}/${need}` };
  }

  return { ok: false, why: `distinct ${keyType}: ${keys.size}/${need}` };
}

/**
 * MEGA STEP 10 + 11: Automated Condition Reconciliation Engine with Multi-Doc Aggregation
 * 
 * Reconciles conditions when OCR/classify jobs complete
 * 
 * MEGA 10 (Single-doc):
 * - Upload bank statement → auto-satisfy "BANK_STATEMENTS" condition
 * 
 * MEGA 11 (Multi-doc aggregation):
 * - Upload 2023 tax return → append evidence, don't satisfy yet
 * - Upload 2024 tax return → append evidence, NOW satisfy (2 distinct years)
 * - Upload 6 months of statements → auto-satisfy when 6th distinct month uploaded
 * 
 * Flow:
 * 1. Extract doc_type + confidence from OCR/classify payload
 * 2. Query condition_match_rules for applicable rules
 * 3. For each matching rule:
 *    a. Compute distinct_key_value (tax_year, statement_month_iso, etc.)
 *    b. Append evidence to condition (ALWAYS, even if already satisfied)
 *    c. Evaluate if condition should flip to satisfied (based on aggregation rules)
 *    d. Only flip satisfied=true when threshold met (e.g., 2 distinct years)
 * 4. Cancel unsent draft messages (auto-satisfied = no need to request)
 * 5. Recompute Next Best Action
 * 
 * Returns: { matched: number, satisfied: number }
 */
export async function reconcileConditionsFromOcrResult(args: {
  sb: SupabaseAdmin;
  dealId: string;
  jobId: string;
  payload: any;
  source: "ocr" | "classify";
}) {
  const { sb, dealId, jobId, payload, source } = args;

  // 1. Extract classification from payload (normalize casing)
  const doc_type = normalizeDocType(payload?.classification?.doc_type ?? payload?.doc_type);
  const confidence = num(payload?.classification?.confidence ?? payload?.confidence, 0);
  const reasons = payload?.classification?.reasons ?? payload?.reasons ?? null;

  // 2. Query applicable rules (enabled + doc_type match + priority order)
  const { data: rules, error: rulesErr } = await (sb as any)
    .from("condition_match_rules")
    .select("condition_key,doc_type,min_confidence,enabled,priority,matcher")
    .eq("enabled", true)
    .eq("doc_type", doc_type)
    .order("priority", { ascending: true });

  if (rulesErr) throw rulesErr;

  // 3. Filter rules by confidence threshold
  const applicable = (rules ?? []).filter((r: RuleRow) => confidence >= num(r.min_confidence, 0.7));
  
  if (applicable.length === 0) {
    // No matching rules - still recompute next action (OCR might reveal new state)
    await recomputeNextAction(sb, dealId);
    return { matched: 0, satisfied: 0 };
  }

  // 4. Query existing conditions for deal
  const { data: conds, error: condsErr } = await (sb as any)
    .from("conditions_to_close")
    .select("id,deal_id,application_id,condition_type,satisfied,satisfied_at,satisfied_by,evidence")
    .eq("deal_id", dealId);

  if (condsErr) throw condsErr;

  // 5. Group conditions by condition_type (for fast lookup)
  const byType = new Map<string, ConditionRow[]>();
  for (const c of (conds ?? []) as ConditionRow[]) {
    const t = (c.condition_type ?? "").trim();
    if (!t) continue;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(c);
  }

  let satisfiedCount = 0;

  // 6. For each applicable rule, process matching conditions
  for (const rule of applicable as RuleRow[]) {
    const list = byType.get(rule.condition_key) ?? [];
    if (list.length === 0) continue;

    // MEGA 11: ALWAYS append evidence, even if condition already satisfied
    // This builds complete audit trail for multi-doc aggregation
    for (const c of list) {
      const keyType = distinctKeyType(rule);
      const distinctVal = computeDistinctKey(keyType, payload);

      // Build evidence entry with MEGA 11 aggregation fields
      const evidenceEntry = {
        source,
        job_id: jobId,
        doc_type,
        confidence,
        reasons: reasons ?? undefined,
        file_id: payload?.file_id ?? payload?.fileId ?? null,
        stored_name: payload?.stored_name ?? payload?.storedName ?? null,

        // MEGA 11 aggregation fields
        distinct_key_type: keyType,
        distinct_key_value: distinctVal, // may be null if not detected

        happened_at: nowIso(),
      };

      const currentEvidence = Array.isArray(c.evidence) ? c.evidence : [];
      const nextEvidence = [...currentEvidence, evidenceEntry];

      // Evaluate satisfaction after evidence append
      const evalRes = evaluateSatisfied(rule, nextEvidence);

      // Only flip satisfied if currently unsatisfied and threshold met
      const shouldFlip = !c.satisfied && evalRes.ok;

      const updatePayload: any = {
        evidence: nextEvidence,
        updated_at: nowIso(),
      };

      if (shouldFlip) {
        updatePayload.satisfied = true;
        updatePayload.satisfied_at = nowIso();
        updatePayload.satisfied_by = "auto:ocr";
        
        // Append satisfaction breadcrumb to evidence trail (audit trail)
        updatePayload.evidence = [
          ...nextEvidence,
          {
            source: "system",
            kind: "condition_satisfied",
            rule: rule.condition_key,
            why: evalRes.why,
            happened_at: nowIso(),
          },
        ];
      }

      // Update condition (append evidence, optionally flip satisfied)
      const { error: upErr } = await (sb as any)
        .from("conditions_to_close")
        .update(updatePayload)
        .eq("id", c.id)
        .eq("deal_id", dealId);

      if (upErr) throw upErr;

      if (shouldFlip) satisfiedCount += 1;
    }
  }

  // 7. If any conditions satisfied, cancel pending draft requests
  if (satisfiedCount > 0) {
    await cancelUnsentDrafts(sb, dealId);
  }

  // 8. Recompute Next Best Action (priority may have shifted)
  await recomputeNextAction(sb, dealId);

  // 9. MEGA STEP 12: Auto-update missing docs outbound (draft + optional auto-send)
  //    Non-fatal: log errors but don't fail reconciliation
  try {
    await processMissingDocsOutbound({ sb, dealId, trigger: "reconcile" });
  } catch (e: any) {
    console.error("[RECONCILE:OUTBOUND:ERROR]", dealId, e?.message ?? String(e));
  }

  return { matched: applicable.length, satisfied: satisfiedCount };
}
