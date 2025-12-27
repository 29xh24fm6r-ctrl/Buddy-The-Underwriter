import { getSupabaseServerClient } from "@/lib/supabase/server";

export type AiEventInsert = {
  deal_id?: string | null;
  bank_id?: string | null;
  kind: string; // "committee.answer" | "memo.section" | "policy.query" etc
  model?: string | null;
  input?: any;
  output?: any;
  meta?: any;
};

export async function insertAiEvent(e: AiEventInsert) {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("ai_events")
    .insert({
      deal_id: e.deal_id ?? null,
      bank_id: e.bank_id ?? null,
      kind: e.kind,
      model: e.model ?? null,
      input: e.input ?? null,
      output: e.output ?? null,
      meta: e.meta ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function insertAiCitations(rows: Array<{
  ai_event_id: string;
  deal_id?: string | null;
  bank_id?: string | null;
  source_kind: "deal_doc_chunk" | "bank_policy_chunk";
  chunk_id: string;
  upload_id?: string | null;
  chunk_index?: number | null;
  page_start?: number | null;
  page_end?: number | null;
  document_id?: string | null;
  page_number?: number | null;
  bbox?: any | null;
  excerpt: string;
  similarity?: number | null;
}>) {
  if (!rows.length) return;
  const sb = getSupabaseServerClient();
  const { error } = await sb.from("ai_run_citations").insert(rows);
  if (error) throw error;
}
