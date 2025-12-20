// src/lib/creditDiscovery/engine.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CREDIT_DISCOVERY_QUESTIONS } from "./questions";
import { DOMAIN_REQUIREMENTS, DiscoveryDomain, DISCOVERY_STAGE_FLOW } from "./domains";
import { aiJson } from "@/lib/ai/openai";
import { recordAiEvent } from "@/lib/ai/audit";

type SessionRow = any;

function nowIso() {
  return new Date().toISOString();
}

function computeMissingDomains(facts: Array<{ domain: string; key: string }>) {
  const present = new Map<string, Set<string>>();
  for (const f of facts) {
    if (!present.has(f.domain)) present.set(f.domain, new Set());
    present.get(f.domain)!.add(f.key);
  }

  const missing: string[] = [];
  for (const [domain, req] of Object.entries(DOMAIN_REQUIREMENTS)) {
    const have = present.get(domain)?.size ? present.get(domain)! : new Set<string>();
    const ok = req.requiredKeys.every((k) => have.has(k));
    if (!ok) missing.push(domain);
  }
  return missing;
}

function completenessFromMissing(missing: string[]) {
  const total = Object.keys(DOMAIN_REQUIREMENTS).length;
  const done = total - missing.length;
  return Math.round((done / total) * 10000) / 100; // 2 decimals
}

function nextQuestionForMissing(missingDomains: string[], alreadyAskedIds: Set<string>) {
  for (const d of missingDomains) {
    const domainQuestions = CREDIT_DISCOVERY_QUESTIONS.filter((q) => q.domain === d);
    for (const q of domainQuestions) {
      if (!alreadyAskedIds.has(q.id)) return q;
    }
  }
  // If nothing left, ask wrap-up confirmation
  return {
    id: "wrapup_confirm",
    domain: "risk" as DiscoveryDomain,
    text: "Is there anything else that would help us understand the business or the request before underwriting begins?",
    why: "This gives you a chance to share context we might not have asked directly.",
    expects: "text" as const,
    requiredKeysWritten: [],
  };
}

export async function startOrGetSession(dealId: string) {
  const sb = supabaseAdmin();

  const existing = await sb.from("credit_discovery_sessions").select("*").eq("deal_id", dealId).maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data) return existing.data as SessionRow;

  const first = CREDIT_DISCOVERY_QUESTIONS[0];
  const ins = await sb.from("credit_discovery_sessions").insert({
    deal_id: dealId,
    status: "active",
    stage: "business",
    completeness: 0,
    missing_domains: Object.keys(DOMAIN_REQUIREMENTS),
    summary_json: {},
    last_question_json: { id: first.id, text: first.text, domain: first.domain, why: first.why, expects: first.expects },
    last_activity_at: nowIso(),
    updated_at: nowIso(),
  }).select("*").single();
  if (ins.error) throw ins.error;

  await recordAiEvent({
    deal_id: dealId,
    scope: "credit_discovery",
    action: "start",
    input_json: { dealId },
    output_json: { sessionId: ins.data.id, firstQuestion: ins.data.last_question_json },
    confidence: 100,
    requires_human_review: false,
  });

  return ins.data as SessionRow;
}

async function upsertFact(args: {
  dealId: string;
  domain: string;
  key: string;
  value_json: any;
  source: "borrower" | "document" | "banker" | "ai_inferred";
  confidence: number;
  evidence_json?: any;
}) {
  const sb = supabaseAdmin();
  const up = await sb.from("credit_discovery_facts").upsert({
    deal_id: args.dealId,
    domain: args.domain,
    key: args.key,
    value_json: args.value_json,
    source: args.source,
    confidence: args.confidence,
    evidence_json: args.evidence_json ?? null,
    updated_at: nowIso(),
  }, { onConflict: "deal_id,domain,key" });

  if (up.error) throw up.error;
}

