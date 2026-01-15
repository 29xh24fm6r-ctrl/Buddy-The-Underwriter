import Link from "next/link";
import { headers } from "next/headers";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ dealId: string; documentId: string }>;
};

function formatBytes(bytes: unknown): string {
  const n = typeof bytes === "number" ? bytes : Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, idx);
  return `${v.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export default async function DealDocumentViewerPage({ params }: Props) {
  const { userId } = await clerkAuth();
  const { dealId, documentId } = await params;
  const hdrs = await headers();

  if (!userId) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white">Document Viewer</h1>
        <p className="mt-2 text-sm text-white/70">Please sign in to view this document.</p>
      </div>
    );
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white">Document Viewer</h1>
        <p className="mt-2 text-sm text-white/70">Unable to access this deal.</p>
      </div>
    );
  }

  const sb = supabaseAdmin();
  const { data: doc, error } = await sb
    .from("deal_documents")
    .select("id, deal_id, bank_id, original_filename, mime_type, size_bytes, storage_bucket, storage_path")
    .eq("id", documentId)
    .eq("deal_id", dealId)
    .eq("bank_id", access.bankId)
    .maybeSingle();

  if (error || !doc) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white">Document Viewer</h1>
        <p className="mt-2 text-sm text-white/70">Document not found.</p>
      </div>
    );
  }

  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${proto}://${host}` : "";
  const url = new URL(`/api/deals/${dealId}/files/signed-url`, origin || "http://localhost");
  url.searchParams.set("fileId", documentId);

  const signedRes = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      cookie: hdrs.get("cookie") ?? "",
    },
  });

  let signedUrl: string | null = null;
  if (signedRes.ok) {
    const payload = await signedRes.json().catch(() => null);
    signedUrl = payload?.signedUrl ?? null;
  }

  const name = doc.original_filename || "Document";
  const mime = doc.mime_type || "unknown";
  const sizeLabel = formatBytes(doc.size_bytes);
  const isPdf = mime.toLowerCase().includes("pdf");

  return (
    <div className="min-h-screen bg-[#0f1115] text-white p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <div className="text-sm text-white/60 mt-1">
            {mime} • {sizeLabel}
          </div>
        </div>
        <Link
          href={`/underwrite/${dealId}`}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:text-white hover:border-white/30"
        >
          Back to Underwrite
        </Link>
      </div>

      {signedUrl ? (
        isPdf ? (
          <iframe
            title={name}
            src={signedUrl}
            className="w-full h-[75vh] rounded-lg border border-white/10 bg-black"
          />
        ) : (
          <div className="rounded-lg border border-white/10 bg-[#151821] p-6">
            <p className="text-sm text-white/70">Preview not available for this file type.</p>
            <a
              href={signedUrl}
              className="mt-4 inline-flex items-center gap-2 text-primary hover:underline"
            >
              Download
            </a>
          </div>
        )
      ) : (
        <div className="rounded-lg border border-white/10 bg-[#151821] p-6">
          <p className="text-sm text-white/70">Unable to generate a preview link.</p>
        </div>
      )}
    </div>
  );
}
