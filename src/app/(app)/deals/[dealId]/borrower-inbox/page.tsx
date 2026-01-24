import { clerkAuth } from "@/lib/auth/clerkServer";
import UploadInboxCard from "@/components/deals/UploadInboxCard";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
    params,
}: {
    params: Promise<{ dealId?: string }>;
}) {
    const { userId } = await clerkAuth();
    const { dealId } = await params;

    if (!userId) {
        return (
            <div className="p-6">
                <h1 className="text-xl font-semibold text-white">Documents</h1>
                <p className="mt-2 text-sm text-white/70">Please sign in to continue.</p>
            </div>
        );
    }

    if (!dealId || dealId === "undefined") {
        return (
            <div className="p-6">
                <h1 className="text-xl font-semibold text-white">Documents</h1>
                <p className="mt-2 text-sm text-white/70">Loading deal…</p>
            </div>
        );
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
        return (
            <div className="p-6">
                <h1 className="text-xl font-semibold text-white">Documents</h1>
                <p className="mt-2 text-sm text-white/70">Deal not found.</p>
            </div>
        );
    }

    const sb = supabaseAdmin();

    // Check for deal stage, uploaded files, and seeded checklist in parallel
    // Note: uploads can come from borrower portal (borrower_uploads) OR banker uploads (deal_documents)
    const [dealRes, borrowerUploadsRes, dealDocumentsRes, checklistRes] = await Promise.all([
        sb.from("deals")
            .select("lifecycle_stage")
            .eq("id", dealId)
            .eq("bank_id", access.bankId)
            .maybeSingle(),
        sb.from("borrower_uploads")
            .select("id", { count: "exact", head: true })
            .eq("deal_id", dealId),
        sb.from("deal_documents")
            .select("id", { count: "exact", head: true })
            .eq("deal_id", dealId),
        sb.from("deal_checklist_items")
            .select("id", { count: "exact", head: true })
            .eq("deal_id", dealId),
    ]);

    const deal = dealRes.data;
    const hasUploads = (borrowerUploadsRes.count ?? 0) > 0 || (dealDocumentsRes.count ?? 0) > 0;
    const hasChecklist = (checklistRes.count ?? 0) > 0;

    // Show Documents tab if:
    // 1. Lifecycle stage is beyond "created", OR
    // 2. Files have been uploaded, OR
    // 3. Checklist has been seeded/materialized
    const shouldShowDocuments =
        (deal?.lifecycle_stage && deal.lifecycle_stage !== "created") ||
        hasUploads ||
        hasChecklist;

    if (!shouldShowDocuments) {
        return (
            <div className="p-6">
                <h1 className="text-xl font-semibold text-white">Documents</h1>
                <p className="mt-2 text-sm text-white/70">
                    Deal intake has not started yet. Start intake in the Deal Cockpit.
                </p>
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="mb-4">
                <h1 className="text-2xl font-semibold text-white">Document Inbox</h1>
                <p className="mt-1 text-sm text-white/70">
                    Assign uploads to borrower requests and generate missing requests.
                </p>
            </div>
            <UploadInboxCard dealId={dealId} />
        </div>
    );
}
