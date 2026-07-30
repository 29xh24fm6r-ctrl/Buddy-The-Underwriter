// src/app/api/portal/[token]/glass-box/route.ts
// SPEC-M3 GLASS-BOX-1 — borrower readiness read.
//
// Auth: unified borrower-token resolver (resolveBorrowerToken), same as
// every other /api/portal/[token]/* route this page's client
// (PortalClient.tsx) actually calls (status, docs, checklist, activity,
// context) — NOT resolvePortalContext, which is a different resolver used
// by a separate /api/borrower/portal/[token]/* route tree.
// DB: supabaseAdmin() (no RLS user context for portal routes)

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildGlassBoxReadinessRead } from "@/lib/borrower/glassBox/buildGlassBoxReadinessRead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let dealId: string;
  try {
    const resolved = await resolveBorrowerToken(token);
    dealId = resolved.deal_id;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid or expired portal link" }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();
    const read = await buildGlassBoxReadinessRead(dealId, sb);
    return NextResponse.json({ ok: true, read });
  } catch (err) {
    console.error("[glass-box route] error:", err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
