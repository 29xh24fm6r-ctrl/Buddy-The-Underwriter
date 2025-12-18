// src/app/api/borrower/[token]/load/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> | { token: string } };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * GET /api/borrower/[token]/load
 * Load application data for borrower portal
 * 
 * Returns: { application, applicants, answers, uploads }
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const p = params instanceof Promise ? await params : params;
    const token = p?.token;

    if (!token) {
      return json(400, { ok: false, error: "Missing token" });
    }

    // TODO: In production, query Supabase
    // For now, return mock data for development
    
    const mockApplication = {
      id: 'app-123',
      access_token: token,
      status: 'IN_PROGRESS',
      application_type: 'SBA_7A',
      business_name: null,
      loan_amount: null,
      sba_eligible: null,
      created_at: new Date().toISOString(),
    };

    const mockApplicants: any[] = [];
    const mockAnswers: any[] = [];
    const mockUploads: any[] = [];

    return json(200, {
      ok: true,
      application: mockApplication,
      applicants: mockApplicants,
      answers: mockAnswers,
      uploads: mockUploads,
    });
  } catch (e: any) {
    console.error('[borrower/load] error:', e);
    return json(500, { ok: false, error: e.message });
  }
}
