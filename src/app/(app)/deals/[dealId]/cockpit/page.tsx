import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import dynamic from "next/dynamic";

const DealCockpitClient = dynamic(
  () => import("@/components/deals/DealCockpitClient").then((m) => m.DealCockpitClient),
  {
    // Prevent hydration mismatch crashes from taking down cockpit interactivity.
    ssr: false,
    loading: () => (
      <div className="container mx-auto p-6">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
          Loading cockpit…
        </div>
      </div>
    ),
  },
);

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

  return <DealCockpitClient dealId={dealId} />;
}
