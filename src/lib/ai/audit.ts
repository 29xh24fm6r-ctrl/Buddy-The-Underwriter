// src/lib/ai/audit.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function recordAiEvent(args: {
  deal_id?: string | null;
  actor_user_id?: string | null;
  scope: string;
  action: string;
  input_json?: any;
  output_json?: any;
  confidence?: number | null;
  evidence_json?: any;
  requires_human_review?: boolean;
}) {
  const sb = supabaseAdmin();
  const ins = await sb.from("ai_events").insert({
    deal_id: args.deal_id ?? null,
    actor_user_id: args.actor_user_id ?? null,
    scope: args.scope,
    action: args.action,
    input_json: args.input_json ?? null,
    output_json: args.output_json ?? null,
    confidence: args.confidence ?? null,
    evidence_json: args.evidence_json ?? null,
    requires_human_review: args.requires_human_review ?? true,
  });
  if (ins.error) throw ins.error;
}
