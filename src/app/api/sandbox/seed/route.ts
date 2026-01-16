import "server-only";

import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sampleDeals } from "@/lib/deals/sampleDeals";
import { ensureSandboxMembership, isSandboxAccessAllowed } from "@/lib/tenant/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function insertDeal(sb: ReturnType<typeof supabaseAdmin>, bankId: string, name: string) {
  const now = new Date().toISOString();
  const basePayload: Record<string, any> = {
    bank_id: bankId,
    name,
    borrower_name: name,
    stage: "intake",
    entity_type: "Unknown",
    risk_score: 0,
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
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const allowed = await isSandboxAccessAllowed();
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "sandbox_forbidden" },
      { status: 403 },
    );
  }

  const sandbox = await ensureSandboxMembership(userId);
  if (!sandbox.ok || !sandbox.bankId) {
    return NextResponse.json(
      { ok: false, error: "sandbox_forbidden" },
      { status: 403 },
    );
  }

  const sb = supabaseAdmin();
  const bankId = sandbox.bankId;
  const dealNames = sampleDeals.map((d) => d.name).filter(Boolean).slice(0, 6);

  const results: Array<{ id: string; name: string; status: "created" | "existing" }> = [];

  for (const name of dealNames) {
    const existing = await sb
      .from("deals")
      .select("id")
      .eq("bank_id", bankId)
      .eq("name", name)
      .maybeSingle();

    if (existing.data?.id) {
      results.push({ id: existing.data.id, name, status: "existing" });
      continue;
    }

    const id = await insertDeal(sb, bankId, name);
    if (id) results.push({ id, name, status: "created" });
  }

  return NextResponse.json({ ok: true, bank_id: bankId, deals: results });
}
