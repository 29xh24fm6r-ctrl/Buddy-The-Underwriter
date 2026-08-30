import { NextRequest, NextResponse } from "next/server";
import { selectReminderCandidates } from "@/lib/reminders/selectCandidates";
import { getReminderStats, isAttemptsSatisfied, isCooldownSatisfied } from "@/lib/reminders/ledger";
import { sendSmsWithConsent, SmsDeliveryAuditError } from "@/lib/sms/send";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { getCronOutcome } from "@/lib/workers/cronOutcome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

type ReminderResult = {
  dealId: string;
  borrowerPhoneLast4: string;
  action: "sent" | "skipped" | "uncertain";
  reason?: string;
};

function resultBase(dealId: string, borrowerPhone: string) {
  return {
    dealId,
    borrowerPhoneLast4: borrowerPhone.slice(-4),
  };
}

/**
 * POST /api/cron/borrower-reminders
 *
 * Automated reminder cron for borrowers with missing documents.
 *
 * Auth: Requires Authorization: Bearer <CRON_SECRET>
 *
 * Logic:
 * 1. Select deals with missing required items + active portal links
 * 2. Check reminder stats (attempts, cooldown)
 * 3. Send SMS if eligible (automatically enforces opt-out)
 * 4. Prove outbound_messages + deal_events persistence
 */
export async function POST(req: NextRequest) {
  if (!hasValidWorkerSecret(req)) {
    return unauthorized();
  }

  try {
    const candidates = await selectReminderCandidates();
    const results: ReminderResult[] = [];

    for (const c of candidates) {
      const base = resultBase(c.dealId, c.borrowerPhone);

      try {
        const { attempts, lastAt } = await getReminderStats({
          dealId: c.dealId,
          borrowerPhone: c.borrowerPhone,
        });

        if (!isAttemptsSatisfied(attempts)) {
          results.push({
            ...base,
            action: "skipped",
            reason: "max_attempts",
          });
          continue;
        }

        if (!isCooldownSatisfied(lastAt)) {
          results.push({
            ...base,
            action: "skipped",
            reason: "cooldown",
          });
          continue;
        }

        const itemText = c.missingItemsCount === 1 ? "document" : "documents";
        const body =
          `Friendly reminder from Buddy 👋\n\n` +
          `We're still missing ${c.missingItemsCount} ${itemText} for ${c.dealName}.\n\n` +
          `Please upload here:\n${c.uploadUrl}\n\n` +
          `Reply STOP to opt out.`;

        const delivery = await sendSmsWithConsent({
          dealId: c.dealId,
          to: c.borrowerPhone,
          body,
          label: "Upload reminder",
          metadata: {
            reason: "reminder",
            attempt: attempts + 1,
            missing_items: c.missingItemsCount,
          },
        });

        if (delivery.status === "suppressed") {
          results.push({
            ...base,
            action: "skipped",
            reason: "comms_suppressed",
          });
          continue;
        }

        results.push({
          ...base,
          action: "sent",
        });
      } catch (e: any) {
        if (e?.code === "SMS_OPTED_OUT" || String(e?.message || "").includes("opted out")) {
          results.push({
            ...base,
            action: "skipped",
            reason: "opted_out",
          });
          continue;
        }

        if (e instanceof SmsDeliveryAuditError || e?.code === "SMS_AUDIT_PERSISTENCE_FAILED") {
          console.error("Borrower reminder dispatch audit is uncertain", {
            dealId: c.dealId,
            failedStores: e?.failedStores ?? [],
          });
          results.push({
            ...base,
            action: "uncertain",
            reason: "audit_persistence_failed",
          });
          continue;
        }

        console.error("Borrower reminder processing failed", {
          dealId: c.dealId,
          error: e?.message ?? String(e),
        });
        results.push({
          ...base,
          action: "skipped",
          reason: "error",
        });
      }
    }

    const failed = results.filter(
      (result) => result.action === "uncertain" || result.reason === "error",
    ).length;
    const outcome = getCronOutcome(failed);

    return NextResponse.json(
      {
        ok: outcome.ok,
        timestamp: new Date().toISOString(),
        candidates: candidates.length,
        sent: results.filter((result) => result.action === "sent").length,
        skipped: results.filter((result) => result.action === "skipped").length,
        uncertain: results.filter((result) => result.action === "uncertain").length,
        failed: outcome.failures,
        results,
      },
      { status: outcome.status },
    );
  } catch (error: any) {
    console.error("Borrower reminders cron error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to process reminders",
      },
      { status: 500 },
    );
  }
}

// Vercel Cron sends GET — delegate to POST (POST checks cron auth)
export async function GET(req: NextRequest) {
  return POST(req);
}
