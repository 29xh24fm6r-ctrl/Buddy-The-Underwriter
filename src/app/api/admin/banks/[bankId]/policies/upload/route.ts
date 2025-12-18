// src/app/api/admin/banks/[bankId]/policies/upload/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ bankId: string }> }) {
  try {
    const { bankId } = await ctx.params;

    if (!bankId) {
      return NextResponse.json({ ok: false, error: "missing_bankId" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const body = await req.json().catch(() => ({} as any));

    const name = String(body?.name ?? "Policy");
    const version = String(body?.version ?? "v1");
    const mime_type = String(body?.mime_type ?? "text/plain");
    const extracted_text = String(body?.extracted_text ?? "");
    const sha256 = String(body?.sha256 ?? "");

    // 1) Upsert the new policy as active
    const { data, error } = await sb
      .from("bank_policies")
      .upsert(
        {
          bank_id: bankId,
          name,
          version,
          mime_type,
          extracted_text: extracted_text || null,
          metadata: { sha256: sha256 || null },
          is_active: true,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "bank_id,version" }
      )
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // 2) Deactivate all other policies for the bank (avoid `never` update payload typing)
    const { error: e2 } = await (sb.from("bank_policies") as any)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("bank_id", bankId)
      .neq("id", (data as any).id);

    if (e2) {
      return NextResponse.json({ ok: false, error: e2.message ?? String(e2) }, { status: 500 });
    }

    return NextResponse.json({ ok: true, policy: data });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
