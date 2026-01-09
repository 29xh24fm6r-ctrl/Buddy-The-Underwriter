// src/app/api/deals/[dealId]/pipeline/latest/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ]);
}

const VERCEL_ENV = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
const VERCEL_SHA = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
const VERSION_MARKER = `pipeline-latest-${VERCEL_ENV}${VERCEL_SHA ? `-${VERCEL_SHA}` : ""}`;

function maskId(id: string | null | undefined) {
  const s = String(id ?? "");
  if (!s) return null;
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/pipeline/latest
 * 
 * Returns latest pipeline state from canonical ledger.
 * UI uses this to determine what to render.
 */
export async function GET(req: Request, ctx: Ctx) {
  let wantDebug = false;
  try {
    const { dealId } = await ctx.params;
    const url = new URL(req.url);
    wantDebug = url.searchParams.get("debug") === "1";

    const { userId } = await withTimeout(clerkAuth(), 8_000, "clerkAuth");
    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          __version: VERSION_MARKER,
          error: "Unauthorized",
          latestEvent: null,
          state: null,
          ...(wantDebug ? { debug: { auth: { ok: false } } } : {}),
        },
        { status: 401 },
      );
    }

    const bankId = await withTimeout(getCurrentBankId(), 8_000, "getCurrentBankId");
    const sb = supabaseAdmin();

    const debug: any = wantDebug
      ? {
          auth: { ok: true },
          tenant: { bankId: maskId(bankId) },
        }
      : null;

    const { data, error } = await withTimeout(
      sb
        .from("deal_pipeline_ledger")
        .select(
          "id, deal_id, bank_id, event_key, stage, status, ui_state, ui_message, payload, error, created_at, meta"
        )
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      10_000,
      "pipelineLatest",
    );

    if (wantDebug) {
      const countRes = await withTimeout(
        sb
          .from("deal_pipeline_ledger")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", dealId)
          .eq("bank_id", bankId),
        10_000,
        "pipelineCount",
      );

      debug.ledger = {
        count: countRes.count ?? null,
        countError: countRes.error ? String(countRes.error.message ?? countRes.error) : null,
      };
    }

    if (error) {
      console.error("[pipeline/latest] query error:", error);
      // Never hard-fail the UI: return calm null state.
      return NextResponse.json({
        ok: true,
        __version: VERSION_MARKER,
        latestEvent: null,
        state: null,
        ...(wantDebug ? { debug: { ...debug, queryError: String(error.message ?? error) } } : {}),
      });
    }

    if (!data) {
      // No pipeline events yet - deal just created
      return NextResponse.json({
        ok: true,
        __version: VERSION_MARKER,
        latestEvent: null,
        state: null,
        ...(wantDebug ? { debug } : {}),
      });
    }

    return NextResponse.json({
      ok: true,
      __version: VERSION_MARKER,
      latestEvent: data,
      state: data.stage ?? null,
      ...(wantDebug ? { debug } : {}),
    });

  } catch (error: any) {
    const isTimeout = String(error?.message || "").startsWith("timeout:");
    console.error("[pipeline/latest] unexpected error:", error);
    // Never hard-fail the UI: return calm null state.
    return NextResponse.json({
      ok: true,
      __version: VERSION_MARKER,
      latestEvent: null,
      state: null,
      ...(wantDebug
        ? {
            debug: {
              error: isTimeout ? "timeout" : String(error?.message ?? error),
            },
          }
        : {}),
    });
  }
}
