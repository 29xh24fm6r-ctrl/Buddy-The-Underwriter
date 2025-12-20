// src/lib/deals/etaTemplates.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export type EtaNoteTemplate = {
  id: string;
  label: string;
  note: string;
  created_at: string;
  created_by: string | null;
};

export async function listEtaNoteTemplates(): Promise<EtaNoteTemplate[]> {
  const sb = supabaseAdmin();

  // We treat NULL created_by as "global defaults"
  const { data, error } = await sb
    .from("deal_eta_note_templates")
    .select("id, label, note, created_at, created_by")
    .order("created_by", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as EtaNoteTemplate[];
}

export async function createEtaNoteTemplate(input: {
  label: string;
  note: string;
  createdBy?: string | null;
}): Promise<EtaNoteTemplate> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_eta_note_templates")
    .insert({
      label: input.label,
      note: input.note,
      created_by: input.createdBy ?? null,
    })
    .select("id, label, note, created_at, created_by")
    .single();

  if (error) throw error;
  return data as EtaNoteTemplate;
}
