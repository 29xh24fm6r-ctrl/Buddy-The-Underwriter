import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/deals/[dealId]/test-status
 *
 * Returns { isTest: boolean } — used by DealShell banner (P0-7)
 * and other client components that need to know if a deal is a test
 * application.
 *
 * No auth required — is_test is not sensitive in itself; the caller
 * already has access to dealId which implies they have deal access.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("deals")
    .select("is_test")
    .eq("id", dealId)
    .maybeSingle();

  return NextResponse.json({
    isTest: (data as any)?.is_test === true,
  });
}
