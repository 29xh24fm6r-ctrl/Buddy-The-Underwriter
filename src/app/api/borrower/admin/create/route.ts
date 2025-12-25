import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateToken } from "@/lib/borrower/token";

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

    const sb = supabaseAdmin();
    const token = generateToken();

    const { data: application, error } = await sb
      .from("borrower_applications")
      .insert({
        token,
        user_id,
        deal_id: deal_id || null,
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
