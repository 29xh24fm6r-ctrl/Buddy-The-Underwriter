import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { CitedMemoViewer } from "@/components/evidence/CitedMemoViewer";
import { PdfOverlayViewer } from "@/components/evidence/PdfOverlayViewer";
import { getSignedPdfUrl } from "@/lib/storage/getSignedPdfUrl";

export const dynamic = "force-dynamic";

async function getMemo(dealId: string, memoId: string) {
  const sb = supabaseAdmin();
  const memo = await sb.from("credit_memo_drafts").select("*").eq("deal_id", dealId).eq("id", memoId).single();
  if (memo.error) throw memo.error;
  return memo.data;
}

export default async function MemoEvidencePage({
  params,
}: {
  params: Promise<{ dealId: string; memoId: string }>;
}) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);

  const { dealId, memoId } = await params;
  const memo = await getMemo(dealId, memoId);

  // Choose a primary attachment for now.
  // v1: take most recent doc_intel_result file_id
  const sb = supabaseAdmin();
  const doc = await sb
    .from("doc_intel_results")
    .select("file_id")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const attachmentId = String(doc.data?.file_id || "");

  // Get attachment storage path for PDF URL
  let pdfUrl = "";
  if (attachmentId) {
    try {
      const attachment = await sb
        .from("deal_attachments")
        .select("file_path, filename")
        .eq("id", attachmentId)
        .maybeSingle();

      if (attachment.data) {
        const filePath = attachment.data.file_path || `${dealId}/${attachment.data.filename}`;
        pdfUrl = await getSignedPdfUrl({
          bucket: "deal-documents",
          path: filePath,
          expiresInSeconds: 3600, // 1 hour
        });
      }
    } catch (e) {
      console.error("Failed to get PDF URL:", e);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-gray-500">Buddy • Evidence v3</div>
          <div className="text-2xl font-semibold text-gray-900">Memo + PDF Evidence</div>
          <div className="text-sm text-gray-600 mt-1">
            Every paragraph has sources. Every source opens the exact excerpt.
          </div>
        </div>
      </div>

      <CitedMemoViewer dealId={dealId} memo={memo as any} attachmentId={attachmentId} />

      {!pdfUrl ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="font-semibold">PDF URL not available</div>
          <div className="mt-1">
            Unable to generate signed URL for attachment{" "}
            <span className="font-mono">{attachmentId || "—"}</span>.
            Citations will still work via text excerpts.
          </div>
        </div>
      ) : (
        <PdfOverlayViewer
          dealId={dealId}
          memoId={memoId}
          pdfUrl={pdfUrl}
          attachmentId={attachmentId}
        />
      )}
    </div>
  );
}
