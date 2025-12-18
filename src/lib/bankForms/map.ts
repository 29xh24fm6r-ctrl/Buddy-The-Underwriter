import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getActiveTemplate(bankId: string, template_key: string) {
  const { data, error } = await supabaseAdmin()
    .from("bank_document_templates")
    .select("*")
    .eq("bank_id", bankId)
    .eq("template_key", template_key)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle() as any;

  if (error) throw error;
  return data ?? null;
}

export async function getTemplateMaps(templateId: string) {
  const { data, error } = await supabaseAdmin()
    .from("bank_template_field_maps")
    .select("*")
    .eq("template_id", templateId) as any;

  if (error) throw error;
  return data ?? [];
}

export function buildPdfFieldValuesFromCanonical(args: {
  canonicalValues: Record<string, any>;
  maps: Array<{ canonical_field: string; pdf_field: string; transform?: string | null }>;
}) {
  const fieldValues: Record<string, any> = {};
  const transforms: Record<string, string | null> = {};
  const missingCanonical: string[] = [];

  for (const m of args.maps) {
    if (!(m.canonical_field in args.canonicalValues)) {
      missingCanonical.push(m.canonical_field);
      continue;
    }
    fieldValues[m.pdf_field] = args.canonicalValues[m.canonical_field];
    transforms[m.pdf_field] = m.transform ?? null;
  }

  return { fieldValues, transforms, missingCanonical };
}