export async function answerAndAdvance(args: {
  dealId: string;
  sessionId: string;
  questionId: string;
  answerText: string;
  actorUserId?: string | null; // borrower user id
}) {
  const sb = supabaseAdmin();

  const q = CREDIT_DISCOVERY_QUESTIONS.find((x) => x.id === args.questionId) || null;
  const domain = q?.domain || "business_model";

  // Save raw answer
  const insAns = await sb.from("credit_discovery_answers").insert({
    session_id: args.sessionId,
    deal_id: args.dealId,
    question_id: args.questionId,
    domain,
    raw_answer_text: args.answerText,
  }).select("*").single();
  if (insAns.error) throw insAns.error;

  // AI extraction (structured facts) — safe, audited, can be stubbed
  const schemaHint = `{
    "facts": [
      {"domain":"${domain}","key":"string","value_json":{},"confidence":50}
    ],
    "summary_delta": {},
    "detected_risks": [],
    "followups": []
  }`;

  const ai = await aiJson<any>({
    scope: "credit_discovery",
    action: "extract_facts",
    system:
      "You are a senior commercial credit officer. Extract structured facts from borrower answers. Do not invent facts. If unknown, omit. Keep values clean JSON.",
    user:
      `QUESTION: ${q?.text || args.questionId}\nANSWER: ${args.answerText}\nReturn JSON exactly matching the schema.`,
    jsonSchemaHint: schemaHint,
  });

  if (ai.ok) {
    await recordAiEvent({
      deal_id: args.dealId,
      actor_user_id: args.actorUserId ?? null,
      scope: "credit_discovery",
      action: "extract_facts",
      input_json: { questionId: args.questionId, answer: args.answerText },
      output_json: ai.result,
      confidence: ai.confidence,
      evidence_json: ai.evidence ?? null,
      requires_human_review: ai.requires_human_review,
    });

    // Write facts
    const facts = Array.isArray(ai.result?.facts) ? ai.result.facts : [];
    for (const f of facts) {
      if (!f?.domain || !f?.key) continue;
      await upsertFact({
        dealId: args.dealId,
        domain: String(f.domain),
        key: String(f.key),
        value_json: f.value_json ?? f.value ?? args.answerText,
        source: "ai_inferred",
        confidence: Math.max(0, Math.min(100, Number(f.confidence ?? ai.confidence ?? 50))),
        evidence_json: ai.evidence ?? null,
      });
    }
  }

  // Also write minimal borrower-asserted facts for "requiredKeysWritten" to ensure deterministic completeness works
  if (q?.requiredKeysWritten?.length) {
    for (const key of q.requiredKeysWritten) {
      await upsertFact({
        dealId: args.dealId,
        domain: q.domain,
        key,
        value_json: { asserted_text: args.answerText },
        source: "borrower",
        confidence: 60,
        evidence_json: [{ kind: "borrower_answer", questionId: args.questionId, answerId: insAns.data.id }],
      });
    }
  }

  // Recompute completeness
  const factsRes = await sb.from("credit_discovery_facts").select("domain,key").eq("deal_id", args.dealId);
  if (factsRes.error) throw factsRes.error;

  const missing = computeMissingDomains(factsRes.data || []);
  const completeness = completenessFromMissing(missing);

  // Find already asked
  const askedRes = await sb.from("credit_discovery_answers").select("question_id").eq("session_id", args.sessionId);
  if (askedRes.error) throw askedRes.error;
  const askedSet = new Set((askedRes.data || []).map((r: any) => r.question_id));

  const nextQ = nextQuestionForMissing(missing, askedSet);

  // stage selection (simple: based on missing)
  let stage = "wrapup";
  for (const s of DISCOVERY_STAGE_FLOW) {
    if (s.domains.some((d) => missing.includes(d))) { stage = s.stage; break; }
  }

  const status = missing.length === 0 ? "complete" : "active";

  const upd = await sb
    .from("credit_discovery_sessions")
    .update({
      status,
      stage,
      completeness,
      missing_domains: missing,
      last_question_json: { id: nextQ.id, text: nextQ.text, domain: nextQ.domain, why: (nextQ as any).why, expects: nextQ.expects },
      last_activity_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq("id", args.sessionId)
    .select("*")
    .single();
  if (upd.error) throw upd.error;

  return {
    session: upd.data,
    nextQuestion: upd.data.last_question_json,
    completeness,
    missing_domains: missing,
  };
}

export async function getDiscoveryStatus(dealId: string) {
  const sb = supabaseAdmin();
  const s = await sb.from("credit_discovery_sessions").select("*").eq("deal_id", dealId).maybeSingle();
  if (s.error) throw s.error;

  const facts = await sb.from("credit_discovery_facts").select("*").eq("deal_id", dealId).limit(500);
  if (facts.error) throw facts.error;

  const answers = await sb.from("credit_discovery_answers").select("*").eq("deal_id", dealId).order("created_at", { ascending: true }).limit(500);
  if (answers.error) throw answers.error;

  return {
    session: s.data,
    facts: facts.data || [],
    answers: answers.data || [],
  };
}
