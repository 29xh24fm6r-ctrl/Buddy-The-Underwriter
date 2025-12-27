import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function writeAiEvent(event: {
  deal_id: string;
  kind: string;
  scope: string;
  action: string;
  input_json?: any;
  output_json?: any;
  confidence?: number;
}) {
  const supabase = getSupabaseServerClient();

  const { error } = await supabase.from("ai_events").insert({
    deal_id: event.deal_id,
    kind: event.kind,
    scope: event.scope,
    action: event.action,
    input_json: event.input_json ?? {},
    output_json: event.output_json ?? {},
    confidence: event.confidence ?? null
  });

  if (error) throw error;
}
