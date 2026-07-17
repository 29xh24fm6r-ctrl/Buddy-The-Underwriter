/**
 * Maps Buddy's internal field keys — the same keys each SBA form's build
 * and render modules already compute to fill the official reference PDF
 * (see src/lib/esign/signwell/prefillFields.ts) — to the `api_id` SignWell
 * assigns each field once it's placed in that form's Template in the
 * SignWell dashboard (Templates > [form] > field settings).
 *
 * Populate each form's map as its Template is built. A form with an empty
 * (or partially empty) map just means those fields aren't prefilled yet —
 * buildTemplateFields() silently skips any key with no mapping, so signing
 * still works exactly as it did before this feature existed; nothing here
 * can block or fail a signature request.
 */
export const SIGNWELL_FIELD_MAPS: Record<string, Record<string, string>> = {
  FORM_1919: {},
  FORM_413: {},
  FORM_912: {},
  FORM_4506C: {},
  FORM_155: {},
  FORM_159: {},
};

export function buildTemplateFields(formCode: string, values: Record<string, string>): Array<{ api_id: string; value: string }> {
  const map = SIGNWELL_FIELD_MAPS[formCode];
  if (!map) return [];

  const fields: Array<{ api_id: string; value: string }> = [];
  for (const [key, apiId] of Object.entries(map)) {
    const value = values[key];
    if (value != null && value !== "") {
      fields.push({ api_id: apiId, value });
    }
  }
  return fields;
}
