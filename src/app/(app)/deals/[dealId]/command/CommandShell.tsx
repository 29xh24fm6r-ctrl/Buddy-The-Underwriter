import { headers } from "next/headers";
import type { DealContext } from "@/lib/deals/contextTypes";
import { DealHeader } from "./DealHeader";
import { StitchPanel } from "./StitchPanel";
import { ActionRail } from "./ActionRail";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";

export async function CommandShell({
  dealId,
  verify,
}: {
  dealId: string;
  verify: VerifyUnderwriteResult;
}) {
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;

  const contextRes = await fetch(`${origin}/api/deals/${dealId}/context`, {
    cache: "no-store",
    headers: { cookie: hdrs.get("cookie") ?? "" },
  });

  if (!contextRes.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg text-red-600">
          Error: Failed to load deal context
        </div>
      </div>
    );
  }

  const context = (await contextRes.json()) as DealContext;

  return (
    <div className="flex h-screen flex-col">
      {/* Native Header */}
      <DealHeader context={context} />

      {/* Hybrid Layout: Stitch Panel + Native Action Rail */}
      <div className="flex flex-1 overflow-hidden">
        {/* Stitch Panel (Read-only Intelligence) */}
        <div className="flex-1 overflow-auto border-r border-gray-200">
          <StitchPanel dealId={dealId} context={context} />
        </div>

        {/* Native Action Rail (Writes, Decisions) */}
        {verify.ok ? (
          <div className="w-96 overflow-auto bg-gray-50">
            <ActionRail dealId={dealId} context={context} verify={verify} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
