// src/app/api/portal/upload/prepare/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";
import { rateLimit } from "@/lib/portal/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  const token = body?.token;
  const requestId = body?.requestId || null;
  const filename = body?.filename;
  const mimeType = body?.mimeType || null;

  if (!token || typeof token !== "string")
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  if (!filename || typeof filename !== "string")
    return NextResponse.json({ error: "Missing filename" }, { status: 400 });

  const rl = rateLimit(
    `portal:${token.slice(0, 12)}:upload_prepare`,
    20,
    60_000,
  );
  if (!rl.ok)
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  let invite;
  try {
    invite = await requireValidInvite(token);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Invalid/expired link" },
      { status: 401 },
    );
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `${invite.deal_id}/${Date.now()}_${safeName}`;

  const { data, error } = await sb.storage
    .from("borrower_uploads")
    .createSignedUploadUrl(path);
  if (error || !data)
    return NextResponse.json(
      { error: "Failed to create upload URL" },
      { status: 500 },
    );

  return NextResponse.json({
    bucket: "borrower_uploads",
    path,
    signedUrl: data.signedUrl,
    token: data.token,
    mimeType,
    requestId,
  });
}
