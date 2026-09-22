import "server-only";
import { NextResponse } from "next/server";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readPackageDocumentReadiness } from "@/lib/borrower/documents/packageChecklist";

export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getBorrowerSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const result = await readPackageDocumentReadiness(session.deal_id, supabaseAdmin(), "prepare");
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
