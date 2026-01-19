// src/app/deals/[dealId]/DealWorkspaceClient.tsx
"use client";

import UploadBox from "@/components/deals/UploadBox";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import DealAssigneesCard from "@/components/deals/DealAssigneesCard";
import BankFormsCard from "@/components/deals/BankFormsCard";
import NextStepCard from "@/components/deals/NextStepCard";
import DealHeaderCard from "@/components/deals/DealHeaderCard";
import DealSetupCard from "@/components/deals/DealSetupCard";
import PackNavigatorCard from "@/components/deals/PackNavigatorCard";
import DocumentInsightsCard from "@/components/deals/DocumentInsightsCard";
import DraftMessagesCard from "@/components/deals/DraftMessagesCard";
import MissingDocsCard from "@/components/deals/MissingDocsCard";
import { ConditionsCard } from "@/components/deals/ConditionsCard";
import SbaPackageBuilderCard from "@/components/deals/SbaPackageBuilderCard";
import PolicyLensCard from "@/components/deals/PolicyLensCard";
import ConditionsToCloseCard from "@/components/deals/ConditionsToCloseCard";
import BorrowerPortalControlsCard from "@/components/deals/BorrowerPortalControlsCard";
import UploadInboxCard from "@/components/deals/UploadInboxCard";
import DealModals from "@/components/deals/DealModals";
import ApplyTemplatesButton from "@/components/deals/ApplyTemplatesButton";
import { BorrowerPackIntelligence } from "@/components/deals/BorrowerPackIntelligence";
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
              <ErrorBoundary context="UploadBox">
                <UploadBox dealId={dealId} />
              </ErrorBoundary>
            </div>

            <div id="jobs" className="scroll-mt-24">
              <ErrorBoundary context="DocumentInsights">
                <DocumentInsightsCard dealId={dealId} />
              </ErrorBoundary>
            </div>

            <div id="forms" className="scroll-mt-24">
              <BankFormsCard dealId={dealId} />
            </div>
          </div>

          {/* RIGHT RAIL */}
          <div className="col-span-12 space-y-4 lg:col-span-3">
            <NextStepCard dealId={dealId} />

            {/* Borrower Pack Intelligence */}
            <div id="pack-intelligence" className="scroll-mt-24">
              <BorrowerPackIntelligence dealId={dealId} />
            </div>

            {/* Apply Templates Button */}
            <ApplyTemplatesButton dealId={dealId} />

            <div id="borrower-portal" className="scroll-mt-24">
              <BorrowerPortalControlsCard dealId={dealId} />
            </div>

            <div id="upload-inbox" className="scroll-mt-24">
              <UploadInboxCard dealId={dealId} />
            </div>

            {/* Banker-ready: copy/paste missing docs + portal link */}
            <MissingDocsCard dealId={dealId} />

            <div id="conditions" className="scroll-mt-24">
              <ConditionsCard dealId={dealId} />
            </div>

            <div id="policy-lens" className="scroll-mt-24">
              <PolicyLensCard dealId={dealId} />
            </div>

            <div id="conditions-to-close" className="scroll-mt-24">
              <ConditionsToCloseCard dealId={dealId} />
            </div>

            <div id="sba-package" className="scroll-mt-24">
              <SbaPackageBuilderCard dealId={dealId} />
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
