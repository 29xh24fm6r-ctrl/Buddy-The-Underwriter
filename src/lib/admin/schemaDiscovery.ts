// src/lib/admin/schemaDiscovery.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

type ColumnRow = {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
};

function scoreDocTextCandidate(table: string, col: string) {
  const t = table.toLowerCase();
  const c = col.toLowerCase();
  let s = 0;

  if (t.includes("document")) s += 6;
  if (t.includes("doc")) s += 2;
  if (t.includes("result")) s += 2;
  if (t.includes("ocr")) s += 6;
  if (t.includes("extract")) s += 5;
  if (t.includes("text")) s += 4;

  if (c.includes("text")) s += 8;
  if (c.includes("ocr")) s += 8;
  if (c.includes("content")) s += 5;
  if (c.includes("raw")) s += 2;

  // punish obvious non-text
  if (c.includes("id")) s -= 3;
  if (c.includes("json")) s -= 1;

  return s;
}

function scoreReceiptCandidate(table: string, col: string) {
  const t = table.toLowerCase();
  const c = col.toLowerCase();
  let s = 0;

  if (t.includes("receipt")) s += 10;
  if (t.includes("upload")) s += 6;
  if (t.includes("file")) s += 4;
  if (t.includes("document")) s += 3;
  if (t.includes("checklist")) s += 3;

  if (c.includes("filename")) s += 6;
  if (c.includes("file")) s += 3;
  if (c.includes("deal_id")) s += 5;
  if (c.includes("created_at")) s += 2;

  return s;
}

function scoreChecklistCandidate(table: string, col: string) {
  const t = table.toLowerCase();
  const c = col.toLowerCase();
  let s = 0;

  if (t.includes("checklist")) s += 10;
  if (t.includes("condition")) s += 4;
  if (t.includes("doc")) s += 2;

  if (c.includes("title")) s += 4;
  if (c.includes("status")) s += 4;
  if (c.includes("required")) s += 3;
  if (c.includes("deal_id")) s += 5;

  return s;
}

export async function discoverSchema() {
  const sb = supabaseAdmin();

  // Pull candidate columns across public schema
  const { data, error } = await sb
    .from("information_schema.columns")
    .select("table_schema, table_name, column_name, data_type")
    .eq("table_schema", "public")
    .limit(5000);

  if (error) throw error;

  const cols = (data ?? []) as ColumnRow[];

  // Candidates for doc text columns (text/varchar)
  const textCols = cols.filter(
    (r) =>
      ["text", "character varying", "varchar"].includes(String(r.data_type).toLowerCase()) &&
      !String(r.column_name).toLowerCase().includes("url")
  );

  const docText = textCols
    .map((r) => ({
      table: r.table_name,
      column: r.column_name,
      score: scoreDocTextCandidate(r.table_name, r.column_name),
    }))
    .filter((x) => x.score >= 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  // Receipt-ish candidates
  const receipt = cols
    .map((r) => ({
      table: r.table_name,
      column: r.column_name,
      score: scoreReceiptCandidate(r.table_name, r.column_name),
    }))
    .filter((x) => x.score >= 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  // Checklist-ish candidates
  const checklist = cols
    .map((r) => ({
      table: r.table_name,
      column: r.column_name,
      score: scoreChecklistCandidate(r.table_name, r.column_name),
    }))
    .filter((x) => x.score >= 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  return { docText, receipt, checklist };
}

export async function activateDocTextSource(params: {
  tableName: string;
  textColumn: string;
  dealIdColumn?: string | null;
  documentIdColumn?: string | null;
  labelColumn?: string | null;
  updatedAtColumn?: string | null;
}) {
  const sb = supabaseAdmin();

  // mark all inactive
  await sb.from("doc_text_sources").update({ is_active: false }).neq("id", "00000000-0000-0000-0000-000000000000");

  const { data, error } = await sb
    .from("doc_text_sources")
    .upsert(
      {
        name: params.tableName,
        table_name: params.tableName,
        deal_id_column: params.dealIdColumn ?? null,
        document_id_column: params.documentIdColumn ?? null,
        label_column: params.labelColumn ?? null,
        text_column: params.textColumn,
        updated_at_column: params.updatedAtColumn ?? null,
        is_active: true,
      },
      { onConflict: "name" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getActiveDocTextSource() {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("doc_text_sources").select("*").eq("is_active", true).maybeSingle();
  if (error) throw error;
  return data ?? null;
}
