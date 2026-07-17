import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateToken } from "@/lib/borrower/token";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { user_id, deal_id } = body;

    if (!user_id) {
      return NextResponse.json(
        { ok: false, error: "Missing user_id" },
        { status: 400 },
      );
    }

    // Previously unauthenticated: any caller could POST an arbitrary
    // user_id/deal_id and receive back a working borrower-application
    // access token. This mints a credential granting full read/write
    // access to that application, so it needs the same bank-membership
    // check every other deal-scoped mutation route uses.
    if (!deal_id) {
      return NextResponse.json(
        { ok: false, error: "Missing deal_id" },
        { status: 400 },
      );
    }
    const access = await ensureDealBankAccess(deal_id);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: 403 },
      );
    }

    const sb = supabaseAdmin();
    const token = generateToken();

    const { data: application, error } = await sb
      .from("borrower_applications")
      .insert({
        token,
        user_id,
        deal_id,
        status: "draft",
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`create_failed: ${error.message}`);

    const url = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/borrower/${token}`;

    return NextResponse.json({
      ok: true,
      application,
      token,
      url,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "create_failed" },
      { status: 400 },
    );
  }
}
