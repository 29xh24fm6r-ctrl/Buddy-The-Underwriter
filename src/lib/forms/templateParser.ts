import "server-only";
import { PDFDocument } from "pdf-lib";

/**
 * Parse PDF template fields (AcroForm)
 * Deterministic - no AI involved
 * 
 * Returns array of field definitions for storage in bank_document_template_fields
 */
export async function parseTemplateFields(pdfBytes: Buffer) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    const parsed = fields.map((field) => {
      const name = field.getName();
      const fieldType = field.constructor.name; // TextField, CheckBox, etc.
      
      // Extract metadata
      const meta: Record<string, any> = {};
      
      try {
        // Check if required (some PDFs mark this)
        const acroField = field.acroField;
        if (acroField) {
          const flags = acroField.getFlags();
          meta.flags = flags ?? null;
        }
      } catch {
        // Not all fields have flags
      }

      // Determine if likely required based on field name patterns
      const isRequired = /required|mandatory|\*/.test(name.toLowerCase());

      return {
        field_name: name,
        field_type: fieldType,
        is_required: isRequired,
        meta,
      };
    });

    return {
      ok: true,
      fields: parsed,
      total: parsed.length,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message ?? String(error),
      fields: [],
      total: 0,
    };
  }
}

/**
 * Store parsed fields in database
 * Idempotent - safe to call multiple times for same template
 */
export async function storeTemplateFields(
  supabase: any,
  templateId: string,
  fields: Array<{
    field_name: string;
    field_type: string;
    is_required: boolean;
    meta: Record<string, any>;
  }>
) {
  // Delete existing fields for this template
  await supabase
    .from("bank_document_template_fields")
    .delete()
    .eq("template_id", templateId);

  // Insert new fields
  const rows = fields.map((f) => ({
    template_id: templateId,
    field_name: f.field_name,
    field_type: f.field_type,
    is_required: f.is_required,
    meta: f.meta,
  }));

  const { error } = await supabase
    .from("bank_document_template_fields")
    .insert(rows);

  if (error) throw error;

  return { ok: true, stored: rows.length };
}
