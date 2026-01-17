import "server-only";

import { NextResponse } from "next/server";
import { clerkAuth, clerkCurrentUser } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sampleDeals } from "@/lib/deals/sampleDeals";
import { ensureSandboxMembership, isSandboxAccessAllowed } from "@/lib/tenant/sandbox";
import { logDemoUsageEvent } from "@/lib/tenant/demoTelemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function insertDeal(
  sb: ReturnType<typeof supabaseAdmin>,
  bankId: string,
  name: string,
  isDemo: boolean,
) {
  const now = new Date().toISOString();
  const basePayload: Record<string, any> = {
    bank_id: bankId,
    name,
    borrower_name: name,
    stage: "intake",
    entity_type: "Unknown",
    risk_score: 0,
    is_demo: isDemo,
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
  const dealNames = sampleDeals
    .map((d, idx) => d.name || `Doc Intake Test #${idx + 1}`)
    .filter(Boolean)
    .slice(0, 6)
    .map((name, idx) => `Demo – ${name} #${idx + 1}`);

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

    const id = await insertDeal(sb, bankId, name, true);
    if (id) results.push({ id, name, status: "created" });
  }

  const user = await clerkCurrentUser();
  const email =
    user?.emailAddresses?.find((e) => e.id === user.primaryEmailAddressId)
      ?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;

  await logDemoUsageEvent({
    email,
    bankId,
    path: "/api/sandbox/seed",
    eventType: "action",
    label: "seed_demo_deals",
    meta: { count: results.length },
  });

  return NextResponse.json({ ok: true, bank_id: bankId, deals: results });
}
