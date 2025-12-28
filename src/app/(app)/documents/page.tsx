import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

export default async function DocumentsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="min-h-screen bg-[#0f1115] p-6">
      {/* Route Marker for debugging */}
      <div className="mb-4 rounded-lg border border-primary/30 bg-primary/10 p-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">verified</span>
          <span className="text-sm font-mono text-white/80">
            DOCS_ROUTE_MARKER_OK - Route rendering successfully
          </span>
        </div>
      </div>

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
          href="/intake"
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
            New Intake
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

      {/* Recent Activity Placeholder */}
      <div className="bg-[#181b21] border border-white/10 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Recent Activity</h2>
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-white/20 text-6xl">
            description
          </span>
          <p className="text-white/60 mt-4">
            No recent document activity. Documents uploaded through deals will appear here.
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
        <div className="p-4 bg-[#181b21] border border-white/10 rounded-lg">
          <div className="text-sm text-white/60 mb-1">Total Documents</div>
          <div className="text-2xl font-bold text-white">-</div>
        </div>
        <div className="p-4 bg-[#181b21] border border-white/10 rounded-lg">
          <div className="text-sm text-white/60 mb-1">Pending Review</div>
          <div className="text-2xl font-bold text-white">-</div>
        </div>
        <div className="p-4 bg-[#181b21] border border-white/10 rounded-lg">
          <div className="text-sm text-white/60 mb-1">Auto-Classified</div>
          <div className="text-2xl font-bold text-white">-</div>
        </div>
        <div className="p-4 bg-[#181b21] border border-white/10 rounded-lg">
          <div className="text-sm text-white/60 mb-1">Storage Used</div>
          <div className="text-2xl font-bold text-white">-</div>
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
