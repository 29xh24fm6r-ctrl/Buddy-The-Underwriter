/**
 * GET /api/cron/sba-checks?check=<name>
 *
 * ARC-00 Phase 6C — consolidates 4 SBA background-job cron entry points
 * into a single route file (route/page slot budget was in "warning"
 * status heading into this phase — see the Drift Log — so this follows
 * the arc's established consolidation pattern rather than adding 4
 * separate route.ts files; mirrors the existing
 * `/api/jobs/worker/tick?type=...` convention already in vercel.json).
 *
 * Auth: CRON_SECRET or WORKER_SECRET (via hasValidWorkerSecret), same as
 * every other cron/worker route in this codebase.
 *
 * check=irs-transcripts        — poll + reconcile pending IRS 4506-C transcript requests (SPEC S4 D-4)
 * check=stale-signatures       — flag SBA form signatures expiring within 14 days (SPEC S3 D-1)
 * check=third-party-overdue    — flag third-party vendor orders past their expected completion (SPEC S5 C)
 * check=etran-cert-expiry      — flag bank E-Tran mutual-TLS certs expiring within 30 days (SPEC S5 B-7)
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pollAndReconcileIrsTranscripts } from "@/lib/jobs/pollIrsTranscripts";
import { pollVendorTranscriptRequest } from "@/lib/integrations/irsTranscripts/client";
import { findStaleSignatures, writeStaleSignatureGaps } from "@/lib/jobs/staleSignatureChecker";
import { findOverdueThirdPartyOrders, writeOverdueThirdPartyGaps } from "@/lib/jobs/thirdPartyOverdueChecker";
import { findExpiringEtranCredentials } from "@/lib/jobs/etranCertExpiryChecker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHECKS = new Set(["irs-transcripts", "stale-signatures", "third-party-overdue", "etran-cert-expiry"]);

export async function GET(req: NextRequest) {
  const start = Date.now();

  if (!hasValidWorkerSecret(req)) {
    console.error("[cron/sba-checks] auth_failed");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const check = new URL(req.url).searchParams.get("check") ?? "";
  if (!CHECKS.has(check)) {
    return NextResponse.json({ ok: false, error: `unknown check: ${check}` }, { status: 400 });
  }

  console.log("[cron/sba-checks] cron_invocation_seen", { check, ts: new Date().toISOString() });

  const sb = supabaseAdmin();

  try {
    switch (check) {
      case "irs-transcripts": {
        const result = await pollAndReconcileIrsTranscripts({
          sb: sb as any,
          vendor: { pollVendorTranscriptRequest },
        });
        return NextResponse.json({ ok: true, check, result, durationMs: Date.now() - start });
      }
      case "stale-signatures": {
        const findings = await findStaleSignatures(sb as any);
        const written = await writeStaleSignatureGaps(sb as any, findings);
        return NextResponse.json({ ok: true, check, found: findings.length, gapsWritten: written, durationMs: Date.now() - start });
      }
      case "third-party-overdue": {
        const findings = await findOverdueThirdPartyOrders(sb as any);
        const written = await writeOverdueThirdPartyGaps(sb as any, findings);
        return NextResponse.json({ ok: true, check, found: findings.length, gapsWritten: written, durationMs: Date.now() - start });
      }
      case "etran-cert-expiry": {
        const findings = await findExpiringEtranCredentials(sb as any);
        if (findings.length > 0) {
          // No bank-level notification sink exists in this schema today
          // (deal_gap_queue requires deal_id) — see Drift Log. Cron logs
          // are the only delivery channel until that's built.
          console.warn("[cron/sba-checks] etran certs expiring soon", { findings });
        }
        return NextResponse.json({ ok: true, check, found: findings.length, findings, durationMs: Date.now() - start });
      }
      default:
        return NextResponse.json({ ok: false, error: `unhandled check: ${check}` }, { status: 400 });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/sba-checks] check_failed", { check, error: msg });
    return NextResponse.json({ ok: false, check, error: msg, durationMs: Date.now() - start }, { status: 500 });
  }
}
