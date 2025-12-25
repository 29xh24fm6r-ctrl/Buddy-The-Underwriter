import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { autoSendTick } from "@/lib/outbound/autoSendTick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const body = await req.json().catch(() => ({}));
  const limit = Number(body?.limit ?? 25);

  const results = await autoSendTick(sb, limit);

  return NextResponse.json({ ok: true, results });
}
