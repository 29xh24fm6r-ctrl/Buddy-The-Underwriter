import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import DealIntakeCard from "@/components/deals/DealIntakeCard";
import BorrowerRequestComposerCard from "@/components/deals/BorrowerRequestComposerCard";
import DealChecklistCard from "@/components/deals/DealChecklistCard";
import DealFilesCard from "@/components/deals/DealFilesCard";
import BorrowerUploadLinksCard from "@/components/deals/BorrowerUploadLinksCard";
import UploadAuditCard from "@/components/deals/UploadAuditCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ dealId: string }>;
};

export default async function DealCockpitPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) {
    const { dealId } = await params;
    return (
      <div className="container mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Deal Cockpit</h1>
          <a
            href="/sign-in"
            className="px-3 py-2 rounded-md border border-border-dark bg-[#111418] hover:bg-[#151a20] text-sm"
          >
            Sign in to enable actions
          </a>
        </div>

        <div className="text-sm text-muted-foreground">
          Preview mode (signed out). Deal: <span className="font-mono">{dealId}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border-dark bg-[#0f1115] p-4">
            <div className="font-medium mb-1">Intake</div>
            <div className="text-sm text-muted-foreground">Sign in to view intake + request composer.</div>
          </div>
          <div className="rounded-xl border border-border-dark bg-[#0f1115] p-4">
            <div className="font-medium mb-1">Checklist & Uploads</div>
            <div className="text-sm text-muted-foreground">Sign in to view checklist, files, audit, and links.</div>
          </div>
        </div>
      </div>
    );
  }

  const { dealId } = await params;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Deal Cockpit</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          <DealIntakeCard dealId={dealId} />
          <BorrowerRequestComposerCard dealId={dealId} />
          <DealFilesCard dealId={dealId} />
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <BorrowerUploadLinksCard dealId={dealId} />
          <DealChecklistCard dealId={dealId} />
          <UploadAuditCard dealId={dealId} />
        </div>
      </div>
    </div>
  );
}
