import type { ReactNode } from "react";
import DealHeroBar from "../_components/DealHeroBar";
import DealLeftRail from "../_components/DealLeftRail";

export default async function DealShellLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  // TODO: wire real deal fetch; mocked for release readiness
  const borrowerName = "Acme Logistics LLC";
  const status = "In underwriting";

  return (
    <div className="min-h-screen bg-[#0b0d10]">
      <DealHeroBar dealId={dealId} borrowerName={borrowerName} status={status} />

      <div className="mx-auto max-w-[1400px]">
        <div className="flex">
          <DealLeftRail dealId={dealId} />

          {/* Workspace bounds:
              - prevents Stitch exports from going full-viewport
              - normalizes padding & width
           */}
          <main className="min-w-0 flex-1 px-4 py-4">
            <div className="rounded-2xl border border-border-dark bg-[#0f1115] p-4 shadow-sm">
              <div className="min-h-[calc(100vh-8rem)]">
                {children}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
