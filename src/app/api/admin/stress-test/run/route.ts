/**
 * POST /api/admin/stress-test/run
 * 
 * Runs a stress test scenario against historical decisions.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { runStressTest } from "@/lib/macro/runStressTest";

export async function POST(req: NextRequest) {
  await requireSuperAdmin();

  const body = await req.json();
  const { scenarioId } = body;

  if (!scenarioId) {
    return NextResponse.json(
      { ok: false, error: "scenarioId is required" },
      { status: 400 }
    );
  }

  try {
    const result = await runStressTest(scenarioId);

    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("Stress test error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to run stress test" },
      { status: 500 }
    );
  }
}
