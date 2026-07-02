import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pickLatestPhoneByDeal } from "./pickLatestPhoneByDeal";

/**
 * Candidate for reminder automation
 */
export type ReminderCandidate = {
  dealId: string;
  dealName: string;
  borrowerPhone: string;
  uploadUrl: string;
  missingItemsCount: number;
};

/**
 * Select deals that need reminders
 * 
 * Criteria:
 * - Has active borrower portal link (not used, not expired)
 * - Has missing required checklist items
 * - Has valid borrower phone number
 */
export async function selectReminderCandidates(): Promise<ReminderCandidate[]> {
  const sb = supabaseAdmin();

  // Get active portal links with missing items
  const { data: links, error: linksErr } = await sb
    .from("borrower_portal_links")
    .select(`
      deal_id,
      token,
      expires_at,
      used_at,
      deals!inner (
        id,
        display_name
      )
    `)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());

  if (linksErr) {
    console.error("selectReminderCandidates links error:", linksErr);
    throw new Error(`Failed to select reminder candidates: ${linksErr.message}`);
  }

  if (!links || links.length === 0) {
    return [];
  }

  // Borrower phone lives in borrower_phone_links, not deals. Batch-resolve the
  // latest phone_e164 per deal (newest created_at wins).
  const dealIds = [...new Set(links.map((l) => l.deal_id))];

  const { data: phoneRows, error: phoneErr } = await sb
    .from("borrower_phone_links")
    .select("deal_id, phone_e164, created_at")
    .in("deal_id", dealIds)
    .order("created_at", { ascending: false });

  if (phoneErr) {
    console.error("selectReminderCandidates phone links error:", phoneErr);
    throw new Error(`Failed to resolve borrower phones: ${phoneErr.message}`);
  }

  const phoneByDeal = pickLatestPhoneByDeal(phoneRows ?? []);

  const candidates: ReminderCandidate[] = [];

  // For each link, check if deal has missing items
  for (const link of links) {
    const deal = (link as any).deals;
    if (!deal) continue;

    const phone = phoneByDeal.get(link.deal_id);
    if (!phone) continue;

    // Check for missing required checklist items
    const { data: items, error: itemsErr } = await sb
      .from("deal_checklist_items")
      .select("id, required, received_at")
      .eq("deal_id", link.deal_id)
      .eq("required", true)
      .is("received_at", null);

    if (itemsErr) {
      console.error("Checklist items error for deal", link.deal_id, itemsErr);
      continue;
    }

    const missingCount = items?.length ?? 0;

    // Only include if there are missing required items
    if (missingCount > 0) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const uploadUrl = `${appUrl}/upload/${link.token}`;

      candidates.push({
        dealId: link.deal_id,
        // Leak guard: only display_name or a generic fallback ever reaches
        // borrower SMS — never the internal deal or applicant name fields,
        // which hold fixture strings on at least one prod deal.
        dealName: deal.display_name || "Your loan application",
        borrowerPhone: phone,
        uploadUrl,
        missingItemsCount: missingCount,
      });
    }
  }

  return candidates;
}
