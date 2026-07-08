import "server-only";

/**
 * POST /api/cron/brokerage/marketplace/run
 * route-class: WORKER — CRON_SECRET gated.
 *
 * Drives the marketplace forward on a schedule: advances listing statuses by
 * wall-clock (pending_preview → claiming → expired) and then flushes the lender
 * message outbox through the real env-mode adapters. Without this, sealed listings
 * never open for claiming and queued lender messages never send (audit C2).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { advanceMarketplaceListings } from "@/lib/brokerage/marketplaceCadence";
import { runLenderCommsCycle, type SendAdapter } from "@/lib/brokerage/lenderComms";
import {
  createBrokerageCommsAdaptersFromEnv,
  getCommsMode,
} from "@/lib/brokerage/commsAdapters";
import { verifyCronSecret } from "@/lib/brokerage/commsCron";
import { redactResponseSecrets } from "@/lib/brokerage/commsAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const auth = verifyCronSecret(request);
  if (!auth.authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin() as any;
  const mode = getCommsMode();

  try {
    const cadence = await advanceMarketplaceListings(sb);

    // Real lender-message adapter (email/dashboard) — env-mode resolved.
    const adapters = createBrokerageCommsAdaptersFromEnv();
    const lenderAdapter: SendAdapter = async (m) => {
      if (m.channel === "dashboard") return { ok: true };
      return adapters.email({ recipient: m.recipient, subject: m.subject, body: m.body });
    };
    const comms = await runLenderCommsCycle(sb, lenderAdapter);

    return NextResponse.json(
      redactResponseSecrets({ ok: true, mode, cadence, comms }),
    );
  } catch (err: any) {
    return NextResponse.json(
      redactResponseSecrets({
        ok: false,
        error: "marketplace_cron_failed",
        message: String(err?.message ?? "unknown"),
      }),
      { status: 500 },
    );
  }
}
