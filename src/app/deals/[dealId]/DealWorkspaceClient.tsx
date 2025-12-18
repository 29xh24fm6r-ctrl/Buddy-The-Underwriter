// src/app/deals/[dealId]/DealWorkspaceClient.tsx
"use client";

import UploadBox from "@/components/deals/UploadBox";
import DealAssigneesCard from "@/components/deals/DealAssigneesCard";
import BankFormsCard from "@/components/deals/BankFormsCard";
import NextBestActionCard from "@/components/deals/NextBestActionCard";
import DealHeaderCard from "@/components/deals/DealHeaderCard";
import DealSetupCard from "@/components/deals/DealSetupCard";
import PackNavigatorCard from "@/components/deals/PackNavigatorCard";
import DocumentInsightsCard from "@/components/deals/DocumentInsightsCard";
import DraftMessagesCard from "@/components/deals/DraftMessagesCard";
import MissingDocsCard from "@/components/deals/MissingDocsCard";
import DealModals from "@/components/deals/DealModals";
import Link from "next/link";

export default function DealWorkspaceClient({
  dealId,
  dealName,
}: {
  dealId: string;
  dealName: string;
}) {
  if (!dealId) {
    return (
      <main className="min-h-screen p-10">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Missing dealId — route params not found.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* URL-driven modals (shareable, back/forward friendly) */}
      <DealModals dealId={dealId} />

      <div className="mx-auto w-full max-w-[1600px] px-4 py-6">
        <div className="mb-4">
          <Link href="/deals" className="text-sm text-gray-600 hover:underline">
            ← Back to Deals
          </Link>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* LEFT RAIL */}
          <div className="col-span-12 space-y-4 lg:col-span-3">
            <DealHeaderCard dealId={dealId} />

            <div id="setup" className="scroll-mt-24">
              <DealSetupCard dealId={dealId} />
            </div>

            <div id="pack" className="scroll-mt-24">
              <PackNavigatorCard dealId={dealId} />
            </div>
          </div>

          {/* CENTER */}
          <div className="col-span-12 space-y-4 lg:col-span-6">
            <div id="upload" className="scroll-mt-24">
              <UploadBox dealId={dealId} />
            </div>

            <div id="jobs" className="scroll-mt-24">
              <DocumentInsightsCard dealId={dealId} />
            </div>

            <div id="forms" className="scroll-mt-24">
              <BankFormsCard dealId={dealId} />
            </div>
          </div>

          {/* RIGHT RAIL */}
          <div className="col-span-12 space-y-4 lg:col-span-3">
            <NextBestActionCard dealId={dealId} />

            {/* Banker-ready: copy/paste missing docs + portal link */}
            <MissingDocsCard dealId={dealId} />

            <div
              id="conditions"
              className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-4"
            >
              <h3 className="mb-3 text-sm font-semibold">Conditions to Close</h3>
              <p className="mb-4 text-xs text-gray-600">
                Deterministic checklist + AI explanations
              </p>
              <p className="text-sm italic text-gray-500">
                Full conditions view coming soon
              </p>
            </div>

            <div id="messages" className="scroll-mt-24">
              <DraftMessagesCard dealId={dealId} />
            </div>

            <div id="assignees" className="scroll-mt-24">
              <DealAssigneesCard dealId={dealId} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
