import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function writeAiEvent(event: {
  deal_id: string;
  kind: string;
  scope: string;
  action: string;
  input_json?: any;
  output_json?: any;
  confidence?: number;
  requires_human_review?: boolean;
}) {
  const supabase = getSupabaseServerClient();

  const { error } = await supabase.from("ai_events").insert({
    deal_id: event.deal_id,
    kind: event.kind,
    scope: event.scope,
    action: event.action,
    input_json: event.input_json ?? {},
    output_json: event.output_json ?? {},
    confidence: event.confidence ?? null,
    requires_human_review: event.requires_human_review ?? false
  });

  if (error) throw new Error(error.message);
}
