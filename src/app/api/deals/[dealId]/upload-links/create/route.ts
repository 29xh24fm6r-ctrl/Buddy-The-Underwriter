// src/app/api/deals/[dealId]/upload-links/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  hashPassword,
  makePasswordSalt,
  randomToken,
  sha256,
} from "@/lib/security/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  expiresInHours?: number; // default 72
  singleUse?: boolean; // default true
  password?: string | null; // optional
  label?: string | null;
  uploaderNameHint?: string | null;
  uploaderEmailHint?: string | null;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  let body: Body | null = null;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const expiresInHours = Math.max(
    1,
    Math.min(24 * 30, body?.expiresInHours ?? 72),
  );
  const singleUse = body?.singleUse ?? true;
  const label = body?.label ?? null;

  const token = randomToken(32);
  const tokenHash = sha256(token);

  const expiresAt = new Date(
    Date.now() + expiresInHours * 3600 * 1000,
  ).toISOString();

  const password = (body?.password || "").trim();
  const requirePassword = !!password;

  let passwordSalt: string | null = null;
  let passwordHash: string | null = null;

  if (requirePassword) {
    passwordSalt = makePasswordSalt();
    passwordHash = hashPassword(password, passwordSalt);
  }

  const { data, error } = await supabaseAdmin()
    .from("deal_upload_links")
    .insert({
      deal_id: dealId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      single_use: singleUse,
      require_password: requirePassword,
      password_salt: passwordSalt,
      password_hash: passwordHash,
      label,
      uploader_name_hint: body?.uploaderNameHint ?? null,
      uploader_email_hint: body?.uploaderEmailHint ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: "Failed to create link." },
      { status: 500 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const url = `${appUrl.replace(/\/$/, "")}/upload/${encodeURIComponent(token)}`;

  return NextResponse.json({
    ok: true,
    id: data.id,
    url,
    expiresAt,
    singleUse,
    requirePassword,
  });
}
