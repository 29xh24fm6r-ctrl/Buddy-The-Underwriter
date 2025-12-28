import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeE164 } from "./phone";

export type PhoneLinkSource = "portal_link" | "intake_form" | "manual" | "sms_inbound";

/**
 * Upsert borrower phone link
 * 
 * Creates or updates phone→borrower mapping
 * Used when:
 * - Sending portal link via SMS
 * - Capturing phone in intake form
 * - Receiving inbound SMS (auto-link)
 */
export async function upsertBorrowerPhoneLink(args: {
  phoneE164: string;
  bankId?: string | null;
  borrowerApplicantId?: string | null;
  dealId?: string | null;
  source: PhoneLinkSource;
  metadata?: Record<string, any>;
}) {
  const sb = supabaseAdmin();
  
  const normalized = normalizeE164(args.phoneE164);
  if (!normalized) {
    throw new Error("Phone number required for phone link");
  }

  const payload = {
    bank_id: args.bankId || null,
    phone_e164: normalized,
    borrower_applicant_id: args.borrowerApplicantId || null,
    deal_id: args.dealId || null,
    source: args.source,
    metadata: args.metadata || {},
  };

  // Upsert: update if exists, insert if not
  // Unique key: (bank_id, phone_e164, borrower_applicant_id)
  const { error } = await sb
    .from("borrower_phone_links")
    .upsert(payload, {
      onConflict: "bank_id,phone_e164,borrower_applicant_id",
      ignoreDuplicates: false, // Update existing
    });

  if (error) {
    console.error("upsertBorrowerPhoneLink error:", error);
    throw new Error(`Failed to upsert phone link: ${error.message}`);
  }
}

/**
 * Resolve phone number to borrower/deal context
 * 
 * Strategy (priority order):
 * 1. Exact match on phone_e164 in borrower_phone_links
 * 2. If multiple results, prefer:
 *    a) Most recent active deal
 *    b) Most recently created link
 * 
 * Returns: { deal_id, borrower_applicant_id, bank_id } | null
 */
export async function resolveByPhone(phoneE164: string): Promise<{
  deal_id: string | null;
  borrower_applicant_id: string | null;
  bank_id: string | null;
} | null> {
  const sb = supabaseAdmin();
  
  const normalized = normalizeE164(phoneE164);
  if (!normalized) return null;

  const { data, error } = await sb
    .from("borrower_phone_links")
    .select("deal_id, borrower_applicant_id, bank_id, created_at, metadata")
    .eq("phone_e164", normalized)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("resolveByPhone error:", error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  // If single result, return it
  if (data.length === 1) {
    return {
      deal_id: data[0].deal_id,
      borrower_applicant_id: data[0].borrower_applicant_id,
      bank_id: data[0].bank_id,
    };
  }

  // Multiple results: prefer most recent with active deal
  // (Future: check deal.status = 'underwriting' for smarter routing)
  const mostRecent = data[0];
  return {
    deal_id: mostRecent.deal_id,
    borrower_applicant_id: mostRecent.borrower_applicant_id,
    bank_id: mostRecent.bank_id,
  };
}

/**
 * Get all phone numbers for a borrower
 */
export async function getPhonesByBorrower(args: {
  borrowerApplicantId: string;
  bankId?: string | null;
}): Promise<string[]> {
  const sb = supabaseAdmin();

  const query = sb
    .from("borrower_phone_links")
    .select("phone_e164")
    .eq("borrower_applicant_id", args.borrowerApplicantId);

  if (args.bankId) {
    query.eq("bank_id", args.bankId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("getPhonesByBorrower error:", error);
    return [];
  }

  return (data || []).map((row) => row.phone_e164);
}
