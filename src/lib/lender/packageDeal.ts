import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * 📦 AUTOMATIC LENDER PACKAGING
 * 
 * When a deal is submitted (submitted_at set), automatically generate a lender package:
 * - Collects all finalized documents
 * - Includes credit memo (if exists)
 * - Includes checklist summary
 * - Generates package manifest
 * 
 * This is AUTOMATIC — triggered by submission, not manual.
 * No buttons, no workflows, just convergence.
 */

export type LenderPackage = {
  deal_id: string;
  package_id: string;
  generated_at: string;
  manifest: {
    deal: {
      borrower_name: string;
      amount: number;
      ready_at: string;
      submitted_at: string;
    };
    documents: Array<{
      id: string;
      filename: string;
      checklist_key?: string;
      uploaded_at: string;
    }>;
    checklist_summary: {
      total: number;
      satisfied: number;
      pending: number;
    };
    credit_memo?: {
      id: string;
      generated_at: string;
    };
  };
};

/**
 * Generate lender package for a submitted deal
 * 
 * @throws Error if deal not found or not submitted
 */
export async function generateLenderPackage(dealId: string): Promise<LenderPackage> {
  const sb = supabaseAdmin();

  // Fetch deal
  const { data: deal, error: dealError } = await sb
    .from("deals")
    .select("id, borrower_name, amount, ready_at, submitted_at, bank_id")
    .eq("id", dealId)
    .single();

  if (dealError || !deal) {
    throw new Error("Deal not found");
  }

  if (!deal.submitted_at) {
    throw new Error("Deal not submitted - cannot package");
  }

  if (!deal.ready_at) {
    throw new Error("Deal not ready - should not have been submitted");
  }

  // Fetch finalized documents
  const { data: documents } = await sb
    .from("deal_documents")
    .select("id, original_filename, checklist_key, uploaded_at")
    .eq("deal_id", dealId)
    .not("finalized_at", "is", null)
    .order("uploaded_at", { ascending: true });

  // Fetch checklist items
  const { data: checklistItems } = await sb
    .from("deal_checklist_items")
    .select("id, required, status")
    .eq("deal_id", dealId);

  const total = checklistItems?.length || 0;
  const satisfied = checklistItems?.filter((i) => i.status === "satisfied").length || 0;
  const pending = total - satisfied;

  // Fetch credit memo (if exists)
  const { data: creditMemo } = await sb
    .from("deal_credit_memos")
    .select("id, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Generate package manifest
  const packageId = `pkg_${dealId}_${Date.now()}`;
  const manifest: LenderPackage["manifest"] = {
    deal: {
      borrower_name: deal.borrower_name,
      amount: deal.amount,
      ready_at: deal.ready_at,
      submitted_at: deal.submitted_at,
    },
    documents: (documents || []).map((doc) => ({
      id: doc.id,
      filename: doc.original_filename,
      checklist_key: doc.checklist_key || undefined,
      uploaded_at: doc.uploaded_at,
    })),
    checklist_summary: {
      total,
      satisfied,
      pending,
    },
    credit_memo: creditMemo
      ? {
          id: creditMemo.id,
          generated_at: creditMemo.created_at,
        }
      : undefined,
  };

  const generatedAt = new Date().toISOString();

  // Store package reference in deals table
  await sb
    .from("deals")
    .update({
      lender_package_id: packageId,
      lender_package_generated_at: generatedAt,
    })
    .eq("id", dealId);

  // Log to pipeline ledger
  await sb.from("deal_pipeline_ledger").insert({
    deal_id: dealId,
    bank_id: deal.bank_id,
    stage: "packaging",
    status: "completed",
    payload: {
      package_id: packageId,
      document_count: documents?.length || 0,
      checklist_satisfaction: `${satisfied}/${total}`,
    },
  });

  console.log("[lender-package] Generated successfully", {
    dealId,
    packageId,
    documentCount: documents?.length || 0,
  });

  return {
    deal_id: dealId,
    package_id: packageId,
    generated_at: generatedAt,
    manifest,
  };
}

/**
 * Get existing lender package for a deal (if already generated)
 */
export async function getLenderPackage(dealId: string): Promise<LenderPackage | null> {
  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("lender_package_id, lender_package_generated_at")
    .eq("id", dealId)
    .single();

  if (!deal?.lender_package_id) {
    return null;
  }

  // Package exists but manifest not stored - would regenerate or fetch from storage
  // For now, return minimal reference
  return {
    deal_id: dealId,
    package_id: deal.lender_package_id,
    generated_at: deal.lender_package_generated_at,
    manifest: {} as any, // Would be fetched from storage in production
  };
}
