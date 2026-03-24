import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isSandboxAccessAllowed } from "@/lib/tenant/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/banks/search?q=<query>
 *
 * Search all banks by name or code. Annotates each result with the
 * current user's membership status (isMember, isActive, role).
 *
 * Returns max 8 results, ordered alphabetically by name.
 */
export async function GET(req: NextRequest) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json(
      { ok: false, error: "query_too_short" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const pattern = `%${q}%`;

  // Search banks by name or code (case-insensitive partial match)
  const { data: banks, error: searchErr } = await sb
    .from("banks")
    .select("id, name, logo_url, is_sandbox")
    .or(`name.ilike.${pattern},code.ilike.${pattern}`)
    .order("name")
    .limit(8);

  if (searchErr) {
    console.error("[GET /api/banks/search] query failed:", searchErr.message);
    return NextResponse.json(
      { ok: false, error: "search_failed" },
      { status: 500 },
    );
  }

  // Filter sandbox banks
  const sandboxAllowed = await isSandboxAccessAllowed();
  const filtered = (banks ?? []).filter(
    (b: any) => (b.is_sandbox ? sandboxAllowed : true),
  );

  // Load user's memberships + active bank in parallel
  const [{ data: mems }, { data: profile }] = await Promise.all([
    sb.from("bank_memberships").select("bank_id, role").eq("clerk_user_id", userId),
    sb.from("profiles").select("bank_id").eq("clerk_user_id", userId).maybeSingle(),
  ]);

  const memMap = new Map((mems ?? []).map((m: any) => [m.bank_id, m.role]));
  const activeBankId = profile?.bank_id ?? null;

  const results = filtered.map((b: any) => ({
    id: b.id,
    name: b.name,
    logo_url: b.logo_url ?? null,
    isMember: memMap.has(b.id),
    isActive: b.id === activeBankId,
    role: memMap.get(b.id) ?? null,
  }));

  return NextResponse.json({ ok: true, results });
}
