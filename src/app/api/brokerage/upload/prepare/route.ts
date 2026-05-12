import "server-only";

import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSessionFromRequest } from "@/lib/brokerage/session";

/**
 * POST /api/brokerage/upload/prepare
 *
 * Bridges the cookie-based brokerage borrower session to the existing Buddy
 * upload pipeline. Spec: SPEC-BROKERAGE-PRODUCTIONIZATION-V1 §Phase 6.
 *
 * The borrower is authenticated via the HTTP-only `buddy_borrower_session`
 * cookie (hash-compared against `borrower_session_tokens`). We mint a
 * single-use, short-lived row in `borrower_portal_links` so the borrower
 * can use the existing `/upload/[token]` page — which already drives the
 * existing OCR / classification / readiness pipeline.
 *
 * No new document table. No parallel pipeline. Just a vertical bridge.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_EXPIRES_HOURS = 24;

export async function POST(): Promise<NextResponse> {
  const session = await getBorrowerSessionFromRequest();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "no_borrower_session" },
      { status: 401 },
    );
  }

  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(
    Date.now() + DEFAULT_EXPIRES_HOURS * 3600 * 1000,
  ).toISOString();

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("borrower_portal_links")
    .insert({
      deal_id: session.deal_id,
      bank_id: session.bank_id,
      token,
      label: "Brokerage borrower upload",
      single_use: true,
      expires_at: expiresAt,
      channel: "brokerage_self_serve",
    })
    .select("token, deal_id, expires_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "create_link_failed" },
      { status: 500 },
    );
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return NextResponse.json({
    ok: true,
    dealId: data.deal_id,
    token: data.token,
    expiresAt: data.expires_at,
    uploadUrl: `${base}/upload/${data.token}`,
  });
}
