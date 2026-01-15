// src/app/api/admin/banks/[bankId]/templates/upload/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { PDFDocument } from "pdf-lib";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "bank-templates";

function safeExt(name: string) {
  const ext = (name.split(".").pop() || "pdf").toLowerCase();
  const cleaned = ext.replace(/[^a-z0-9]/g, "").slice(0, 8);
  return cleaned || "pdf";
}

function sha256Hex(bytes: Uint8Array) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function parsePdfFormFields(bytes: Uint8Array): Promise<Array<{ name: string; type: string | null }>> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const form = pdf.getForm();
    const fields = form.getFields();

    const parsed = fields
      .map((f: any) => {
        const name = typeof f?.getName === "function" ? String(f.getName()) : "";
        const rawType = f?.constructor?.name ? String(f.constructor.name) : "";
        const type = rawType ? rawType.replace(/^PDF/, "").toLowerCase() : null;
        return { name, type };
      })
      .filter((f) => Boolean(f.name));

    // De-dupe while preserving order.
    const seen = new Set<string>();
    const uniq: Array<{ name: string; type: string | null }> = [];
    for (const f of parsed) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      uniq.push(f);
    }
    return uniq;
  } catch {
    return [];
  }
}

async function enforceSuperAdmin() {
  try {
    await requireSuperAdmin();
    return null;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "unauthorized")
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    if (msg === "forbidden")
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bankId: string }> },
) {
  try {
    const auth = await enforceSuperAdmin();
    if (auth) return auth;

    const { bankId } = await ctx.params;

    if (!bankId) {
      return NextResponse.json(
        { ok: false, error: "missing_bankId" },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    const form = await req.formData();
    const template_key = String(form.get("template_key") ?? "").trim();
    const version = String(form.get("version") ?? "v1").trim() || "v1";
    const name = String(form.get("name") ?? "").trim() || template_key || "Template";
    const file = form.get("file");

    if (!template_key) {
      return NextResponse.json(
        { ok: false, error: "missing_template_key" },
        { status: 400 },
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "missing_file" },
        { status: 400 },
      );
    }

    const mime_type = file.type || "application/pdf";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = sha256Hex(bytes);
    const pdf_form_fields = await parsePdfFormFields(bytes);

    const ext = safeExt(file.name);
    const objectId = crypto.randomUUID();
    const file_path = `${bankId}/${template_key}/${version}/${objectId}.${ext}`;

    const up = await sb.storage.from(BUCKET).upload(file_path, bytes, {
      contentType: mime_type,
      upsert: false,
    });

    if (up.error) {
      return NextResponse.json(
        { ok: false, error: "storage_upload_failed", detail: up.error.message },
        { status: 500 },
      );
    }

    // 1) Upsert template row
    const { data: templateRow, error: e1 } = await (sb as any)
      .from("bank_document_templates")
      .upsert(
        {
          bank_id: bankId,
          template_key,
          version,
          name,
          file_path,
          metadata: {
            ...(typeof (form.get("metadata") as any) === "object" ? (form.get("metadata") as any) : {}),
            sha256,
            mime_type,
            pdf_form_fields,
          },
          is_active: true,
        },
        { onConflict: "bank_id,template_key,version" },
      )
      .select("*")
      .single();

    if (e1) {
      // best-effort cleanup
      try {
        await sb.storage.from(BUCKET).remove([file_path]);
      } catch {}
      return NextResponse.json({ ok: false, error: e1.message }, { status: 500 });
    }

    // 2) Deactivate other versions
    const { error: e2 } = await (sb as any)
      .from("bank_document_templates")
      .update({ is_active: false })
      .eq("bank_id", bankId)
      .eq("template_key", template_key)
      .neq("id", templateRow.id);

    if (e2) {
      return NextResponse.json(
        { ok: false, error: e2.message ?? String(e2) },
        { status: 500 },
      );
    }

    // 3) Refresh parsed field registry (used by /forms/prepare)
    // Best effort: if this fails we still return ok=true because the template upload itself succeeded.
    try {
      await (sb as any)
        .from("bank_document_template_fields")
        .delete()
        .eq("template_id", templateRow.id);

      if (pdf_form_fields.length > 0) {
        await (sb as any).from("bank_document_template_fields").insert(
          pdf_form_fields.map((f) => ({
            template_id: templateRow.id,
            field_name: f.name,
            field_type: f.type,
            is_required: false,
            meta: {},
          })),
        );
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      template: templateRow,
      parsed_fields_count: pdf_form_fields.length,
      bucket: BUCKET,
      file_path,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
