// Upload-links umbrella dispatcher.
//
// Consolidates the prior `/upload-links/list` (GET) and `/upload-links/create`
// (POST) sibling routes into this single endpoint to reduce Vercel route-
// manifest pressure (post-2026-05-06 too_many_routes incident — the project
// is pinned near the 2048 deploy-route cap; see
// specs/platform/SPEC-2026-05-vercel-route-count-reduction.md).
//
// /upload-links/revoke (POST) remains a sibling route and is intentionally
// out of scope for this consolidation — it was not part of the approved
// buffer set and has stable callers.
//
// Auth: every verb here goes through clerkAuth + ensureDealBankAccess,
// preserving the exact behavior of the prior per-verb sibling routes.
// Response shapes are byte-identical with the prior routes.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { isBorrowerUploadAllowed } from "@/lib/deals/lifecycleGuards";
import {
  hashPassword,
  makePasswordSalt,
  randomToken,
  sha256,
} from "@/lib/security/tokens";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes need headroom beyond the default
// 10s for cold-start auth + multi-step Supabase I/O. Preserved from the
// pre-consolidation /upload-links/list route.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type CreateBody = {
  expiresInHours?: number; // default 72
  singleUse?: boolean; // default true
  password?: string | null; // optional
  label?: string | null;
  uploaderNameHint?: string | null;
  uploaderEmailHint?: string | null;
};

// ── GET: list upload links (was /upload-links/list) ─────────────────────

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId)
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );

  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "unauthorized" ? 401 : 404;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const { data, error } = await supabaseAdmin()
    .from("deal_upload_links")
    .select(
      "id, deal_id, created_at, expires_at, revoked_at, single_use, used_at, require_password, label",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true, links: data ?? [] });
}

// ── POST: create upload link (was /upload-links/create) ─────────────────

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "unauthorized" ? 401 : 404;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const { data: deal } = await supabaseAdmin()
    .from("deals")
    .select("stage")
    .eq("id", dealId)
    .eq("bank_id", access.bankId)
    .maybeSingle();

  if (!isBorrowerUploadAllowed(deal?.stage ?? null)) {
    return NextResponse.json(
      { ok: false, error: "Deal intake not started" },
      { status: 403 },
    );
  }

  let body: CreateBody | null = null;
  try {
    body = (await req.json()) as CreateBody;
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

  const inferredOrigin = (() => {
    try {
      return new URL(req.url).origin;
    } catch {
      return "";
    }
  })();

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || inferredOrigin || "").replace(
    /\/$/,
    "",
  );
  const url = appUrl
    ? `${appUrl}/upload/${encodeURIComponent(token)}`
    : `/upload/${encodeURIComponent(token)}`;

  return NextResponse.json({
    ok: true,
    id: data.id,
    url,
    expiresAt,
    singleUse,
    requirePassword,
  });
}
