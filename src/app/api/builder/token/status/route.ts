import "server-only";

import { NextResponse } from "next/server";
import { buildBuilderTokenStatus } from "@/lib/builder/mustBuilderToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const status = buildBuilderTokenStatus(req);
  return NextResponse.json(status, { status: 200 });
}
