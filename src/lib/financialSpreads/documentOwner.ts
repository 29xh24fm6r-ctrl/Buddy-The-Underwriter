import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeEntityName } from "../ownership/sanitizeEntityName";

/** Keep name captures on one OCR line so the next field cannot become an owner. */
export function extractTaxpayerName(ocrText: string): string | null {
  const patterns = [
    /your[ \t]+first[ \t]+name[^\r\n]*?last[ \t]+name[^\r\n]*\r?\n([A-Z][a-z]+(?:[ \t]+[A-Z]\.?)?[ \t]+[A-Z][a-z]+)/i,
    /^([A-Z][A-Za-z]+(?:[ \t]+[A-Z]\.?)?[ \t]+[A-Z][A-Za-z]+)[ \t]+\d{3}-\d{2}-\d{4}/m,
    /taxpayer[ \t]+name[ \t]*:?[ \t]*(?:\r?\n[ \t]*)?([A-Z][A-Za-z]+(?:[ \t]+[A-Z][A-Za-z]+)+)/i,
  ];
  for (const pattern of patterns) {
    const name = sanitizeEntityName(ocrText.match(pattern)?.[1]);
    if (name) return name;
  }
  return null;
}

function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Reuse an unambiguous existing owner before inserting an OCR-derived name. */
export async function ensureOwnerEntity(
  sb: SupabaseClient,
  dealId: string,
  displayName: string,
  entityType: "individual" | "entity" = "individual",
): Promise<string | null> {
  const cleanName = sanitizeEntityName(displayName);
  if (!cleanName) return null;
  try {
    const { data: owners, error } = await sb
      .from("ownership_entities")
      .select("id, display_name")
      .eq("deal_id", dealId)
      .eq("entity_type", entityType);
    // A failed read must never be interpreted as a missing owner.
    if (error || !owners) return null;
    // Do not sanitize stored identities or choose among same-name people.
    // Existing corrupt/duplicate records need explicit reconciliation.
    const matches = owners.filter((owner) =>
      typeof owner.display_name === "string" &&
      nameKey(owner.display_name) === nameKey(cleanName),
    );
    if (matches.length > 1) return null;
    if (matches.length === 1) return String(matches[0].id);

    const { data: created, error: insertError } = await sb
      .from("ownership_entities")
      .insert({ deal_id: dealId, display_name: cleanName, entity_type: entityType })
      .select("id")
      .maybeSingle();
    return !insertError && created?.id ? String(created.id) : null;
  } catch {
    return null;
  }
}
