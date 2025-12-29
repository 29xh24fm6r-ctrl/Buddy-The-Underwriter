import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ⚠️ IMPORTANT: deal_events uses `payload` (jsonb), NOT metadata
// All queries must use payload->>field syntax

/**
 * Resolve phone number to deal context
 * 
 * Strategy:
 * 1. Look up borrower_portal_links by phone (most recent active link)
 * 2. If no active link, search deals by borrower_phone
 * 3. Prefer deals with status='underwriting' or 'pending'
 * 4. Fall back to most recent deal
 * 
 * Returns: { deal_id, bank_id } or null if no match
 */
export async function resolveDealByPhone(phoneE164: string): Promise<{
  deal_id: string;
  bank_id: string;
  deal_name: string | null;
} | null> {
  const sb = supabaseAdmin();

  // Strategy 1: Active portal link (most reliable - borrower actively engaged)
  const { data: portalLinks, error: portalErr } = await sb
    .from("borrower_portal_links")
    .select(`
      deal_id,
      deals!inner (
        id,
        bank_id,
        name
      )
    `)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(10);

  if (!portalErr && portalLinks && portalLinks.length > 0) {
    // Check each link's deal for matching phone
    for (const link of portalLinks) {
      const deal = (link as any).deals;
      if (!deal) continue;

      // Check if this deal's borrower phone matches
      const { data: dealData, error: dealErr } = await sb
        .from("deals")
        .select("id, bank_id, name, borrower_phone")
        .eq("id", deal.id)
        .single();

      if (!dealErr && dealData && dealData.borrower_phone === phoneE164) {
        return {
          deal_id: dealData.id,
          bank_id: dealData.bank_id,
          deal_name: dealData.name,
        };
      }
    }
  }

  // Strategy 2: Direct phone lookup on deals
  const { data: deals, error: dealsErr } = await sb
    .from("deals")
    .select("id, bank_id, name, status")
    .eq("borrower_phone", phoneE164)
    .order("created_at", { ascending: false })
    .limit(20);

  if (dealsErr || !deals || deals.length === 0) {
    return null;
  }

  // Prefer active deals (underwriting, pending)
  const activeDeal = deals.find((d) => 
    d.status === "underwriting" || d.status === "pending"
  );

  if (activeDeal) {
    return {
      deal_id: activeDeal.id,
      bank_id: activeDeal.bank_id,
      deal_name: activeDeal.name,
    };
  }

  // Fall back to most recent deal
  const recentDeal = deals[0];
  return {
    deal_id: recentDeal.id,
    bank_id: recentDeal.bank_id,
    deal_name: recentDeal.name,
  };
}

/**
 * Get current consent state for a phone number
 * Checks deal_events for latest opt-in/opt-out event
 * 
 * Returns: "allowed" | "blocked"
 */
export async function getSmsConsentState(phoneE164: string): Promise<"allowed" | "blocked"> {
  const sb = supabaseAdmin();

  // Find latest consent event for this phone
  const { data, error } = await sb
    .from("deal_events")
    .select("kind, created_at")
    .or(`kind.eq.sms_opt_out,kind.eq.sms_opt_in`)
    .eq("payload->>phone", phoneE164)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("getSmsConsentState error:", error);
    // Default to allowed if query fails (don't block legitimate sends)
    return "allowed";
  }

  if (!data || data.length === 0) {
    // No consent events = allowed (default)
    return "allowed";
  }

  const latestEvent = data[0];
  return latestEvent.kind === "sms_opt_out" ? "blocked" : "allowed";
}
