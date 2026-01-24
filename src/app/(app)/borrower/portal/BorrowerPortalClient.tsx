// src/app/borrower/portal/page.tsx
"use client";

import React, { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { usePortalRequests } from "@/components/borrower/hooks/usePortalRequests";
import PackSuggestionsCard from "@/components/borrower/PackSuggestionsCard";
import PortalProgressCard from "@/components/borrower/PortalProgressCard";
import PortalRequestsList from "@/components/borrower/PortalRequestsList";
import BulkUploadZone from "@/components/borrower/BulkUploadZone";
import MissingItemsCard from "@/components/borrower/MissingItemsCard";
import RecentActivityCard from "@/components/borrower/RecentActivityCard";

export default function BorrowerPortalClient() {
  const sp = useSearchParams();
  const token = useMemo(() => (sp ? sp.get("token") ?? "" : ""), [sp]);

  const { state, load, derived } = usePortalRequests(token);

  return (
    <div className="min-h-screen bg-[#0b0d10] text-white">
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-white">Secure document portal</div>
          <div className="mt-1 text-sm text-white/60">
            Upload documents and track progress in real time.
          </div>
        </div>

        <button
          type="button"
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
          onClick={() => void load()}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {!token && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
          <div className="text-sm font-semibold">Missing portal token</div>
          <div className="mt-2 text-sm text-white/60">
            Please open the portal link provided by your banker. It contains a secure token.
          </div>
        </div>
      )}

      {token && state.status === "error" && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
          <div className="text-sm font-semibold">Couldn't load your portal</div>
          <div className="mt-2 text-sm text-white/60">{state.error}</div>
          <button
            type="button"
            className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15 border border-white/10"
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      )}

      {token && (state.status === "loading" || state.status === "idle") && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
          <div className="text-sm font-semibold">Loading…</div>
          <div className="mt-2 text-sm text-white/60">Preparing your checklist and recommendations.</div>
        </div>
      )}

      {token && state.status === "ready" && derived && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left column: guided experience */}
          <div className="lg:col-span-5 space-y-6">

            {/* NEW: missing items guidance (the "coach") */}
            <MissingItemsCard
              missingItems={derived.missingItems}
              bestSuggestion={derived.bestSuggestion}
            />

            <PortalProgressCard progress={derived.progress} />
            <PackSuggestionsCard suggestions={derived.suggestions} />
            <BulkUploadZone token={token} onComplete={() => void load()} />
          </div>

          {/* Right column: the actual request list */}
          <div className="lg:col-span-7 space-y-6">
            <PortalRequestsList requests={derived.requests} />
            
            {/* Recent activity feed (the delight loop) */}
            <RecentActivityCard activities={derived.recentActivity} />
          </div>
        </div>
      )}
    </div>
  </div>
  );
}
