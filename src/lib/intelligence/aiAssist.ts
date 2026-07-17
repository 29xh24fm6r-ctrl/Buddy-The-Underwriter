import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/openai";
import type { SB } from "./types";

/**
 * AI assistance — spec section 7.8. "Add AI only after deterministic
 * systems are functioning" — every action here gathers its context from
 * the deterministic services already built in this program (activities,
 * deal stage, alerts) and calls the existing aiJson() helper (the
 * project's canonical "prompt in, JSON out" primitive, already used for
 * credit-memo generation), which itself degrades to a clearly-labeled
 * deterministic fallback when no GEMINI_API_KEY is configured — never a
 * silently fabricated response. No action here ever writes anything: the
 * caller always receives a draft/summary string for human review, never
 * an applied stage change, sent communication, or completed requirement.
 *
 * Duplicate-record detection and "suggest next action" are deliberately
 * NOT implemented as AI actions here — PR1's crm/dedup.ts already does
 * deterministic duplicate detection, and next-best-action / alerts.ts
 * already surface blockers deterministically; adding an AI-guessed
 * version of either would be a second, less trustworthy source for a
 * fact a real system already computes.
 */

export type AiAssistAction =
  | "summarize_relationship"
  | "summarize_deal_activity"
  | "draft_follow_up_email"
  | "explain_stalled"
  | "summarize_pipeline_risk";

export type AiAssistResult = {
  action: AiAssistAction;
  text: string;
  requiresHumanReview: boolean;
  evidenceCount: number;
};

async function recentActivitiesText(bankId: string, filter: Record<string, string>, sb: SB): Promise<{ text: string; count: number }> {
  let q = sb.from("crm_activities").select("kind, title, happens_at, outcome, direction").eq("bank_id", bankId);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data } = await q.order("happens_at", { ascending: false }).limit(20);
  const rows = (data ?? []) as Array<{ kind: string; title: string; happens_at: string; outcome: string | null; direction: string | null }>;
  return {
    text: rows.map((r) => `- [${r.happens_at}] ${r.kind}${r.direction ? ` (${r.direction})` : ""}: ${r.title}${r.outcome ? ` — outcome: ${r.outcome}` : ""}`).join("\n") || "(no activity recorded)",
    count: rows.length,
  };
}

async function callAssist(scope: string, system: string, userPrompt: string, evidenceCount: number): Promise<{ text: string; requiresHumanReview: boolean }> {
  const result = await aiJson<{ summary: string }>({
    scope,
    action: "generate_text",
    system,
    user: userPrompt,
    jsonSchemaHint: '{"summary": "string"}',
  });
  if (!result.ok) return { text: "Unable to generate a summary right now.", requiresHumanReview: true };
  return { text: result.result?.summary ?? "", requiresHumanReview: result.requires_human_review || evidenceCount === 0 };
}

export async function summarizeOrganizationRelationship(bankId: string, organizationId: string, sb: SB = supabaseAdmin()): Promise<AiAssistResult> {
  const { text, count } = await recentActivitiesText(bankId, { target_organization_id: organizationId }, sb);
  const { text: summary, requiresHumanReview } = await callAssist(
    "intelligence.summarize_relationship",
    "You summarize a brokerage's relationship with a referral organization from its activity log. Be factual and concise. Only state what the log shows — never invent facts, dollar amounts, or commitments not present in the log.",
    `Activity log:\n${text}\n\nWrite a 2-4 sentence summary of the state of this relationship.`,
    count,
  );
  return { action: "summarize_relationship", text: summary, requiresHumanReview, evidenceCount: count };
}

export async function summarizeDealActivity(bankId: string, dealId: string, sb: SB = supabaseAdmin()): Promise<AiAssistResult> {
  const { text, count } = await recentActivitiesText(bankId, { target_deal_id: dealId }, sb);
  const { text: summary, requiresHumanReview } = await callAssist(
    "intelligence.summarize_deal_activity",
    "You summarize recent activity on a loan brokerage deal. Be factual and concise. Only state what the log shows.",
    `Activity log:\n${text}\n\nWrite a 2-4 sentence summary of recent activity on this deal.`,
    count,
  );
  return { action: "summarize_deal_activity", text: summary, requiresHumanReview, evidenceCount: count };
}

