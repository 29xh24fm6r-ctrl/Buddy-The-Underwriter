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

async function insertDeal(sb: ReturnType<typeof supabaseAdmin>, bankId: string, name: string) {
  const now = new Date().toISOString();
  const basePayload: Record<string, any> = {
    bank_id: bankId,
    name,
    borrower_name: name,
    stage: "intake",
    entity_type: "Unknown",
    risk_score: 0,
    is_demo: true,
    created_at: now,
    updated_at: now,
  };

  const fallbackPayload: Record<string, any> = {
    bank_id: bankId,
    name,
    borrower_name: name,
    created_at: now,
    updated_at: now,
  };

  const insertOnce = async (payload: Record<string, any>) =>
    sb.from("deals").insert(payload).select("id").single();

  let res = await insertOnce(basePayload);
  if (res.error) {
    const msg = String(res.error.message || "");
    if (msg.includes("column")) {
      res = await insertOnce(fallbackPayload);
    }
  }

  if (res.error) throw res.error;
  return res.data?.id as string | undefined;
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
    const archivedAt = new Date().toISOString();

    const { data: archived } = await sb
      .from("deals")
      .update({ archived_at: archivedAt })
      .eq("bank_id", bankId)
      .eq("is_demo", true)
      .is("archived_at", null)
      .select("id");

    for (const deal of archived ?? []) {
      await writeEvent({
        dealId: deal.id,
        kind: "demo_hygiene.reset_archive",
        scope: "demo_hygiene",
        action: "reset_archive",
      });
    }

    const seedNames = [
      "Demo – Doc Intake Test #1",
      "Demo – Borrower Upload #2",
      "Demo – Underwrite Walkthrough #3",
    ];

    const created: string[] = [];
    for (const name of seedNames) {
      const id = await insertDeal(sb, bankId, name);
      if (id) {
        created.push(id);
        await writeEvent({
          dealId: id,
          kind: "demo_hygiene.reset_seed",
          scope: "demo_hygiene",
          action: "reset_seed",
          meta: { name },
        });
      }
    }

    return NextResponse.json({ ok: true, archived: archived?.length ?? 0, seeded: created.length });
  } catch (err: any) {
    console.error("/api/admin/demo/hygiene/reset", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "reset_failed" },
      { status: 500 },
    );
  }
}
