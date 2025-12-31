import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchDealContext } from "@/lib/deals/fetchDealContext";

/**
 * This is intentionally resilient (best-effort).
 * It will fill what exists and report missing fields later.
 */
export async function buildCanonicalValuesForDeal(args: {
  dealId: string;
  borrowerContactId?: string | null;
}) {
  // 1) Deal basics via canonical context endpoint
  const context = await fetchDealContext(args.dealId);
  if (!context.ok) throw new Error(`Deal not found: ${context.error}`);
  
  // Note: Full deal record would need additional fields beyond what /context provides
  // For now, we'll use what we have and may need to expand /context or create /deals/:id/full
  const deal = context as any; // Cast for backward compatibility

  // 2) Borrower contact (if you have a column on deal use it; else passed in)
  const borrowerId =
    args.borrowerContactId ??
    (deal as any)?.borrower_contact_id ??
    (deal as any)?.primary_contact_id ??
    null;

  let borrower: any = null;
  if (borrowerId) {
    const { data: c, error: eC } = await supabaseAdmin().from("crm_contacts").select("*").eq("id", borrowerId).maybeSingle() as any;
    if (eC) throw eC;
    borrower = c ?? null;
  }

  // 3) PFS values
  // If you already have a structured table, swap it in here.
  // For now: try an optional `pfs_snapshots` table, else blank.
  let pfs: any = null;
  try {
    const { data: p, error: eP } = await supabaseAdmin()
      // optional table; may not exist
      .from("pfs_snapshots")
      .select("*")
      .eq("deal_id", args.dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle() as any;
    if (!eP) pfs = p ?? null;
  } catch {
    pfs = null;
  }

  const canonical: Record<string, any> = {
    "borrower.name": borrower?.full_name ?? borrower?.name ?? null,
    "borrower.ssn": borrower?.ssn ?? null,
    "borrower.address": borrower?.address ?? borrower?.mailing_address ?? null,
    "borrower.phone": borrower?.phone ?? null,
    "borrower.email": borrower?.email ?? null,

    "deal.requested_amount": (deal as any)?.requested_amount ?? (deal as any)?.amount ?? null,
    "deal.purpose": (deal as any)?.purpose ?? null,
    "deal.type": (deal as any)?.deal_type ?? (deal as any)?.type ?? null,

    "pfs.cash": pfs?.cash ?? null,
    "pfs.market_securities": pfs?.market_securities ?? null,
    "pfs.real_estate": pfs?.real_estate ?? null,
    "pfs.total_assets": pfs?.total_assets ?? null,
    "pfs.total_liabilities": pfs?.total_liabilities ?? null,
    "pfs.net_worth": pfs?.net_worth ?? null,

    "signature.borrower": borrower?.full_name ?? borrower?.name ?? null,
    "signature.date": new Date(),
  };

  return { deal, borrower, pfs, canonical };
}
