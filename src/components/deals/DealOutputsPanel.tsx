import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export function DealOutputsPanel({ dealId }: { dealId: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="fact_check" className="h-5 w-5 text-neutral-900" />
        <h3 className="text-sm font-semibold">Deal Outputs</h3>
      </div>
      <div className="space-y-2">
        <Link
          href={`/credit-memo/${dealId}/draft`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-800"
        >
          <Icon name="file" className="h-4 w-4" />
          Credit Memo Draft
        </Link>
        <Link
          href={`/deals/${dealId}/conditions`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
        >
          <Icon name="checklist" className="h-4 w-4" />
          Conditions & Missing Docs
        </Link>
        <Link
          href={`/deals/${dealId}/readiness`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
        >
          <Icon name="event" className="h-4 w-4" />
          Readiness / SBA Cert
        </Link>
      </div>
    </div>
  );
}
