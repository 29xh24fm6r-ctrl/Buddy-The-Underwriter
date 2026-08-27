import { NextRequest, NextResponse } from "next/server";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const p = await ctx.params;
    const dealId = p?.dealId;

    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "Missing dealId" },
        { status: 400 },
      );
    }

    // Fail closed before reading any deal-scoped filesystem metadata.
    try {
      await assertDealAccess(dealId);
    } catch (error) {
      const accessResponse = accessErrorToResponse(error);
      if (accessResponse) return accessResponse;
      return NextResponse.json(
        { ok: false, error: "access_check_failed" },
        { status: 500 },
      );
    }

    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const dir = path.join("/tmp/buddy_uploads", dealId);

    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      names = [];
    }

    const files = await Promise.all(
      names.map(async (name) => {
        const full = path.join(dir, name);
        const st = await fs.stat(full);
        return {
          stored_name: name,
          size: st.size,
          uploaded_at: st.mtime.toISOString(),
        };
      }),
    );

    files.sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));

    return NextResponse.json({ ok: true, deal_id: dealId, files });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 },
    );
  }
}
