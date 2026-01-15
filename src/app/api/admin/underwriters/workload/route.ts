// src/app/api/admin/underwriters/workload/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function enforceSuperAdmin() {
  try {
    await requireSuperAdmin();
    return null;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "unauthorized")
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    if (msg === "forbidden")
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

type WorkloadRow = {
  clerk_user_id: string;
  deal_count: number;
  active_deal_count: number;
  stalled_deal_count: number;
  last_participant_touch_at: string | null;
};

function toStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x == null ? "" : String(x)))
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await enforceSuperAdmin();
    if (auth) return auth;

    const sb = supabaseAdmin();

    const url = new URL(req.url);
    const days = Math.max(
      1,
      Math.min(90, Number(url.searchParams.get("days") ?? 14)),
    );
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    /**
     * 1) Pull assignments: which underwriter is assigned to which deal
     * We cast to `any` to avoid Supabase-generated `never` typing landmines.
     */
    const { data: assignments, error: aErr } = await (sb as any)
      .from("deal_underwriter_assignments")
      .select(
        "deal_id, underwriter_id, underwriter_clerk_id, clerk_user_id, user_id",
      )
      .limit(10000);

    if (aErr) throw aErr;

    // Build dealsByUw: Map<clerk_user_id, string[] of deal_ids>
    const dealsByUw = new Map<string, string[]>();

    for (const r of (assignments ?? []) as any[]) {
      const dealId = r?.deal_id ? String(r.deal_id) : "";
      const uw =
        r?.underwriter_clerk_id ??
        r?.clerk_user_id ??
        r?.underwriter_id ??
        r?.user_id ??
        "";
      const uwId = uw ? String(uw) : "";

      if (!uwId || !dealId) continue;

      const arr = dealsByUw.get(uwId) ?? [];
      arr.push(dealId);
      dealsByUw.set(uwId, arr);
    }

    // ✅ THIS is the critical fix: enforce string[]
    const underwriterIds: string[] = Array.from(dealsByUw.keys()).map(String);

    /**
     * 2) Determine which of these deals are "active"
     * If your deals table uses a different active flag, adjust the filter here later.
     */
    const allDealIds = Array.from(
      new Set(
        Array.from(dealsByUw.values())
          .flat()
          .map((x) => String(x)),
      ),
    );

    const activeDealSet = new Set<string>();

    if (allDealIds.length > 0) {
      const { data: deals, error: dErr } = await (sb as any)
        .from("deals")
        .select("id, status")
        .in("id", allDealIds);

      if (dErr) throw dErr;

      for (const d of (deals ?? []) as any[]) {
        const id = d?.id ? String(d.id) : "";
        const status = d?.status ? String(d.status) : "";
        if (!id) continue;

        // Treat anything not explicitly "closed" as active (adjust later if needed)
        if (status && status.toLowerCase() !== "closed") activeDealSet.add(id);
      }
    }

    /**
     * 3) Borrower activity proxy:
     * attachments created in last N days grouped by deal (application_id)
     */
    const { data: recentAtt, error: attErr } = await (sb as any)
      .from("borrower_attachments")
      .select("application_id, created_at")
      .gte("created_at", since)
      .limit(10000);

    if (attErr) throw attErr;

    // latestTouchByDeal: Map<deal_id, latest created_at>
    const latestTouchByDeal = new Map<string, string>();

    for (const a of (recentAtt ?? []) as any[]) {
      const dealId = a?.application_id ? String(a.application_id) : "";
      const createdAt = a?.created_at ? String(a.created_at) : "";
      if (!dealId || !createdAt) continue;

      const prev = latestTouchByDeal.get(dealId);
      if (!prev || createdAt > prev) latestTouchByDeal.set(dealId, createdAt);
    }

    // lastTouchByUw: Map<uwId, latestTouchAcrossAssignedDeals>
    const lastTouchByUw = new Map<string, string>();

    for (const uwId of underwriterIds) {
      const deals = dealsByUw.get(uwId) ?? [];
      let best: string | null = null;

      for (const dealId of deals) {
        const t = latestTouchByDeal.get(String(dealId));
        if (t && (!best || t > best)) best = t;
      }

      if (best) lastTouchByUw.set(uwId, best);
    }

    /**
     * 4) Compute "stalled" vs "active" counts
     * stalled = assigned deals that are NOT in activeDealSet (simple proxy)
     */
    const rows: WorkloadRow[] = underwriterIds.map((uwId) => {
      const deals = toStringArray(dealsByUw.get(uwId) ?? []);
      const uniqueDeals = Array.from(new Set(deals));

      const activeDeals = uniqueDeals.filter((d) =>
        activeDealSet.has(String(d)),
      );
      const stalledDeals = uniqueDeals.filter(
        (d) => !activeDealSet.has(String(d)),
      );

      return {
        clerk_user_id: String(uwId),
        deal_count: uniqueDeals.length,
        active_deal_count: activeDeals.length,
        stalled_deal_count: stalledDeals.length,
        last_participant_touch_at: lastTouchByUw.get(String(uwId)) ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      since,
      days,
      rows,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
