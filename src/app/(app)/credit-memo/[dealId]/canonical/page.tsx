import "server-only";

import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import CanonicalMemoTemplate from "@/components/creditMemo/CanonicalMemoTemplate";
import ExportCanonicalMemoPdfButton from "@/components/creditMemo/ExportCanonicalMemoPdfButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CanonicalCreditMemoPage(props: {
  params: Promise<{ dealId: string }>;
}) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const { dealId } = await props.params;
  const bankId = await getCurrentBankId();

  const res = await buildCanonicalCreditMemo({ dealId, bankId });
  if (!res.ok) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white">Credit Memo (Canonical)</h1>
        <p className="mt-2 text-sm text-white/70">Unable to build memo: {res.error}</p>
      </div>
    );
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="mx-auto max-w-[980px] p-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#111418]">Credit Memo</h1>
            <div className="text-xs text-gray-500">Canonical v1 (deterministic)</div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/credit-memo/${dealId}/canonical/print`}
              className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50"
            >
              Print View
            </Link>
            <ExportCanonicalMemoPdfButton dealId={dealId} />
          </div>
        </div>

        <CanonicalMemoTemplate memo={res.memo} />
      </div>
    </div>
  );
}
