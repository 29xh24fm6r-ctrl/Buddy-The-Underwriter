import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * 🔔 BORROWER NUDGES — BLOCKER-DRIVEN COMMUNICATION
 * 
 * Generate intelligent nudges based on pipeline blockers:
 * - Reads ready_reason from deals table
 * - Analyzes pipeline ledger for blocked events
 * - Creates actionable, specific messages
 * 
 * No generic "please upload documents" spam.
 * Each nudge is driven by actual system state.
 */

export type BorrowerNudge = {
  deal_id: string;
  nudge_type: "upload_pending" | "checklist_incomplete" | "ready";
  message: string;
  action_items: string[];
  urgency: "low" | "medium" | "high";
  metadata: Record<string, any>;
};

/**
 * Generate intelligent nudge for a deal based on current blockers
 */
export async function generateBorrowerNudge(dealId: string): Promise<BorrowerNudge | null> {
  const sb = supabaseAdmin();

  // Fetch deal state
  const { data: deal } = await sb
    .from("deals")
    .select("id, borrower_name, ready_at, ready_reason, submitted_at")
    .eq("id", dealId)
    .single();

  if (!deal) {
    throw new Error("Deal not found");
  }

  // If already submitted, no nudge needed
  if (deal.submitted_at) {
    return null;
  }

  // If deal is ready, send completion nudge
  if (deal.ready_at) {
    return {
      deal_id: dealId,
      nudge_type: "ready",
      message: `Great news! Your loan application is complete and ready for review.`,
      action_items: ["Wait for bank review"],
      urgency: "low",
      metadata: {
        ready_at: deal.ready_at,
      },
    };
  }

  // Parse ready_reason to determine blocker
  const reason = deal.ready_reason || "Unknown status";

  // Check for upload blockers
  if (reason.includes("Uploads processing") || reason.includes("remaining")) {
    const match = reason.match(/(\d+)\s+remaining/);
    const remainingCount = match ? parseInt(match[1]) : 0;

    // Fetch which documents are still processing
    const { data: pendingDocs } = await sb
      .from("deal_documents")
      .select("original_filename, uploaded_at")
      .eq("deal_id", dealId)
      .is("finalized_at", null);

    return {
      deal_id: dealId,
      nudge_type: "upload_pending",
      message: `We're still processing ${remainingCount} document${remainingCount !== 1 ? "s" : ""} you uploaded.`,
      action_items: [
        "No action needed - processing automatically",
        "Check back in 5-10 minutes",
      ],
      urgency: "low",
      metadata: {
        remaining_count: remainingCount,
        pending_files: pendingDocs?.map((d) => d.original_filename) || [],
      },
    };
  }

  // Check for checklist blockers
  if (reason.includes("Checklist incomplete") || reason.includes("items missing")) {
    const match = reason.match(/(\d+)\s+items?\s+missing/);
    const missingCount = match ? parseInt(match[1]) : 0;

    // Fetch specific missing items
    const { data: missingItems } = await sb
      .from("deal_checklist_items")
      .select("title, description, checklist_key")
      .eq("deal_id", dealId)
      .eq("required", true)
      .neq("status", "satisfied");

    const actionItems = missingItems?.slice(0, 3).map((item) => item.title) || [];
    if (missingItems && missingItems.length > 3) {
      actionItems.push(`...and ${missingItems.length - 3} more`);
    }

    return {
      deal_id: dealId,
      nudge_type: "checklist_incomplete",
      message: `You're almost there! ${missingCount} required document${missingCount !== 1 ? "s" : ""} still needed.`,
      action_items: actionItems.length > 0 ? actionItems : ["Upload missing documents"],
      urgency: "high",
      metadata: {
        missing_count: missingCount,
        missing_items: missingItems?.map((i) => ({
          title: i.title,
          key: i.checklist_key,
        })) || [],
      },
    };
  }

  // Checklist not initialized
  if (reason.includes("not initialized")) {
    return {
      deal_id: dealId,
      nudge_type: "checklist_incomplete",
      message: "We're setting up your document checklist. This happens automatically.",
      action_items: ["No action needed", "Check back in a few minutes"],
      urgency: "low",
      metadata: {
        reason: "checklist_not_initialized",
      },
    };
  }

  // Fallback: generic nudge
  return {
    deal_id: dealId,
    nudge_type: "checklist_incomplete",
    message: "Your loan application is in progress.",
    action_items: ["Check your document checklist", "Upload any missing items"],
    urgency: "medium",
    metadata: {
      ready_reason: reason,
    },
  };
}

/**
 * Check if a nudge should be sent (not sent too recently)
 */
export async function shouldSendNudge(dealId: string): Promise<boolean> {
  const sb = supabaseAdmin();

  // Check last nudge sent timestamp
  const { data: lastNudge } = await sb
    .from("borrower_nudges")
    .select("sent_at")
    .eq("deal_id", dealId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .single();

  if (!lastNudge) {
    return true; // No nudges sent yet
  }

  // Don't send if last nudge was within 24 hours
  const lastSentAt = new Date(lastNudge.sent_at);
  const hoursSinceLastNudge = (Date.now() - lastSentAt.getTime()) / (1000 * 60 * 60);

  return hoursSinceLastNudge >= 24;
}

/**
 * Record that a nudge was sent (for rate limiting)
 */
export async function recordNudgeSent(dealId: string, nudge: BorrowerNudge): Promise<void> {
  const sb = supabaseAdmin();

  await sb.from("borrower_nudges").insert({
    deal_id: dealId,
    nudge_type: nudge.nudge_type,
    message: nudge.message,
    sent_at: new Date().toISOString(),
    metadata: nudge.metadata,
  });

  console.log("[nudge] Recorded nudge sent", { dealId, nudge_type: nudge.nudge_type });
}
