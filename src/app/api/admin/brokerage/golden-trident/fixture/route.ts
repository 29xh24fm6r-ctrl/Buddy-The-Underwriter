import "server-only";

import { NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { seedGoldenTridentQaFixture } from "@/lib/brokerage/trident/goldenTridentQaFixture";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await seedGoldenTridentQaFixture({
      sb: supabaseAdmin(),
      bankId: await getBrokerageBankId(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

