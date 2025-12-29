import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";
import type { ChecklistItem } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

// Checklist definitions (canonical source of truth for what's required)
const CHECKLIST_DEFINITIONS = [
  {
    checklist_key: "PFS_CURRENT",
    title: "Personal Financial Statement (current)",
    required: true,
  },
  {
    checklist_key: "IRS_BUSINESS_2Y",
    title: "Business tax returns (last 2 years)",
    required: true,
  },
  {
    checklist_key: "IRS_PERSONAL_2Y",
    title: "Personal tax returns (last 2 years)",
    required: true,
  },
  {
    checklist_key: "FIN_STMT_YTD",
    title: "Year-to-date financial statement",
    required: true,
  },
  {
    checklist_key: "AR_AP_AGING",
    title: "A/R and A/P aging",
    required: false,
  },
  {
    checklist_key: "BANK_STMT_3M",
    title: "Bank statements (last 3 months)",
    required: false,
  },
  {
    checklist_key: "SBA_1919",
    title: "SBA Form 1919",
    required: false,
  },
  {
    checklist_key: "SBA_912",
    title: "SBA Form 912 (Statement of Personal History)",
    required: false,
  },
  {
    checklist_key: "SBA_413",
    title: "SBA Form 413 (PFS)",
    required: false,
  },
  {
    checklist_key: "SBA_DEBT_SCHED",
    title: "Business debt schedule",
    required: false,
  },
];

/**
 * GET /api/deals/[dealId]/checklist
 * 
 * Returns checklist state bucketed by status.
 * Derives state from deal_documents (canonical source) instead of legacy deal_checklist_items table.
 */
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    // Fetch all documents for this deal
    const { data: documents, error } = await sb
      .from("deal_documents")
      .select("id, checklist_key, original_filename, created_at")
      .eq("deal_id", dealId);

    if (error) {
      console.error("[/api/deals/[dealId]/checklist]", error);
      // Return 200 with empty buckets to prevent UI breakage
      return NextResponse.json({
        received: [],
        pending: [],
        optional: [],
      });
    }

    // Group documents by checklist_key
    const documentsByKey = new Map<string, any[]>();
    (documents || []).forEach((doc) => {
      if (doc.checklist_key) {
        const existing = documentsByKey.get(doc.checklist_key) || [];
        existing.push(doc);
        documentsByKey.set(doc.checklist_key, existing);
      }
    });

    const received: ChecklistItem[] = [];
    const pending: ChecklistItem[] = [];
    const optional: ChecklistItem[] = [];

    // Build checklist items from definitions
    CHECKLIST_DEFINITIONS.forEach((def) => {
      const docs = documentsByKey.get(def.checklist_key) || [];
      const hasDocuments = docs.length > 0;

      const item = {
        id: def.checklist_key,
        checklist_key: def.checklist_key,
        title: def.title,
        required: def.required,
        received_at: hasDocuments ? docs[0]?.created_at : null,
        received_file_id: hasDocuments ? docs[0]?.id : null,
        filename: hasDocuments ? docs[0]?.original_filename : null,
      };

      if (hasDocuments) {
        received.push(item);
      } else if (def.required) {
        pending.push(item);
      } else {
        optional.push(item);
      }
    });

    return NextResponse.json({
      received,
      pending,
      optional,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/checklist]", error);
    // Return 200 with empty buckets to prevent UI breakage
    return NextResponse.json({
      received: [],
      pending: [],
      optional: [],
    });
  }
}
