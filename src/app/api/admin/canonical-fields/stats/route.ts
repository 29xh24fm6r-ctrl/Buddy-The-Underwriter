import "server-only";

import { NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CANONICAL_FIELDS } from "@/lib/bankForms/canonicalFields";

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

export async function GET() {
  try {
    await requireSuperAdmin();

    const sb = supabaseAdmin();

    const { data: maps, error } = (await (sb as any)
      .from("bank_template_field_maps")
      .select("template_id, canonical_field")) as any;

    if (error) throw error;

    const byField = new Map<
      string,
      { mappings: number; templateIds: Set<string> }
    >();

    for (const r of maps ?? []) {
      const templateId = String(r.template_id ?? "");
      const canonical = String(r.canonical_field ?? "");
      if (!canonical) continue;

      if (!byField.has(canonical)) {
        byField.set(canonical, { mappings: 0, templateIds: new Set() });
      }
      const cur = byField.get(canonical)!;
      cur.mappings += 1;
      if (templateId) cur.templateIds.add(templateId);
    }

    const stats = CANONICAL_FIELDS.map((f) => {
      const cur = byField.get(f);
      return {
        canonical_field: f,
        mapping_count: cur?.mappings ?? 0,
        template_count: cur?.templateIds.size ?? 0,
      };
    });

    const unknownCanonicalFields = Array.from(byField.keys()).filter(
      (k) => !(CANONICAL_FIELDS as readonly string[]).includes(k),
    );

    return NextResponse.json({
      ok: true,
      canonical_fields: CANONICAL_FIELDS,
      stats,
      unknown_canonical_fields: unknownCanonicalFields.sort(),
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
