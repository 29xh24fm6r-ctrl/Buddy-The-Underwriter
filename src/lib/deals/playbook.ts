// src/lib/deals/playbook.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export type BorrowerPlaybook = {
  stage: string;
  borrower_title: string;
  borrower_steps: string[];
};

export async function getBorrowerPlaybookForStage(stage: string): Promise<BorrowerPlaybook | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_stage_playbook")
    .select("stage, borrower_title, borrower_steps")
    .eq("stage", stage)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const steps = Array.isArray(data.borrower_steps) ? data.borrower_steps : [];
  return {
    stage: data.stage,
    borrower_title: data.borrower_title,
    borrower_steps: steps as string[],
  };
}
