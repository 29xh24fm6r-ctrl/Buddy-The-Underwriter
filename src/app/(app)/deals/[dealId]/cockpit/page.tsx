import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import DealCockpitClient from "@/components/deals/DealCockpitClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: { dealId: string };
};

export default async function DealCockpitPage({ params }: Props) {
  const { userId } = await auth();

  if (!userId) {
    // If you prefer hard redirect, uncomment:
    // redirect("/sign-in");

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
          Preview mode (signed out). Deal:{" "}
          <span className="font-mono">{params.dealId}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border-dark bg-[#0f1115] p-4">
            <div className="font-medium mb-1">Intake</div>
            <div className="text-sm text-muted-foreground">
              Sign in to view intake + request composer.
            </div>
          </div>
          <div className="rounded-xl border border-border-dark bg-[#0f1115] p-4">
            <div className="font-medium mb-1">Checklist & Uploads</div>
            <div className="text-sm text-muted-foreground">
              Sign in to view checklist, files, audit, and links.
            </div>
          </div>
        </div>
      </div>
    );  }

  if (!params?.dealId || params.dealId === "undefined") {
    throw new Error(`[DealCockpitPage] invalid dealId param: ${String(params?.dealId)}`);
  }

  return <DealCockpitClient dealId={params.dealId} />;
}
