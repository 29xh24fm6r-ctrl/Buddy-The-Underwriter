// src/app/api/borrower/[token]/answer/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> | { token: string } };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * POST /api/borrower/[token]/answer
 * Upsert borrower answer
 * 
 * Body: { question_key, question_section, answer_type, answer_value }
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const p = params instanceof Promise ? await params : params;
    const token = p?.token;

    if (!token) {
      return json(400, { ok: false, error: "Missing token" });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const { question_key, question_section, answer_type, answer_value } = body;

    if (!question_key || !answer_type || answer_value === undefined) {
      return json(400, { ok: false, error: "Missing required fields" });
    }

    const sb = supabaseAdmin();

    // Get application from token
    const { data: application, error: appError } = await sb
      .from("applications")
      .select("id")
      .eq("access_token", token)
      .maybeSingle();

    if (appError || !application) {
      return json(404, { ok: false, error: "Application not found" });
    }

    // Upsert answer to Supabase
    const { data: answer, error } = await sb
      .from("borrower_answers")
      .upsert(
        {
          application_id: application.id,
          question_key,
          question_section: question_section || "default",
          answer_type,
          answer_value,
          answered_at: new Date().toISOString(),
        },
        {
          onConflict: "application_id,question_key",
        }
      )
      .select()
      .single();

    if (error) {
      console.error("[borrower/answer] upsert error:", error);
      return json(500, { ok: false, error: error.message });
    }

    return json(200, { ok: true, answer });
  } catch (e: any) {
    console.error("[borrower/answer] error:", e);
    return json(500, { ok: false, error: e.message });
  }
}
