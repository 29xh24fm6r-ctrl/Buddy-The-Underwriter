import { createClient } from "@/lib/supabase/server";

export async function getDealProjection(dealId: string) {
  const supabase = createClient();

  const { data } = await supabase
    .from("ai_events")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  return {
    borrowerConnect: data?.find(e => e.kind === "borrower.connect.completed"),
    preapproval: data?.find(e => e.kind === "preapproval.result"),
    autopilot: data?.find(e => e.kind === "autopilot.run.completed"),
    readiness: data?.find(e => e.kind === "readiness.updated"),
    timeline: data ?? []
  };
}
