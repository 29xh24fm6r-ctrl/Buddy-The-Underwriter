// src/app/api/borrower/[token]/answer/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

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

    // TODO: In production, upsert to Supabase borrower_answers table
    // For now, log and return success
    
    console.log('[borrower/answer] Upsert:', {
      token,
      question_key,
      answer_value,
    });

    return json(200, {
      ok: true,
      answer: {
        question_key,
        question_section,
        answer_type,
        answer_value,
        answered_at: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    console.error('[borrower/answer] error:', e);
    return json(500, { ok: false, error: e.message });
  }
}
