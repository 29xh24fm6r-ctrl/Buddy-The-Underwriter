import "server-only";
import { PDFDocument } from "pdf-lib";

/**
 * PDF Fill - Mechanical PDF generation
 * Takes field values and generates filled PDF
 *
 * Purely mechanical - no business logic
 */

export type FillResult =
  | { ok: true; pdfBytes: Buffer; filledFields: string[] }
  | { ok: false; error: string; unmatchedFields?: string[]; typeMismatches?: string[] };

export async function fillPdfTemplate(
  templateBytes: Buffer,
  fieldValues: Record<string, string>,
  options: {
    flatten?: boolean;
    allowUnmatched?: boolean;
  } = {},
): Promise<FillResult> {
  try {
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    const unmatched: string[] = [];
    const typeMismatches: string[] = [];
    const filled: string[] = [];

    for (const [fieldName, value] of Object.entries(fieldValues)) {
      let field;
      try {
        field = form.getField(fieldName);
      } catch {
        unmatched.push(fieldName);
        continue;
      }

      const fieldType = field.constructor.name;
      try {
        if (fieldType === "PDFTextField") {
          form.getTextField(fieldName).setText(value);
        } else if (fieldType === "PDFCheckBox") {
          const cb = form.getCheckBox(fieldName);
          const truthy = value === "true" || value === "1" || value.toLowerCase() === "yes";
          truthy ? cb.check() : cb.uncheck();
        } else if (fieldType === "PDFDropdown") {
          form.getDropdown(fieldName).select(value);
        } else if (fieldType === "PDFSignature") {
          continue;
        } else {
          typeMismatches.push(`${fieldName}:${fieldType}`);
          continue;
        }
        filled.push(fieldName);
      } catch (err: any) {
        typeMismatches.push(`${fieldName}:${err?.message ?? "set_failed"}`);
      }
    }

    if (!options.allowUnmatched && (unmatched.length > 0 || typeMismatches.length > 0)) {
      return {
        ok: false,
        error: `unmatched_or_mismatched_fields (${unmatched.length} unmatched, ${typeMismatches.length} mismatched)`,
        unmatchedFields: unmatched,
        typeMismatches,
      };
    }

    if (options.flatten) form.flatten();
    return { ok: true, pdfBytes: Buffer.from(await pdfDoc.save()), filledFields: filled };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

/**
 * Validate that all required fields can be filled
 * Call before fillPdfTemplate to prevent partial fills
 */
export async function validateFillRequirements(
  templateBytes: Buffer,
  fieldValues: Record<string, string>,
  requiredFields: string[]
): Promise<{ ok: boolean; missing: string[]; invalid: string[] }> {
  try {
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    const missing: string[] = [];
    const invalid: string[] = [];

    for (const fieldName of requiredFields) {
      if (!fieldValues[fieldName]) {
        missing.push(fieldName);
        continue;
      }

      try {
        form.getField(fieldName);
      } catch {
        invalid.push(fieldName);
      }
    }

    return {
      ok: missing.length === 0 && invalid.length === 0,
      missing,
      invalid,
    };
  } catch (error) {
    return {
      ok: false,
      missing: requiredFields,
      invalid: [],
    };
  }
}
