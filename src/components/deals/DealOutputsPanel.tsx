import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export function DealOutputsPanel({ dealId }: { dealId: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur shadow-[0_18px_50px_rgba(0,0,0,0.35)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="fact_check" className="h-5 w-5 text-white" />
        <h3 className="text-sm font-semibold text-white">Deal Outputs</h3>
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
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10"
        >
          <Icon name="checklist" className="h-4 w-4" />
          Conditions & Missing Docs
        </Link>
        <Link
          href={`/deals/${dealId}/readiness`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10"
        >
          <Icon name="event" className="h-4 w-4" />
          Readiness / SBA Cert
        </Link>
      </div>
    </div>
  );
}
