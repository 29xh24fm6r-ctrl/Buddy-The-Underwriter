"use client";

import { useEffect, useState } from "react";
import type { DealContext } from "@/lib/deals/contextTypes";
import { DealHeader } from "./DealHeader";
import { StitchPanel } from "./StitchPanel";
import { ActionRail } from "./ActionRail";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";

export function CommandShell({
  dealId,
  verify,
}: {
  dealId: string;
  verify: VerifyUnderwriteResult;
}) {
  const [context, setContext] = useState<DealContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/context`, {
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error(`Failed to load deal context: ${res.status}`);
        }

        const data = (await res.json()) as DealContext;
        setContext(data);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, [dealId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg text-gray-600">Loading deal context...</div>
      </div>
    );
  }

  if (error || !context) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg text-red-600">
          Error: {error ?? "Failed to load deal context"}
        </div>
      </div>
    );
  }

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
