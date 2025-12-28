import { NextResponse } from "next/server";
import { selectReminderCandidates } from "@/lib/reminders/selectCandidates";
import { getReminderStats, isAttemptsSatisfied, isCooldownSatisfied } from "@/lib/reminders/ledger";
import { sendSmsWithConsent } from "@/lib/sms/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

/**
 * POST /api/cron/borrower-reminders
 * 
 * Automated reminder cron for borrowers with missing documents
 * 
 * Auth: Requires Authorization: Bearer <CRON_SECRET>
 * 
 * Logic:
 * 1. Select deals with missing required items + active portal links
 * 2. Check reminder stats (attempts, cooldown)
 * 3. Send SMS if eligible (automatically enforces opt-out)
 * 4. Log to outbound_messages + deal_events
 * 
 * Vercel Cron:
 * Set in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/borrower-reminders",
 *     "schedule": "0 14 * * *"
 *   }]
 * }
 */
export async function POST(req: Request) {
  // Auth check
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return unauthorized();
  }

  try {
    const candidates = await selectReminderCandidates();

    const results: Array<{
      dealId: string;
      borrowerPhone: string;
      action: "sent" | "skipped";
      reason?: string;
      error?: string;
    }> = [];

    for (const c of candidates) {
      try {
        const { attempts, lastAt } = await getReminderStats({
          dealId: c.dealId,
          borrowerPhone: c.borrowerPhone,
        });

        if (!isAttemptsSatisfied(attempts)) {
          results.push({
            dealId: c.dealId,
            borrowerPhone: c.borrowerPhone,
            action: "skipped",
            reason: "max_attempts",
          });
          continue;
        }

        if (!isCooldownSatisfied(lastAt)) {
          results.push({
            dealId: c.dealId,
            borrowerPhone: c.borrowerPhone,
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

        await sendSmsWithConsent({
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

        results.push({
          dealId: c.dealId,
          borrowerPhone: c.borrowerPhone,
          action: "sent",
        });
      } catch (e: any) {
        // Most important "error" is opted-out; treat as skipped so cron stays green
        if (e?.code === "SMS_OPTED_OUT" || String(e?.message || "").includes("opted out")) {
          results.push({
            dealId: c.dealId,
            borrowerPhone: c.borrowerPhone,
            action: "skipped",
            reason: "opted_out",
          });
          continue;
        }

        results.push({
          dealId: c.dealId,
          borrowerPhone: c.borrowerPhone,
          action: "skipped",
          reason: "error",
          error: e?.message ?? String(e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      candidates: candidates.length,
      sent: results.filter((r) => r.action === "sent").length,
      skipped: results.filter((r) => r.action === "skipped").length,
      results,
    });
  } catch (error: any) {
    console.error("Borrower reminders cron error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to process reminders",
      },
      { status: 500 }
    );
  }
}
