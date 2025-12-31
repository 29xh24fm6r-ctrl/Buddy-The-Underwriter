/**
 * Committee Minutes Generator
 * 
 * Auto-generates regulator-grade credit committee meeting minutes
 * from decision snapshots, votes, attestations, and dissent opinions.
 * 
 * PRINCIPLE: "AI explains, humans decide"
 * - AI generates narrative from facts
 * - Humans triggered generation (not automatic)
 * - Minutes are immutable once generated
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/openai";
import crypto from "crypto";
import { fetchDealContext } from "@/lib/deals/fetchDealContext";

export interface CommitteeMinutesContext {
  snapshot: any;
  votes: any[];
  attestations: any[];
  dissent: any[];
  deal: any;
  committeeStatus: any;
}

export async function generateCommitteeMinutes(args: {
  bankId: string;
  dealId: string;
  snapshotId: string;
  generatedByUserId: string;
}): Promise<string> {
  const sb = supabaseAdmin();

  // Fetch all context needed for minutes
  const context = await fetchDealContext(args.dealId);
  if (!context.ok) {
    throw new Error(`Deal not found: ${context.error}`);
  }
  
  const [
    { data: snapshot },
    { data: votes },
    { data: attestations },
    { data: dissent }
  ] = await Promise.all([
    sb.from("decision_snapshots").select("*").eq("id", args.snapshotId).single(),
    sb.from("credit_committee_votes").select("*").eq("decision_snapshot_id", args.snapshotId),
    sb.from("decision_attestations").select("*").eq("decision_snapshot_id", args.snapshotId),
    sb.from("credit_committee_dissent").select("*").eq("decision_snapshot_id", args.snapshotId)
  ]);

  const deal = {
    id: context.dealId,
    borrower_name: context.borrower.name,
    loan_amount: null, // TODO: Add to /context if needed
    created_at: context.deal.created_at,
  };

  if (!snapshot) {
    throw new Error("Decision snapshot not found");
  }

  // Calculate integrity hash
  const snapshotHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshot, Object.keys(snapshot).sort()))
    .digest("hex");

  // Prepare context for AI
  const aiContext = {
    deal: {
      borrower_name: deal?.borrower_name,
      loan_amount: deal?.loan_amount
    },
    decision: {
      outcome: snapshot.decision,
      status: snapshot.status,
      confidence: snapshot.confidence,
      summary: snapshot.decision_summary
    },
    votes: (votes || []).map(v => ({
      voter: v.voter_name || v.voter_user_id,
      vote: v.vote,
      comment: v.comment,
      timestamp: v.created_at
    })),
    attestations: (attestations || []).map(a => ({
      attester: a.attested_by_name,
      role: a.attested_role,
      statement: a.statement,
      timestamp: a.created_at
    })),
    dissent: (dissent || []).map(d => ({
      dissenter: d.dissenter_name || d.dissenter_user_id,
      reason: d.dissent_reason,
      timestamp: d.created_at
    })),
    policy_exceptions: snapshot.exceptions_json || [],
    overrides: snapshot.overrides_json || []
  };

  // Generate minutes via AI
  const result = await aiJson({
    scope: "governance",
    action: "generate-committee-minutes",
    system: `You are a regulated banking credit committee recorder.

Generate formal credit committee meeting minutes following these requirements:

TONE: Professional, neutral, objective
FORMAT: Narrative paragraphs (not bullet points)
CONTENT REQUIREMENTS:
- Opening: Date, borrower name, loan amount
- Decision outcome and confidence level
- Summary of committee deliberation
- Individual vote tallies and key comments
- Attestation status (who signed off)
- Dissenting opinions (verbatim, if any)
- Policy exceptions discussed
- Closing: Final outcome and next steps

RULES:
- Do NOT invent facts not in the data
- Include dissent opinions word-for-word
- Use third-person narrative ("The committee reviewed...")
- Professional banking terminology
- Length: 300-500 words`,
    user: `Generate credit committee meeting minutes from the following data:

${JSON.stringify(aiContext, null, 2)}

Return ONLY the minutes text (no JSON wrapper, no markdown formatting).`,
    jsonSchemaHint: JSON.stringify({
      type: "object",
      properties: {
        minutes: { type: "string" }
      },
      required: ["minutes"]
    })
  });

  if (!result.ok) {
    throw new Error(`Minutes generation failed: ${result.error}`);
  }

  const minutesContent = result.result.minutes || "Minutes generation failed.";

  // Store minutes (immutable)
  const { error } = await sb.from("credit_committee_minutes").insert({
    bank_id: args.bankId,
    deal_id: args.dealId,
    decision_snapshot_id: args.snapshotId,
    content: minutesContent,
    generated_by_user_id: args.generatedByUserId,
    snapshot_hash: snapshotHash
  });

  if (error) {
    console.error("Failed to save committee minutes:", error);
    throw new Error("Failed to save committee minutes");
  }

  // Write audit event
  await sb.from("deal_events").insert({
    deal_id: args.dealId,
    bank_id: args.bankId,
    kind: "committee.minutes_generated",
    payload: {
      snapshot_id: args.snapshotId,
      generated_by: args.generatedByUserId,
      word_count: minutesContent.split(/\s+/).length
    }
  });

  return minutesContent;
}

/**
 * Fetch existing minutes for a snapshot (if generated)
 */
export async function getCommitteeMinutes(args: {
  snapshotId: string;
}): Promise<{ content: string; generated_at: string; snapshot_hash: string } | null> {
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("credit_committee_minutes")
    .select("content, generated_at, snapshot_hash")
    .eq("decision_snapshot_id", args.snapshotId)
    .maybeSingle();

  return data;
}
