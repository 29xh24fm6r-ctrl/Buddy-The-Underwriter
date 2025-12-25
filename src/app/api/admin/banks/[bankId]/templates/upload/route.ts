// src/app/api/admin/banks/[bankId]/templates/upload/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bankId: string }> },
) {
  try {
    const { bankId } = await ctx.params;

    if (!bankId) {
      return NextResponse.json(
        { ok: false, error: "missing_bankId" },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    // Expect JSON payload shaped roughly like:
    // {
    //   template_key: string,
    //   version: string,
    //   title?: string,
    //   pdf_form_fields?: any[],
    //   sha256?: string,
    //   mime_type?: string
    // }
    const body = await req.json().catch(() => ({}) as any);

    const template_key = String(body?.template_key ?? "");
    const version = String(body?.version ?? "v1");
    const title = String(body?.title ?? template_key ?? "Template");
    const mime_type = String(body?.mime_type ?? "application/pdf");
    const pdf_form_fields = Array.isArray(body?.pdf_form_fields)
      ? body.pdf_form_fields
      : [];
    const sha256 = String(body?.sha256 ?? "");

    if (!template_key) {
      return NextResponse.json(
        { ok: false, error: "missing_template_key" },
        { status: 400 },
      );
    }

    // 1) Upsert active template row
    const { data, error } = await sb
      .from("bank_form_templates")
      .upsert(
        {
          bank_id: bankId,
          template_key,
          version,
          title,
          mime_type,
          pdf_form_fields,
          metadata: { sha256: sha256 || null },
          is_active: true,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "bank_id,template_key,version" },
      )
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    // 2) Deactivate other versions for same template_key (THIS is where `never` hits)
    // Cast to any so update payload isn't forced to `never`.
    const { error: e2 } = await (sb.from("bank_form_templates") as any)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("bank_id", bankId)
      .eq("template_key", template_key)
      .neq("id", (data as any).id);

    if (e2) {
      return NextResponse.json(
        { ok: false, error: e2.message ?? String(e2) },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      template: data,
      parsed_fields_count: pdf_form_fields.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
