import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function randomToken() {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * POST /api/portal/create-link
 * 
 * Banker creates a portal link for borrower
 * Body: { deal_id, label?, expires_hours?, single_use?, channel?, bank_id? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      deal_id,
      label = "Borrower docs",
      expires_hours = 72,
      single_use = true,
      channel = null,
      bank_id = null,
    } = body;

    if (!deal_id) {
      return NextResponse.json({ error: "deal_id required" }, { status: 400 });
    }

    const token = randomToken();
    const expiresAt = new Date(Date.now() + expires_hours * 3600 * 1000).toISOString();

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("borrower_portal_links")
      .insert({
        deal_id,
        token,
        label,
        single_use,
        expires_at: expiresAt,
        channel,
        bank_id,
      })
      .select("token, deal_id, expires_at")
      .single();

    if (error) {
      console.error("Create link error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const portalUrl = `${appUrl}/upload/${data.token}`;

    return NextResponse.json({
      ok: true,
      token: data.token,
      deal_id: data.deal_id,
      expires_at: data.expires_at,
      portal_url: portalUrl,
    });
  } catch (error: any) {
    console.error("Create link error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to create link" },
      { status: 500 }
    );
  }
}
