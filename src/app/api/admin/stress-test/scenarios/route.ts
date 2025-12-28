/**
 * POST /api/admin/stress-test/scenarios
 * 
 * Creates a new stress test scenario.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  await requireSuperAdmin();

  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const body = await req.json();
  const { name, description, shock_json } = body;

  if (!name || !shock_json) {
    return NextResponse.json(
      { ok: false, error: "name and shock_json are required" },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await sb
      .from("stress_test_scenarios")
      .insert({
        bank_id: bankId,
        name,
        description: description || null,
        shock_json
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, scenario: data });
  } catch (error: any) {
    console.error("Create stress test scenario error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to create scenario" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  await requireSuperAdmin();

  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  try {
    const { data, error } = await sb
      .from("stress_test_scenarios")
      .select("*")
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ ok: true, scenarios: data });
  } catch (error: any) {
    console.error("Get stress test scenarios error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to fetch scenarios" },
      { status: 500 }
    );
  }
}
