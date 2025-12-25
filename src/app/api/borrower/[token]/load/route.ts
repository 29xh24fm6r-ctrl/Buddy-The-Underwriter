// src/app/api/borrower/[token]/load/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * GET /api/borrower/[token]/load
 * Load application data for borrower portal
 *
 * Returns: { application, applicants, answers, uploads }
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const p = await ctx.params;
    const token = p?.token;
    if (!token) {
      return json(400, { ok: false, error: "Missing token" });
    }

    const sb = supabaseAdmin();

    // Query real data from Supabase
    const { data: application, error: appError } = await sb
      .from("applications")
      .select("*")
      .eq("access_token", token)
      .maybeSingle();

    if (appError) {
      console.error("[borrower/load] application query error:", appError);
      return json(500, { ok: false, error: appError.message });
    }

    if (!application) {
      return json(404, { ok: false, error: "Application not found" });
    }

    // Load related data
    const { data: applicants } = await sb
      .from("applicants")
      .select("*")
      .eq("application_id", application.id);

    const { data: answers } = await sb
      .from("borrower_answers")
      .select("*")
      .eq("application_id", application.id);

    const { data: uploads } = await sb
      .from("borrower_uploads")
      .select("*")
      .eq("application_id", application.id);

    return json(200, {
      ok: true,
      application,
      applicants: applicants || [],
      answers: answers || [],
      uploads: uploads || [],
    });
  } catch (e: any) {
    console.error("[borrower/load] error:", e);
    return json(500, { ok: false, error: e.message });
  }
}