export async function draftFollowUpEmail(
  bankId: string,
  input: { dealId?: string; leadId?: string; recipientName?: string },
  sb: SB = supabaseAdmin(),
): Promise<AiAssistResult> {
  const filter: Record<string, string> = input.dealId ? { target_deal_id: input.dealId } : input.leadId ? { target_lead_id: input.leadId } : {};
  const { text, count } = await recentActivitiesText(bankId, filter, sb);
  const result = await aiJson<{ subject: string; body: string }>({
    scope: "intelligence.draft_follow_up_email",
    action: "generate_text",
    system:
      "You draft a short, professional follow-up email for an SBA loan broker to send to a borrower or referral contact. Only reference facts present in the activity log. This is a DRAFT for human review — never claim an action has been taken that the log doesn't show.",
    user: `Recipient: ${input.recipientName ?? "the recipient"}\nActivity log:\n${text}\n\nDraft a brief follow-up email.`,
    jsonSchemaHint: '{"subject": "string", "body": "string"}',
  });
  if (!result.ok) return { action: "draft_follow_up_email", text: "Unable to draft an email right now.", requiresHumanReview: true, evidenceCount: count };
  const body = `Subject: ${result.result?.subject ?? ""}\n\n${result.result?.body ?? ""}`;
  return { action: "draft_follow_up_email", text: body, requiresHumanReview: result.requires_human_review || count === 0, evidenceCount: count };
}

export async function explainStalledDeal(bankId: string, dealId: string, sb: SB = supabaseAdmin()): Promise<AiAssistResult> {
  const { data: dealRow } = await sb.from("deals").select("brokerage_stage, brokerage_stage_entered_at").eq("id", dealId).maybeSingle();
  const { data: tasks } = await sb.from("brokerage_tasks").select("title, status, due_at").eq("deal_id", dealId).neq("status", "completed");
  const { text: activityText, count } = await recentActivitiesText(bankId, { target_deal_id: dealId }, sb);
  const openTasksText = ((tasks ?? []) as Array<{ title: string; status: string; due_at: string | null }>)
    .map((t) => `- ${t.title} (${t.status}${t.due_at ? `, due ${t.due_at}` : ""})`)
    .join("\n");
  const stageInfo = dealRow ? `Current stage: ${(dealRow as { brokerage_stage: string }).brokerage_stage}, entered ${(dealRow as { brokerage_stage_entered_at: string }).brokerage_stage_entered_at}` : "Stage unknown";
  const { text: summary, requiresHumanReview } = await callAssist(
    "intelligence.explain_stalled",
    "You explain, in plain language, why a loan brokerage deal appears stalled, using only the stage/task/activity facts given. Do not speculate beyond the evidence.",
    `${stageInfo}\n\nOpen tasks:\n${openTasksText || "(none)"}\n\nRecent activity:\n${activityText}\n\nExplain why this deal appears stalled and what would move it forward.`,
    count,
  );
  return { action: "explain_stalled", text: summary, requiresHumanReview, evidenceCount: count };
}

export async function summarizePipelineRisk(bankId: string, alertSummaries: string[], sb: SB = supabaseAdmin()): Promise<AiAssistResult> {
  void sb;
  const { text: summary, requiresHumanReview } = await callAssist(
    "intelligence.summarize_pipeline_risk",
    "You summarize the top operational risks in a loan brokerage's pipeline from a list of already-computed alerts. Do not invent risks not in the list.",
    `Current alerts:\n${alertSummaries.map((a) => `- ${a}`).join("\n") || "(none)"}\n\nSummarize the top pipeline risks in 2-4 sentences.`,
    alertSummaries.length,
  );
  return { action: "summarize_pipeline_risk", text: summary, requiresHumanReview, evidenceCount: alertSummaries.length };
}
