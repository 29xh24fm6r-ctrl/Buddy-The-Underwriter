import { redirect } from "next/navigation";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Link from "next/link";
import {
  GlassShell,
  GlassPageHeader,
  GlassPanel,
  GlassStatCard,
  GlassInfoBox,
  GlassActionCard,
  GlassTable,
  GlassTableHeader,
  GlassTableHeaderCell,
  GlassTableBody,
  GlassTableRow,
  GlassTableCell,
  GlassEmptyState,
} from "@/components/layout";

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

  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) redirect("/select-bank");
  const bankId = bankPick.bankId;
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
    <GlassShell>
      <GlassPageHeader
        title="Documents & Evidence"
        subtitle="Manage documents across all deals and build your evidence library"
      />

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <GlassActionCard
          icon="folder_open"
          iconColor="text-primary"
          title="Deal Documents"
          description="View and manage documents for active deals"
          href="/deals"
          actionLabel="Go to Deals"
        />
        <GlassActionCard
          icon="cloud_upload"
          iconColor="text-amber-500"
          title="Upload Documents"
          description="Start a new deal and upload initial documents"
          href="/deals/new"
          actionLabel="New Deal Intake"
        />
        <GlassActionCard
          icon="library_books"
          iconColor="text-white/40"
          title="Evidence Library"
          description="Searchable repository of all evidence across deals"
          disabled
          disabledLabel="Coming Soon"
        />
      </div>

      {/* Recent Activity */}
      <GlassPanel header="Recent Activity">
        {recentDocs.length === 0 ? (
          <GlassEmptyState
            icon="description"
            title="No documents yet"
            description={
              <>
                Upload files via{" "}
                <Link href="/deals/new" className="text-primary hover:underline">
                  New Deal Intake
                </Link>
                .
              </>
            }
          />
        ) : (
          <GlassTable>
            <GlassTableHeader>
              <GlassTableHeaderCell>Document</GlassTableHeaderCell>
              <GlassTableHeaderCell>Deal</GlassTableHeaderCell>
              <GlassTableHeaderCell>Status</GlassTableHeaderCell>
              <GlassTableHeaderCell align="right">Uploaded</GlassTableHeaderCell>
            </GlassTableHeader>
            <GlassTableBody>
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
                  <GlassTableRow key={d.id}>
                    <GlassTableCell>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-white/40 text-[18px]">
                          description
                        </span>
                        <span className="truncate max-w-[520px]">
                          {d.original_filename || "(unnamed)"}
                        </span>
                        {d.size_bytes ? (
                          <span className="text-xs text-white/40">
                            {formatBytes(d.size_bytes)}
                          </span>
                        ) : null}
                      </div>
                    </GlassTableCell>
                    <GlassTableCell>
                      <Link
                        href={`/deals/${d.deal_id}/cockpit`}
                        className="text-primary hover:underline"
                      >
                        {dealName}
                      </Link>
                    </GlassTableCell>
                    <GlassTableCell>
                      <span
                        className={
                          "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium " +
                          (d.checklist_key
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-amber-500/20 text-amber-400 border border-amber-500/30")
                        }
                      >
                        {status}
                      </span>
                    </GlassTableCell>
                    <GlassTableCell align="right">
                      <span className="text-white/70">{uploadedLabel}</span>
                    </GlassTableCell>
                  </GlassTableRow>
                );
              })}
            </GlassTableBody>
          </GlassTable>
        )}
      </GlassPanel>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
        <GlassStatCard
          label="Total Documents"
          value={typeof totalDocs === "number" ? totalDocs.toLocaleString("en-US") : "-"}
        />
        <GlassStatCard
          label="Pending Review"
          value={typeof pendingReview === "number" ? pendingReview.toLocaleString("en-US") : "-"}
        />
        <GlassStatCard
          label="Auto-Classified"
          value={typeof autoClassified === "number" ? autoClassified.toLocaleString("en-US") : "-"}
        />
        <GlassStatCard
          label="Storage Used (recent)"
          value={storageApproxBytes != null ? formatBytes(storageApproxBytes) : "-"}
        />
      </div>

      {/* Help Text */}
      <GlassInfoBox
        icon="info"
        title="Documents are organized by deal"
        variant="info"
        className="mt-6"
      >
        To view or upload documents, navigate to a specific deal from the{" "}
        <Link href="/deals" className="text-primary hover:underline">
          Deals page
        </Link>
        . The Evidence Library (global document search) is coming soon.
      </GlassInfoBox>
    </GlassShell>
  );
}
