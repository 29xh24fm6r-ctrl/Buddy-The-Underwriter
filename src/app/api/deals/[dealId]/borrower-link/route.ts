import { NextRequest, NextResponse } from "next/server";
import * as crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const dealId = parts[parts.indexOf("deals") + 1];

  const body = await req.json().catch(() => ({}));
  const label = body?.label ?? "Borrower Portal Link";
  const expiresHours = Number(body?.expires_hours ?? 72);
  const expiresAt = new Date(
    Date.now() + expiresHours * 3600 * 1000,
  ).toISOString();

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const token = makeToken();

  const { error } = await sb.from("borrower_portal_links").insert({
    deal_id: dealId,
    token,
    label,
    created_by: "system",
    expires_at: expiresAt,
  } as any);

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  // Deep link URL (front-end route)
  const link = `/borrower/${token}`;

  return NextResponse.json({
    ok: true,
    dealId,
    token,
    link,
    expires_at: expiresAt,
  });
}
