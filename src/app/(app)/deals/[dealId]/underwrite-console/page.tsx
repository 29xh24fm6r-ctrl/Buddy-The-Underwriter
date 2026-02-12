import "server-only";

import { Suspense } from "react";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import UnderwriteConsole from "@/components/underwrite/UnderwriteConsole";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ dealId: string }> };

export default async function UnderwriteConsolePage({ params }: Props) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const { dealId } = await params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="p-10 text-center text-sm text-red-600">
        {access.error === "deal_not_found" ? "Deal not found" : "Access denied"}
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="p-10 text-center text-sm text-slate-400">
          Loading...
        </div>
      }
    >
      <UnderwriteConsole dealId={dealId} bankId={access.bankId} />
    </Suspense>
  );
}
