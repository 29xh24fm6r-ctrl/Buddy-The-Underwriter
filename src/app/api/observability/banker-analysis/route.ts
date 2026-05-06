/**
 * GET /api/observability/banker-analysis
 *
 * Super-admin only. Returns aggregated banker-analysis SLA metrics for the
 * requested window (default 24h, capped at 168h / 7d).
 *
 * The route is a thin wrapper — all aggregation lives in
 * `src/lib/observability/bankerAnalysisSla.ts` and is independently tested.
 */

import "server-only";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { loadBankerAnalysisSla } from "@/lib/observability/bankerAnalysisSla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 7;

function parseWindowHours(raw: string | null): number {
  if (!raw) return DEFAULT_WINDOW_HOURS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_HOURS;
  return Math.min(Math.floor(n), MAX_WINDOW_HOURS);
}

export async function GET(req: NextRequest) {
  try {
    try {
      await requireSuperAdmin();
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg === "unauthorized") {
        return NextResponse.json(
          { ok: false, error: "unauthorized" },
          { status: 401 },
        );
      }
      if (msg === "forbidden") {
        return NextResponse.json(
          { ok: false, error: "forbidden" },
          { status: 403 },
        );
      }
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 500 },
      );
    }

    const url = new URL(req.url);
    const windowHours = parseWindowHours(url.searchParams.get("windowHours"));

    const result = await loadBankerAnalysisSla({ windowHours });
    return NextResponse.json(result);
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[observability/banker-analysis] error", err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
