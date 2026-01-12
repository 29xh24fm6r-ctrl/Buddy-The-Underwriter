import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { embedQuery } from "@/lib/retrieval/retrieve";
import { evaluateRules } from "@/lib/policy/rulesEngine";
import type { PolicyMitigant, PolicyRuleRow, RuleEvaluation, UWContext } from "@/lib/policy/types";

export type PolicyEngineException = {
  rule_key: string;
  title: string;
  severity: RuleEvaluation["severity"];
  result: RuleEvaluation["result"]; // fail|warn|info
  message: string;
  suggests_exception: boolean;
  mitigants: PolicyMitigant[];
  evidence: RuleEvaluation["evidence"];
};

export type PolicyEngineOutput = {
  exceptions: PolicyEngineException[];
  complianceScore: number;
  suggestedMitigants: Array<{
    key: string;
    label: string;
    priority: number;
    reason_rule_keys: string[];
  }>;
};

type RetrievedPolicyChunk = {
  chunk_id: string;
  bank_id: string;
  asset_id?: string;
  page_num?: number | null;
  section?: string | null;
  content: string;
  source_label: string;
  similarity: number;
};

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function parseNumberMaybe(x: any): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  const s = String(x ?? "").trim();
  if (!s) return null;

  // Strip common formatting
  const cleaned = s
    .replace(/[,\s]/g, "")
    .replace(/^\$/, "")
    .replace(/\$/g, "")
    .replace(/%/g, "");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractUwContextFromFindings(findings: any[] | null | undefined): UWContext {
  const ctx: UWContext = {};

  const arr = Array.isArray(findings) ? findings : [];
  for (const f of arr) {
    if (!f || typeof f !== "object") continue;

    const keyRaw =
      (typeof (f as any).metric === "string" && (f as any).metric) ||
      (typeof (f as any).key === "string" && (f as any).key) ||
      (typeof (f as any).name === "string" && (f as any).name) ||
      (typeof (f as any).kind === "string" && (f as any).kind) ||
      "";

    const key = String(keyRaw).toLowerCase().trim();
    const value = (f as any).value ?? (f as any).number ?? (f as any).val ?? (f as any).amount ?? null;
    const note = (f as any).note ?? (f as any).text ?? null;

    // Common metrics we support:
    if (key.includes("dscr")) {
      const n = parseNumberMaybe(value) ?? parseNumberMaybe(note);
      if (n !== null) ctx.dscr = n;
      continue;
    }

    if (key.includes("ltv")) {
      const n0 = parseNumberMaybe(value) ?? parseNumberMaybe(note);
      if (n0 !== null) {
        const n = n0 > 1.5 ? n0 / 100 : n0;
        ctx.ltv = clamp01(n);
      }
      continue;
    }

    if (key.includes("cash_injection") || key.includes("equity_injection") || key.includes("down_payment")) {
      const n0 = parseNumberMaybe(value) ?? parseNumberMaybe(note);
      if (n0 !== null) {
        const n = n0 > 1.5 ? n0 / 100 : n0;
        ctx.cash_injection = clamp01(n);
      }
      continue;
    }

    if (key.includes("fico")) {
      const n = parseNumberMaybe(value) ?? parseNumberMaybe(note);
      if (n !== null) ctx.fico = Math.round(n);
      continue;
    }

    if (key.includes("loan_amount") || key.includes("requested_amount")) {
      const n = parseNumberMaybe(value) ?? parseNumberMaybe(note);
      if (n !== null) ctx.loan_amount = n;
      continue;
    }

    // Pass-through for future metrics
    if (key && (value !== null || note !== null)) {
      (ctx as any)[key] = value ?? note;
    }
  }

  return ctx;
}

function buildNextActions(results: RuleEvaluation[]) {
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
        if (!existing.reason_rule_keys.includes(r.rule_key)) {
          existing.reason_rule_keys.push(r.rule_key);
        }
      }
    }
  }

  return Array.from(map.values())
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 24);
}

