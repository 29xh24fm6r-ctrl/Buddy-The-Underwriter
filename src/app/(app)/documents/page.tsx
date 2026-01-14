import { redirect } from "next/navigation";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Link from "next/link";

function formatBytes(bytes: unknown): string {
  const n = typeof bytes === "number" ? bytes : Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, idx);
  return `${v.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

type DocRow = {
  id: string;
  deal_id: string;
  original_filename: string | null;
  mime_type?: string | null;
  created_at: string | null;
  size_bytes?: number | null;
  checklist_key?: string | null;
  source?: string | null;
};

export default async function DocumentsPage() {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const recentRes = await sb
    .from("deal_documents")
    .select("id, deal_id, original_filename, mime_type, created_at, size_bytes, checklist_key, source")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(25);

  const recentDocs = ((recentRes.data ?? []) as DocRow[]).filter((d) => Boolean(d?.deal_id));
  if (recentRes.error) {
    console.error("[/documents] deal_documents recent query failed:", recentRes.error);
  }

  const dealIds = Array.from(new Set(recentDocs.map((d) => String(d.deal_id)).filter(Boolean)));
  const dealsById = new Map<string, { id: string; name: string }>();
  if (dealIds.length > 0) {
    const dealsRes = await sb
      .from("deals")
      .select("id, borrower_name, name")
      .eq("bank_id", bankId)
      .in("id", dealIds);

    if (dealsRes.error) {
      console.error("[/documents] deals lookup failed:", dealsRes.error);
    } else {
      for (const row of dealsRes.data ?? []) {
        const id = String((row as any).id);
        const name =
          String((row as any).borrower_name || (row as any).name || "Untitled deal");
        dealsById.set(id, { id, name });
      }
    }
  }

  const [totalCountRes, pendingCountRes, classifiedCountRes] = await Promise.all([
    sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("bank_id", bankId),
    sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("bank_id", bankId)
      .is("checklist_key", null),
    sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("bank_id", bankId)
      .not("checklist_key", "is", null),
  ]);

  const totalDocs = totalCountRes.count ?? null;
  const pendingReview = pendingCountRes.count ?? null;
  const autoClassified = classifiedCountRes.count ?? null;

  // Storage used: best-effort approximation to avoid heavy full scans.
  let storageApproxBytes: number | null = null;
  if (recentDocs.length > 0) {
    storageApproxBytes = recentDocs.reduce((sum, d) => sum + (Number(d.size_bytes) || 0), 0);
  }

  return (
    <div className="min-h-screen bg-[#0f1115] p-6">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-white">Documents & Evidence</h1>
        <p className="text-white/60 mt-2">
          Manage documents across all deals and build your evidence library
        </p>
      </header>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link
          href="/deals"
          className="block p-6 bg-[#181b21] border border-white/10 rounded-lg hover:border-primary/50 transition-colors group"
        >
          <span className="material-symbols-outlined text-4xl text-primary mb-3 block">
            folder_open
          </span>
          <h3 className="text-lg font-semibold text-white mb-2">Deal Documents</h3>
          <p className="text-sm text-white/60">
            View and manage documents for active deals
          </p>
          <div className="mt-4 text-primary text-sm font-medium inline-flex items-center gap-1 group-hover:gap-2 transition-all">
            Go to Deals
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </div>
        </Link>

        <Link
          href="/deals/new"
          className="block p-6 bg-[#181b21] border border-white/10 rounded-lg hover:border-primary/50 transition-colors group"
        >
          <span className="material-symbols-outlined text-4xl text-amber-500 mb-3 block">
            cloud_upload
          </span>
          <h3 className="text-lg font-semibold text-white mb-2">Upload Documents</h3>
          <p className="text-sm text-white/60">
            Start a new deal and upload initial documents
          </p>
          <div className="mt-4 text-primary text-sm font-medium inline-flex items-center gap-1 group-hover:gap-2 transition-all">
            New Deal Intake
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </div>
        </Link>

        <div className="p-6 bg-[#181b21] border border-white/10 rounded-lg opacity-60">
          <span className="material-symbols-outlined text-4xl text-white/40 mb-3 block">
            library_books
          </span>
          <h3 className="text-lg font-semibold text-white mb-2">Evidence Library</h3>
          <p className="text-sm text-white/60">
            Searchable repository of all evidence across deals
          </p>
          <div className="mt-4 text-white/40 text-sm font-medium inline-flex items-center gap-1">
            Coming Soon
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-[#181b21] border border-white/10 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Recent Activity</h2>
        {recentDocs.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-white/20 text-6xl">
              description
            </span>
            <p className="text-white/60 mt-4">
              No documents yet. Upload files via <Link href="/deals/new" className="text-primary hover:underline">New Deal Intake</Link>.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="w-full">
              <thead className="bg-[#1f242d] border-b border-white/10">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                    Document
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                    Deal
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white/70 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-white/70 uppercase tracking-wider">
                    Uploaded
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {recentDocs.map((d) => {
                  const dealName = dealsById.get(String(d.deal_id))?.name || "Deal";
                  const uploadedLabel = d.created_at
                    ? new Date(d.created_at).toLocaleString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "-";
                  const status = d.checklist_key ? "Classified" : "Needs review";

                  return (
                    <tr key={d.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-sm text-white">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-white/40 text-[18px]">
                            description
                          </span>
                          <span className="truncate max-w-[520px]">
                            {d.original_filename || "(unnamed)"}
                          </span>
                          {d.size_bytes ? (
                            <span className="text-xs text-white/40">• {formatBytes(d.size_bytes)}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Link
                          href={`/deals/${d.deal_id}/cockpit`}
                          className="text-primary hover:underline"
                        >
                          {dealName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={
                            "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium " +
                            (d.checklist_key
                              ? "bg-primary/20 text-primary border border-primary/30"
                              : "bg-amber-500/20 text-amber-500 border border-amber-500/30")
                          }
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-white/70">
                        {uploadedLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
        <div className="p-4 bg-[#181b21] border border-white/10 rounded-lg">
          <div className="text-sm text-white/60 mb-1">Total Documents</div>
          <div className="text-2xl font-bold text-white">
            {typeof totalDocs === "number" ? totalDocs.toLocaleString("en-US") : "-"}
          </div>
        </div>
        <div className="p-4 bg-[#181b21] border border-white/10 rounded-lg">
          <div className="text-sm text-white/60 mb-1">Pending Review</div>
          <div className="text-2xl font-bold text-white">
            {typeof pendingReview === "number" ? pendingReview.toLocaleString("en-US") : "-"}
          </div>
        </div>
        <div className="p-4 bg-[#181b21] border border-white/10 rounded-lg">
          <div className="text-sm text-white/60 mb-1">Auto-Classified</div>
          <div className="text-2xl font-bold text-white">
            {typeof autoClassified === "number" ? autoClassified.toLocaleString("en-US") : "-"}
          </div>
        </div>
        <div className="p-4 bg-[#181b21] border border-white/10 rounded-lg">
          <div className="text-sm text-white/60 mb-1">Storage Used (recent)</div>
          <div className="text-2xl font-bold text-white">
            {storageApproxBytes != null ? formatBytes(storageApproxBytes) : "-"}
          </div>
        </div>
      </div>

      {/* Help Text */}
      <div className="mt-6 p-4 bg-primary/10 border border-primary/30 rounded-lg">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">
            info
          </span>
          <div>
            <div className="text-sm font-semibold text-white mb-1">
              Documents are organized by deal
            </div>
            <div className="text-sm text-white/70">
              To view or upload documents, navigate to a specific deal from the{" "}
              <Link href="/deals" className="text-primary hover:underline">
                Deals page
              </Link>
              . The Evidence Library (global document search) is coming soon.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
