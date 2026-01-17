import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { isSandboxBank } from "@/lib/tenant/sandbox";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST() {
  const auth = await enforceSuperAdmin();
  if (auth) return auth;

  try {
    const bankId = await getCurrentBankId();
    const demoBank = await isSandboxBank(bankId);
    if (!demoBank) {
      return NextResponse.json(
        { ok: false, error: "demo_only" },
        { status: 403 },
      );
    }

    const sb = supabaseAdmin();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const archivedAt = new Date().toISOString();

    const { data: archived, error } = await sb
      .from("deals")
      .update({ archived_at: archivedAt })
      .eq("bank_id", bankId)
      .eq("is_demo", true)
      .is("archived_at", null)
      .lt("created_at", cutoff)
      .select("id");

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    for (const deal of archived ?? []) {
      await writeEvent({
        dealId: deal.id,
        kind: "demo_hygiene.archive_old",
        scope: "demo_hygiene",
        action: "archive_old",
        meta: { cutoff },
      });
    }

    return NextResponse.json({ ok: true, archived: archived?.length ?? 0 });
  } catch (err: any) {
    console.error("/api/admin/demo/hygiene/archive-old", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "archive_failed" },
      { status: 500 },
    );
  }
}
