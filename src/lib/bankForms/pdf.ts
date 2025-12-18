import { PDFDocument } from "pdf-lib";

export async function listPdfFormFields(pdfBytes: Uint8Array) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  return fields.map((f) => ({
    name: f.getName(),
    type: f.constructor.name,
  }));
}

function applyTransform(value: any, transform?: string | null) {
  if (value == null) return "";
  if (!transform) return String(value);

  switch (transform) {
    case "money":
      return typeof value === "number"
        ? value.toLocaleString("en-US", { style: "currency", currency: "USD" })
        : String(value);
    case "date":
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    case "upper":
      return String(value).toUpperCase();
    case "boolean_yesno":
      return value ? "YES" : "NO";
    default:
      return String(value);
  }
}

export async function fillPdfFormFields(args: {
  pdfBytes: Uint8Array;
  fieldValues: Record<string, any>; // key = pdf field name
  transforms?: Record<string, string | null | undefined>;
  flatten?: boolean;
}) {
  const pdfDoc = await PDFDocument.load(args.pdfBytes);
  const form = pdfDoc.getForm();

  const missingFields: string[] = [];

  for (const [fieldName, rawValue] of Object.entries(args.fieldValues)) {
    let field: any = null;
    try {
      field = form.getField(fieldName);
    } catch {
      field = null;
    }

    if (!field) {
      missingFields.push(fieldName);
      continue;
    }

    const tf = args.transforms?.[fieldName];
    const v = applyTransform(rawValue, tf);

    try {
      if (typeof field.setText === "function") {
        field.setText(v);
      } else if (typeof field.check === "function") {
        const yes = String(v).toUpperCase() === "YES" || String(v) === "true";
        if (yes) field.check();
        else if (typeof field.uncheck === "function") field.uncheck();
      } else if (typeof field.select === "function") {
        field.select(v);
      } else if (typeof field.setText === "function") {
        field.setText(v);
      } else {
        missingFields.push(fieldName);
      }
    } catch {
      missingFields.push(fieldName);
    }
  }

  if (args.flatten) form.flatten();

  const out = await pdfDoc.save();
  return { pdfBytes: out, missingFields };
}
