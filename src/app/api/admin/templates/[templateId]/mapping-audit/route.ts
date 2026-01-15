import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CANONICAL_FIELDS } from "@/lib/bankForms/canonicalFields";
import { buildCanonicalValuesForDeal } from "@/lib/bankForms/canonicalValues";
import { buildPdfFieldValuesFromCanonical } from "@/lib/bankForms/map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authzError(err: any) {
  const msg = String(err?.message ?? err);
  if (msg === "unauthorized")
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  if (msg === "forbidden")
    return { status: 403, body: { ok: false, error: "forbidden" } };
  return null;
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function isNonEmptyValue(v: any): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function formatCanonicalValuePreview(v: any): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.length > 140 ? `${v.slice(0, 140)}…` : v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  try {
    const s = JSON.stringify(v);
    return s.length > 180 ? `${s.slice(0, 180)}…` : s;
  } catch {
    return String(v);
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ templateId: string }> },
) {
  try {
    await requireSuperAdmin();
    const { templateId } = await ctx.params;
    const sb = supabaseAdmin();

    const url = new URL(req.url);
    const dealId = url.searchParams.get("dealId");

    const { data: template, error: tErr } = (await (sb as any)
      .from("bank_document_templates")
      .select("*")
      .eq("id", templateId)
      .maybeSingle()) as any;

    if (tErr) throw tErr;
    if (!template) {
      return NextResponse.json({ ok: false, error: "template_not_found" }, { status: 404 });
    }

    const { data: maps, error: mErr } = (await (sb as any)
      .from("bank_template_field_maps")
      .select("id, canonical_field, pdf_field, transform, required, created_at")
      .eq("template_id", templateId)
      .order("created_at", { ascending: true })) as any;

    if (mErr) throw mErr;

    // Prefer parsed AcroForm field registry when available.
    const { data: parsedFields, error: fErr } = (await (sb as any)
      .from("bank_document_template_fields")
      .select("field_name, field_type, is_required, meta")
      .eq("template_id", templateId)
      .order("field_name", { ascending: true })) as any;

    const hasParsed = !fErr && Array.isArray(parsedFields) && parsedFields.length > 0;

    const metaFields: any[] = Array.isArray(template?.metadata?.pdf_form_fields)
      ? template.metadata.pdf_form_fields
      : [];

    const pdfFields = hasParsed
      ? (parsedFields as any[]).map((f) => ({
          name: String(f.field_name),
          type: f.field_type ?? null,
          is_required: Boolean(f.is_required ?? false),
        }))
      : metaFields.map((f) => ({
          name: String(f?.name ?? ""),
          type: f?.type ?? null,
          is_required: Boolean(f?.is_required ?? false),
        })).filter((f) => f.name);

    const pdfFieldNames = uniq(pdfFields.map((f) => f.name).filter(Boolean));
    const mappedPdfFieldNames = uniq((maps ?? []).map((r: any) => String(r.pdf_field || "")).filter(Boolean));
    const mappedCanonical = uniq((maps ?? []).map((r: any) => String(r.canonical_field || "")).filter(Boolean));

    const unmappedPdfFields = pdfFieldNames
      .filter((n) => !mappedPdfFieldNames.includes(n))
      .sort();

    const missingCanonicalFields = CANONICAL_FIELDS
      .filter((c) => !mappedCanonical.includes(c))
      .sort();

    const unknownCanonicalFields = mappedCanonical
      .filter((c) => !CANONICAL_FIELDS.includes(c as any))
      .sort();

    const requiredPdfFields = pdfFields.filter((f) => f.is_required).map((f) => f.name);
    const requiredPdfFieldsUnmapped = uniq(requiredPdfFields)
      .filter((n) => !mappedPdfFieldNames.includes(n))
      .sort();

    let fillable: any = null;
    if (dealId) {
      const { canonical } = await buildCanonicalValuesForDeal({ dealId });
      const mapped = buildPdfFieldValuesFromCanonical({
        canonicalValues: canonical,
        maps: (maps ?? []) as any,
      });

      const canonicalCoverage = (maps ?? []).map((r: any) => {
        const key = String(r.canonical_field || "");
        const value = (canonical as any)[key];
        return {
          canonical_field: key,
          has_value: isNonEmptyValue(value),
          value_preview: formatCanonicalValuePreview(value),
          pdf_field: String(r.pdf_field || ""),
          transform: r.transform ?? null,
          required: Boolean(r.required ?? false),
        };
      });

      const pdfCoverage = pdfFieldNames.map((pdfField) => {
        const v = (mapped.fieldValues as any)[pdfField];
        return {
          pdf_field: pdfField,
          is_mapped: mappedPdfFieldNames.includes(pdfField),
          will_fill_value: isNonEmptyValue(v),
          value_preview: formatCanonicalValuePreview(v),
          transform: (mapped.transforms as any)?.[pdfField] ?? null,
        };
      });

      fillable = {
        dealId,
        canonical_values_present: Object.entries(canonical).filter(([, v]) => isNonEmptyValue(v)).length,
        canonical_values_total: Object.keys(canonical).length,
        missing_canonical_for_maps: mapped.missingCanonical,
        canonicalCoverage,
        pdfCoverage,
      };
    }

    return NextResponse.json({
      ok: true,
      template: {
        id: String(template.id),
        bank_id: String(template.bank_id),
        template_key: String(template.template_key ?? ""),
        version: String(template.version ?? ""),
        name: String(template.name ?? ""),
        file_path: String(template.file_path ?? template.storage_path ?? ""),
      },
      counts: {
        pdf_fields_total: pdfFieldNames.length,
        pdf_fields_required: uniq(requiredPdfFields).length,
        pdf_fields_mapped: mappedPdfFieldNames.length,
        pdf_fields_unmapped: unmappedPdfFields.length,
        canonical_fields_total: CANONICAL_FIELDS.length,
        canonical_fields_mapped: mappedCanonical.length,
        canonical_fields_missing: missingCanonicalFields.length,
        canonical_fields_unknown_in_maps: unknownCanonicalFields.length,
      },
      pdf_fields: pdfFields,
      maps: maps ?? [],
      unmapped_pdf_fields: unmappedPdfFields,
      required_pdf_fields_unmapped: requiredPdfFieldsUnmapped,
      missing_canonical_fields: missingCanonicalFields,
      unknown_canonical_fields_in_maps: unknownCanonicalFields,
      fillable,
      notes: {
        source_pdf_fields: hasParsed
          ? "bank_document_template_fields"
          : "bank_document_templates.metadata.pdf_form_fields",
      },
    });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
