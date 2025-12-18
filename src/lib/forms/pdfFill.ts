import "server-only";
import { PDFDocument } from "pdf-lib";

/**
 * PDF Fill - Mechanical PDF generation
 * Takes field values and generates filled PDF
 * 
 * Purely mechanical - no business logic
 */

export async function fillPdfTemplate(
  templateBytes: Buffer,
  fieldValues: Record<string, string>,
  options: {
    flatten?: boolean; // Make fields read-only
  } = {}
): Promise<{ ok: boolean; pdfBytes?: Buffer; error?: string }> {
  try {
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    // Fill each field
    for (const [fieldName, value] of Object.entries(fieldValues)) {
      try {
        const field = form.getField(fieldName);
        
        // Handle different field types
        const fieldType = field.constructor.name;
        
        if (fieldType === "PDFTextField") {
          const textField = form.getTextField(fieldName);
          textField.setText(value);
        } else if (fieldType === "PDFCheckBox") {
          const checkbox = form.getCheckBox(fieldName);
          if (value === "true" || value === "1" || value.toLowerCase() === "yes") {
            checkbox.check();
          } else {
            checkbox.uncheck();
          }
        } else if (fieldType === "PDFDropdown") {
          const dropdown = form.getDropdown(fieldName);
          dropdown.select(value);
        }
        // Add more field types as needed
      } catch (fieldError) {
        // Field doesn't exist or type mismatch - skip
        console.warn(`Failed to fill field ${fieldName}:`, fieldError);
      }
    }

    // Flatten if requested (makes fields read-only)
    if (options.flatten) {
      form.flatten();
    }

    const pdfBytes = await pdfDoc.save();
    return {
      ok: true,
      pdfBytes: Buffer.from(pdfBytes),
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message ?? String(error),
    };
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
