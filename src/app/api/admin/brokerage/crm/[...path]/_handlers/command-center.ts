import "server-only";

import { NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { loadRevenueOperatingSystem } from "@/lib/crm/loadRevenueOperatingSystem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, command: await loadRevenueOperatingSystem() });
  } catch (error) {
    console.error("[crm-command-center] snapshot load failed", error);
    return NextResponse.json({ ok: false, error: "Brokerage command data could not be loaded." }, { status: 500 });
  }
}