async function retrievePolicyRules(args: {
  bankId: string;
  query: string;
  k?: number;
}): Promise<RetrievedPolicyChunk[]> {
  const { bankId, query, k = 12 } = args;
  const sb = supabaseAdmin();

  const emb = await embedQuery(query);

  const { data, error } = await (sb as any).rpc("match_bank_policy_chunks", {
    in_bank_id: bankId,
    in_query_embedding: emb,
    in_match_count: k,
  });

  if (error) throw error;

  return (data || []).map((r: any) => ({
    chunk_id: String(r.chunk_id),
    bank_id: String(r.bank_id),
    asset_id: r.asset_id ? String(r.asset_id) : undefined,
    page_num: r.page_num ?? null,
    section: r.section ?? null,
    content: String(r.content || ""),
    source_label: String(r.source_label || ""),
    similarity: typeof r.similarity === "number" ? r.similarity : Number(r.similarity ?? 0),
  }));
}

function normalizePolicyMitigantRow(row: any): { ruleKey: string; mitigant: PolicyMitigant } | null {
  if (!row || typeof row !== "object") return null;

  const ruleKey =
    row.rule_key ??
    row.policy_rule_key ??
    row.ruleKey ??
    row.policyRuleKey ??
    row.rule ??
    null;
  const key = row.key ?? row.mitigant_key ?? row.mitigantKey ?? null;
  const label = row.label ?? row.mitigant_label ?? row.mitigantLabel ?? null;
  const priority = Number.isFinite(row.priority) ? Number(row.priority) : undefined;
  const note = typeof row.note === "string" ? row.note : undefined;

  if (!ruleKey || !key || !label) return null;

  return {
    ruleKey: String(ruleKey),
    mitigant: {
      key: String(key),
      label: String(label),
      ...(priority !== undefined ? { priority } : {}),
      ...(note ? { note } : {}),
    },
  };
}

async function fetchPolicyMitigantsForRuleKeys(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  bankId: string;
  ruleKeys: string[];
}): Promise<Map<string, PolicyMitigant[]> | null> {
  const { sb, bankId, ruleKeys } = args;
  const keys = Array.from(new Set(ruleKeys.map((k) => String(k)).filter(Boolean)));
  if (keys.length === 0) return new Map();

  // This repo historically stored mitigants on bank_policy_rules.mitigants (JSONB).
  // Some deployments may also have a dedicated policy_mitigants table.
  // Best-effort: try to fetch; if table/columns don't exist, return null to indicate "not available".
  try {
    let data: any[] | null = null;

    // Attempt the most selective query first.
    const q1 = await (sb as any)
      .from("policy_mitigants")
      .select("*")
      .eq("bank_id", bankId)
      .in("rule_key", keys);

    if (!q1.error) {
      data = (q1.data ?? []) as any[];
    } else {
      // Fallback: fetch by bank only and filter in-memory.
      const q2 = await (sb as any)
        .from("policy_mitigants")
        .select("*")
        .eq("bank_id", bankId);

      if (q2.error) {
        const msg = String(q2.error.message || "");
        // relation doesn't exist / table not exposed
        if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("schema")) return null;
        return null;
      }

      data = ((q2.data ?? []) as any[]).filter((r) => {
        const rk = String(r?.rule_key ?? r?.policy_rule_key ?? r?.ruleKey ?? r?.policyRuleKey ?? "");
        return rk && keys.includes(rk);
      });
    }

    const map = new Map<string, PolicyMitigant[]>();
    for (const row of data || []) {
      const norm = normalizePolicyMitigantRow(row);
      if (!norm) continue;
      const arr = map.get(norm.ruleKey) ?? [];
      arr.push(norm.mitigant);
      map.set(norm.ruleKey, arr);
    }

    return map;
  } catch {
    return null;
  }
}

