import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();

    if (!q) {
      return NextResponse.json({ ok: true, borrowers: [] });
    }

    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();
    const like = `%${q.replace(/%/g, "").replace(/_/g, "")}%`;

    const { data, error } = await sb
      .from("borrowers")
      .select("id, legal_name, entity_type, ein, primary_contact_name, primary_contact_email")
      .eq("bank_id", bankId)
      .or(
        `legal_name.ilike.${like},ein.ilike.${like},primary_contact_email.ilike.${like}`,
      )
      .order("legal_name", { ascending: true })
      .limit(50);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, borrowers: data ?? [] });
  } catch (error: any) {
    console.error("[/api/borrowers/search]", error);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
