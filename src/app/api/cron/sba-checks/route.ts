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
 * check=template-staleness     — compare stored SBA/IRS PDFs against the live sba.gov/irs.gov
 *                                 revision so official forms never silently go stale
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pollAndReconcileIrsTranscripts } from "@/lib/jobs/pollIrsTranscripts";
import { pollVendorTranscriptRequest } from "@/lib/integrations/irsTranscripts/client";
import { reconcileStaleSignatureGaps } from "@/lib/jobs/staleSignatureChecker";
import { reconcileOverdueThirdPartyGaps } from "@/lib/jobs/thirdPartyOverdueChecker";
import { findExpiringEtranCredentials } from "@/lib/jobs/etranCertExpiryChecker";
import { findTemplateStaleness, writeTemplateStalenessFindings } from "@/lib/jobs/templateStalenessChecker";
import { reconcilePendingVerifications } from "@/lib/identity/kyc/service";
import { fetchDiditSession, getDiditSessionDecision } from "@/lib/identity/kyc/didit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHECKS = new Set([
  "irs-transcripts",
  "stale-signatures",
  "third-party-overdue",
  "etran-cert-expiry",
  "template-staleness",
  "kyc-reconcile",
]);

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
      case "kyc-reconcile": {
        // The safety net the KYC flow never had. Didit webhook delivery is
        // best-effort — on 2026-08-25 a borrower completed verification and
        // the completion event was never delivered at all, leaving the row
        // at "created" and the sealing gate shut with nothing on screen the
        // borrower could press. The portal reconciles on read, but a
        // borrower who never returns would still be stranded, so this sweeps
        // every deal on a schedule regardless of who is looking.
        const result = await reconcilePendingVerifications(
          { limit: 100 },
          { sb: sb as any, didit: { fetchDiditSession, getDiditSessionDecision } },
        );
        if (result.changed > 0) {
          console.log("[cron/sba-checks] kyc statuses advanced", {
            changed: result.changed,
            examined: result.examined,
          });
        }
        if (result.failed > 0) {
          console.warn("[cron/sba-checks] kyc reconcile failures", { failed: result.failed });
        }
        return NextResponse.json({ ok: true, check, result, durationMs: Date.now() - start });
      }
      case "irs-transcripts": {
        const result = await pollAndReconcileIrsTranscripts({
          sb: sb as any,
          vendor: { pollVendorTranscriptRequest },
        });
        return NextResponse.json({ ok: true, check, result, durationMs: Date.now() - start });
      }
      case "stale-signatures": {
        const result = await reconcileStaleSignatureGaps(sb as any);
        return NextResponse.json({
          ok: true,
          check,
          found: result.findings.length,
          gapsWritten: result.gapsWritten,
          gapsResolved: result.gapsResolved,
          durationMs: Date.now() - start,
        });
      }
      case "third-party-overdue": {
        const result = await reconcileOverdueThirdPartyGaps(sb as any);
        return NextResponse.json({
          ok: true,
          check,
          found: result.findings.length,
          gapsWritten: result.gapsWritten,
          gapsResolved: result.gapsResolved,
          durationMs: Date.now() - start,
        });
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
      case "template-staleness": {
        const findings = await findTemplateStaleness(sb as any);
        const written = await writeTemplateStalenessFindings(sb as any, findings);
        const stale = findings.filter((f) => f.isStale);
        const failed = findings.filter((f) => !f.ok);
        if (stale.length > 0) {
          // Same non-deal-scoped situation as etran-cert-expiry — no admin
          // alert sink exists yet, so this is the delivery channel until
          // one is built. Findings are also durably recorded on
          // bank_document_templates.is_stale, so this isn't the only trace.
          console.warn("[cron/sba-checks] SBA/IRS templates are stale", { stale });
        }
        if (failed.length > 0) {
          console.warn("[cron/sba-checks] template staleness check could not resolve some forms", { failed });
        }
        return NextResponse.json({
          ok: true,
          check,
          checked: findings.length,
          stale: stale.length,
          failed: failed.length,
          rowsUpdated: written,
          findings,
          durationMs: Date.now() - start,
        });
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