async function logTruthEvent(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  dealId: string;
  bankId: string;
  changedTopics: string[];
  truthJson: any;
  metadata?: any;
}) {
  const { sb, dealId, bankId, changedTopics, truthJson, metadata } = args;

  // Compute next snapshot version
  const existing = await (sb as any)
    .from("deal_truth_snapshots")
    .select("version")
    .eq("deal_id", dealId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = Number(existing.data?.version ?? 0) + 1;

  const snap = await (sb as any).from("deal_truth_snapshots").insert({
    deal_id: dealId,
    bank_id: bankId,
    truth_json: truthJson,
    version: nextVersion,
    total_claims: 0,
    resolved_claims: 0,
    needs_human: 0,
    overall_confidence: null,
    created_by: "policy_engine",
  }).select("id").single();

  if (snap.error) throw snap.error;

  const evt = await (sb as any).from("deal_truth_events").insert({
    deal_id: dealId,
    bank_id: bankId,
    event_type: "deal.truth.updated",
    truth_snapshot_id: snap.data.id,
    trigger: "agent_run",
    changed_topics: changedTopics,
    metadata: metadata ?? {},
  });

  if (evt.error) throw evt.error;
}

/**
 * Phase 2: Policy-Aware Underwriting
 *
 * Reads multimodal findings from OCR (document_ocr_results.raw_json.findings), retrieves relevant
 * bank policy chunks via pgvector, evaluates deterministic policy rules, returns exceptions + mitigants,
 * and logs a truth event (trigger=agent_run).
 */
export async function runPolicyAwareUnderwriting(args: {
  dealId: string;
  bankId?: string;
  attachmentId?: string;
}): Promise<PolicyEngineOutput> {
  const sb = supabaseAdmin();

  const dealId = String(args.dealId || "");
  if (!dealId) throw new Error("missing_deal_id");

  const bankId = args.bankId ? String(args.bankId) : String(await getCurrentBankId());

  // Tenant enforcement: ensure deal belongs to bank
  const dealRes = await (sb as any)
    .from("deals")
    .select("id, bank_id, deal_type")
    .eq("id", dealId)
    .maybeSingle();

  if (dealRes.error) throw new Error(`deal_fetch_failed:${dealRes.error.message}`);
  if (!dealRes.data) throw new Error("deal_not_found");
  if (String(dealRes.data.bank_id) !== String(bankId)) throw new Error("wrong_bank");

  const attachmentId = args.attachmentId ? String(args.attachmentId) : null;

  // 1) Input integration: OCR findings
  let ocrQ = (sb as any)
    .from("document_ocr_results")
    .select("attachment_id, provider, status, raw_json, updated_at")
    .eq("deal_id", dealId)
    .order("updated_at", { ascending: false })
    .limit(12);

  if (attachmentId) ocrQ = ocrQ.eq("attachment_id", attachmentId);

  const ocrRes = await ocrQ;
  if (ocrRes.error) throw new Error(`ocr_results_fetch_failed:${ocrRes.error.message}`);

  const ocrRows = (ocrRes.data ?? []) as any[];
  const allFindings: any[] = [];

  for (const row of ocrRows) {
    const raw = row?.raw_json;
    const findings = raw?.findings;

    if (Array.isArray(findings)) {
      for (const f of findings) allFindings.push(f);
    }

    // Future-proof: allow raw.multimodal_findings as object
    if (raw && typeof raw.multimodal_findings === "object" && raw.multimodal_findings) {
      allFindings.push({ metric: "multimodal_findings", value: raw.multimodal_findings });
    }
  }

  // 2) Doc type (for semantic retrieval)
  let docType = "Unknown";
  if (attachmentId) {
    const di = await (sb as any)
      .from("doc_intel_results")
      .select("doc_type")
      .eq("deal_id", dealId)
      .eq("file_id", attachmentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!di.error && di.data?.doc_type) docType = String(di.data.doc_type);
  } else {
    const di = await (sb as any)
      .from("doc_intel_results")
      .select("doc_type")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!di.error && di.data?.doc_type) docType = String(di.data.doc_type);
  }

  // 3) Semantic retrieval (policy grounding)
  let policyChunks: RetrievedPolicyChunk[] = [];
  try {
    policyChunks = await retrievePolicyRules({
      bankId,
      query: `Bank credit policy relevant to document type: ${docType}. Focus on underwriting limits (DSCR, LTV, cash injection, FICO, loan amount).`,
      k: 12,
    });
  } catch (e) {
    // Retrieval is grounding only; evaluation is deterministic on bank_policy_rules.
    console.warn("[policyEngine] policy retrieval failed (non-fatal)", {
      bankId,
      docType,
      error: (e as any)?.message ?? String(e),
    });
    policyChunks = [];
  }

  // 4) Conflict detection: evaluate deterministic rules against ctx built from findings
  const ctxFromFindings = extractUwContextFromFindings(allFindings);
  const uwCtx: UWContext = {
    deal_type: dealRes.data.deal_type || undefined,
    ...ctxFromFindings,
  };

  const rulesRes = await (sb as any)
    .from("bank_policy_rules")
    .select(
      "id,bank_id,rule_key,title,description,scope,predicate,decision,mitigants,exception_template,severity,active",
    )
    .eq("bank_id", bankId)
    .eq("active", true)
    .order("severity", { ascending: true });

  if (rulesRes.error) throw new Error(`rules_fetch_failed:${rulesRes.error.message}`);
  const rules = (rulesRes.data ?? []) as PolicyRuleRow[];

  const citRes = await (sb as any)
    .from("bank_policy_rule_citations")
    .select(
      "rule_id, asset_id, chunk_id, note, bank_policy_chunks:chunk_id(content,page_num,section)",
    )
    .eq("bank_id", bankId);

  // Citations are optional
  const evidenceByRuleId: Record<string, any[]> = {};
  if (!citRes.error) {
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
  }

  const evals = evaluateRules(rules, uwCtx, evidenceByRuleId);

  // 4b) Mitigant mapping: prefer policy_mitigants table if present.
  // If not present, fall back to mitigants embedded on bank_policy_rules (already used by evaluateRules).
  let effectiveEvals: RuleEvaluation[] = evals;
  try {
    const mitigantMap = await fetchPolicyMitigantsForRuleKeys({
      sb,
      bankId,
      ruleKeys: evals.map((r) => r.rule_key),
    });

    if (mitigantMap) {
      effectiveEvals = evals.map((r) => {
        const m = mitigantMap.get(r.rule_key);
        if (!m?.length) return r;
        return {
          ...r,
          mitigants: m,
        } as RuleEvaluation;
      });
    }
  } catch {
    effectiveEvals = evals;
  }

  const fails = effectiveEvals.filter((r) => r.result === "fail").length;
  const warns = effectiveEvals.filter((r) => r.result === "warn").length;
  const infos = effectiveEvals.filter((r) => r.result === "info").length;

  const exceptions: PolicyEngineException[] = effectiveEvals
    .filter((r) => r.result !== "pass")
    .map((r) => ({
      rule_key: r.rule_key,
      title: r.title,
      severity: r.severity,
      result: r.result,
      message: r.message,
      suggests_exception: r.suggests_exception,
      mitigants: r.mitigants,
      evidence: r.evidence,
    }));

  const suggestedMitigants = buildNextActions(effectiveEvals);

  // Score heuristic: fail heavier than warn
  const complianceScore = Math.max(0, Math.min(100, 100 - fails * 25 - warns * 10));

  // 5) Event logging: snapshot + truth event (agent_run)
  try {
    await logTruthEvent({
      sb,
      dealId,
      bankId,
      changedTopics: ["policy", "underwriting"],
      truthJson: {
        policy_underwrite: {
          deal_id: dealId,
          bank_id: bankId,
          doc_type: docType,
          complianceScore,
          exceptions,
          suggestedMitigants,
          context: uwCtx,
          policy_chunks: policyChunks.slice(0, 8),
        },
      },
      metadata: {
        engine: "policy_engine_v2",
        doc_type: docType,
        ocr_rows_used: ocrRows.length,
        findings_used: allFindings.length,
        rules_evaluated: rules.length,
        summary: { fails, warns, infos },
        matches: effectiveEvals
          .filter((r) => r.result === "pass")
          .map((r) => ({ rule_key: r.rule_key, severity: r.severity })),
        violations: effectiveEvals
          .filter((r) => r.result !== "pass")
          .map((r) => ({
            rule_key: r.rule_key,
            severity: r.severity,
            result: r.result,
            suggests_exception: r.suggests_exception,
            message: r.message,
            mitigant_keys: (r.mitigants || []).map((m) => m.key),
          })),
      },
    });
  } catch (e: any) {
    // Non-fatal. UI can still render the returned structure.
    console.warn("[policyEngine] truth event log failed (non-fatal)", {
      dealId,
      bankId,
      error: e?.message ?? String(e),
    });
  }

  return {
    exceptions,
    complianceScore,
    suggestedMitigants,
  };
}
