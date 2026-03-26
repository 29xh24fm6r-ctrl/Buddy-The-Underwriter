import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SpreadsPageClient } from "@/components/deals/spreads/SpreadsPageClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ dealId: string }> };

export default async function SpreadsPage({ params }: Props) {
  const { dealId } = await params;
  const sb = getSupabaseServerClient();

  const { data: deal } = await sb
    .from("deals")
    .select("id, display_name, name, deal_type")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal) notFound();

  const displayName =
    (deal as Record<string, unknown>).display_name as string ||
    (deal as Record<string, unknown>).name as string ||
    `Deal ${dealId.slice(0, 8)}`;

  return (
    <div className="min-h-screen bg-white">
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center">
            <div className="text-sm text-gray-400 animate-pulse">Loading spreads...</div>
          </div>
        }
      >
        <SpreadsPageClient
          dealId={dealId}
          dealName={displayName.trim()}
          dealType={((deal as Record<string, unknown>).deal_type as string) ?? null}
        />
      </Suspense>
    </div>
  );
}
