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
    const { data: archived, error: selectErr } = await sb
      .from("deals")
      .select("id")
      .eq("bank_id", bankId)
      .eq("is_demo", true)
      .not("archived_at", "is", null);

    if (selectErr) {
      return NextResponse.json(
        { ok: false, error: selectErr.message },
        { status: 500 },
      );
    }

    for (const deal of archived ?? []) {
      await writeEvent({
        dealId: deal.id,
        kind: "demo_hygiene.purge_archived",
        scope: "demo_hygiene",
        action: "purge_archived",
      });
    }

    const { error: delErr } = await sb
      .from("deals")
      .delete()
      .eq("bank_id", bankId)
      .eq("is_demo", true)
      .not("archived_at", "is", null);

    if (delErr) {
      return NextResponse.json(
        { ok: false, error: delErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, purged: archived?.length ?? 0 });
  } catch (err: any) {
    console.error("/api/admin/demo/hygiene/purge-archived", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "purge_failed" },
      { status: 500 },
    );
  }
}
