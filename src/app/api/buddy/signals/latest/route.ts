// src/app/api/buddy/signals/latest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { BUDDY_SIGNAL_ROUTE_TIMEOUT_MS } from "@/buddy/serverSignalPolling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

class SignalFeedTimeoutError extends Error {
  constructor() {
    super("signal_feed_timeout");
    this.name = "SignalFeedTimeoutError";
  }
}

function normalizeLimit(raw: string | null): number {
  if (raw === null) return 50;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 200);
}

async function loadSignals(req: NextRequest, signal: AbortSignal) {
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const dealId = url.searchParams.get("dealId");
  const limit = normalizeLimit(url.searchParams.get("limit"));

  if (since && !Number.isFinite(Date.parse(since))) {
    return NextResponse.json(
      { ok: false, error: "invalid_since" },
      { status: 400 },
    );
  }

  // This widget mounts in the root layout and polls on every page,
  // including public/unauthenticated ones and the brief window before a
  // freshly-signed-in session cookie propagates. "No tenant resolved yet"
  // is an expected, common state here — not a server error — so degrade
  // to an empty result instead of a hard 500 that spams logs/console for
  // every anonymous visitor and every pre-hydration poll.
  const bankPick = await tryGetCurrentBankId();
  if (signal.aborted) throw new SignalFeedTimeoutError();
  if (!bankPick.ok) {
    return NextResponse.json({ ok: true, items: [] });
  }

  let q = supabaseAdmin()
    .from("buddy_signal_ledger")
    .select("id, created_at, deal_id, type, source, payload")
    .eq("bank_id", bankPick.bankId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (dealId) q = q.eq("deal_id", dealId);
  // The client persists the greatest timestamp it has consumed. Strictly
  // advance beyond it; gte redelivered the same last row on every idle poll.
  if (since) q = q.gt("created_at", since);

  const { data, error } = await q.abortSignal(signal);
  if (signal.aborted) throw new SignalFeedTimeoutError();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    items: (data ?? []).map((r) => ({
      id: r.id,
      ts: new Date(r.created_at).getTime(),
      type: r.type,
      source: r.source,
      dealId: r.deal_id ?? undefined,
      payload: r.payload ?? undefined,
    })),
  });
}

export async function GET(req: NextRequest) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new SignalFeedTimeoutError());
    }, BUDDY_SIGNAL_ROUTE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([loadSignals(req, controller.signal), deadline]);
  } catch (e: any) {
    if (e instanceof SignalFeedTimeoutError || controller.signal.aborted) {
      return NextResponse.json(
        { ok: false, error: "temporarily_unavailable" },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "10",
          },
        },
      );
    }

    console.error("[buddy/signals/latest] unhandled error", {
      message: e?.message,
      name: e?.name,
      stack: e?.stack,
      cause: e?.cause,
    });
    return NextResponse.json(
      { ok: false, error: e?.message || "unhandled_error" },
      { status: 500 },
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
