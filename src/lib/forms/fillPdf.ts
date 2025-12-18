import type { FormDefinition } from "./registry";

export function mapPdfFields(payload: any, form: any) {
  const out: Record<string, string> = {};
  for (const f of form.fields) {
    let v = f.path.split(".").reduce((o: any, k: string) => o?.[k], payload);
    if (f.transform === "YES_NO") v = v ? "Yes" : "No";
    if (f.transform === "CURRENCY" && typeof v === "number")
      v = `$${v.toLocaleString()}`;
    out[f.pdf] = v ?? "";
  }
  return out;
}

// Legacy function for backwards compatibility
export function fillPdfFields(payload: any, form: FormDefinition) {
  const filled: Record<string, string> = {};

  for (const f of form.fields) {
    let value = f.path.split(".").reduce((o, k) => o?.[k], payload);

    if (f.transform === "YES_NO") {
      value = value === true ? "Yes" : value === false ? "No" : "";
    }

    if (f.transform === "CURRENCY" && typeof value === "number") {
      value = `$${value.toLocaleString()}`;
    }

    if (f.transform === "DATE" && value) {
      const d = new Date(value);
      value = d.toLocaleDateString();
    }

    filled[f.pdf_field] = value ?? "";
  }

  return filled;
}
