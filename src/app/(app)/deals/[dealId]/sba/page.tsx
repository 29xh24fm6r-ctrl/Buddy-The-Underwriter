import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SbaScoreCard } from "@/components/sba/SbaScoreCard";
import { SbaIssuesPanel } from "@/components/sba/SbaIssuesPanel";
import { SbaActionsPanel } from "@/components/sba/SbaActionsPanel";

export default async function DealSbaPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { userId } = await clerkAuth();
  if (!userId) return null;

  const { dealId } = await params;
  const sb = supabaseAdmin();

  const { data: preflight } = await (sb as any)
    .from("sba_preflight_results")
    .select("*")
    .eq("application_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">SBA Console</h1>

      <SbaScoreCard preflight={preflight} />
      <SbaIssuesPanel preflight={preflight} />
      <SbaActionsPanel dealId={dealId} preflight={preflight} />
    </div>
  );
}
