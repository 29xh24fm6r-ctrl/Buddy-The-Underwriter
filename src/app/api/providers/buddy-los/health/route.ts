import { NextResponse } from "next/server";
import { ENGINE_VERSION, readProviderAdmission } from "@/lib/buddyLosProvider/contract";

export const dynamic = "force-dynamic";

export function GET() {
  const admission = readProviderAdmission();
  return NextResponse.json(
    { ready: admission.enabled, engineVersion: ENGINE_VERSION },
    { status: admission.enabled ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
