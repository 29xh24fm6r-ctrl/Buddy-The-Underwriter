import "server-only";

import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveDealLabel } from "@/lib/deals/dealLabel";
import { listTemplates, TEMPLATE_TRIGGER_KEYS } from "@/lib/comms/templates";
import { buildRevenueOperatingSystem, type RevenueOperatingSystem } from "@/lib/crm/revenueOperatingSystem";

/**
 * One authoritative brokerage operating snapshot.
 *
 * Every executive surface must call this loader so "active", pipeline value,
 * lender movement, and setup readiness cannot drift between pages.
 */
export async function loadRevenueOperatingSystem(): Promise<RevenueOperatingSystem> {
  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const [dealResult, taskResult, leadResult, organizationResult, peopleResult, profileResult, submissionResult, templates] = await Promise.all([
    sb.from("deals").select("id, display_name, nickname, borrower_name, name, loan_amount, brokerage_stage, brokerage_stage_entered_at, brokerage_stage_owner_clerk_user_id, is_test").eq("bank_id", bankId).is("archived_at", null).order("created_at", { ascending: false }).limit(500),
    sb.from("brokerage_tasks").select("id, deal_id, title, due_at, status").eq("bank_id", bankId).not("deal_id", "is", null).in("status", ["open", "in_progress", "blocked"]).order("due_at", { ascending: true, nullsFirst: false }).limit(500),
    sb.from("brokerage_leads").select("id, business_name, first_name, last_name, email, status, loan_amount_requested, next_action, next_action_due_at").eq("bank_id", bankId).order("created_at", { ascending: false }).limit(500),
    sb.from("crm_organizations").select("id, name, owner_clerk_user_id").eq("bank_id", bankId).is("merged_into_id", null).limit(500),
    sb.from("crm_people").select("id, organization_id").eq("bank_id", bankId).is("merged_into_id", null).limit(500),
    sb.from("crm_lender_profiles").select("id, organization_id, sba_7a_appetite, sba_504_appetite, conventional_appetite, geography_mode, state_codes, geographies").eq("bank_id", bankId).limit(500),
    sb.from("crm_deal_lender_submissions").select("deal_id, lender_profile_id, status").eq("bank_id", bankId).limit(1000),
    listTemplates(bankId),
  ]);

  const namedResults = [
    ["deals", dealResult],
    ["tasks", taskResult],
    ["leads", leadResult],
    ["organizations", organizationResult],
    ["people", peopleResult],
    ["lenders", profileResult],
    ["placements", submissionResult],
  ] as const;
  const failed = namedResults.find(([, result]) => result.error);
  if (failed?.[1].error) throw new Error(`brokerage_snapshot_${failed[0]}_failed`);

  const tasksByDeal = new Map<string, any>();
  for (const task of taskResult.data ?? []) if (task.deal_id && !tasksByDeal.has(task.deal_id)) tasksByDeal.set(task.deal_id, task);
  const submissionsByDeal = new Map<string, number>();
  for (const submission of submissionResult.data ?? []) {
    if (submission.status === "planned") continue;
    submissionsByDeal.set(submission.deal_id, (submissionsByDeal.get(submission.deal_id) ?? 0) + 1);
  }
  const peopleByOrganization = new Map<string, number>();
  for (const person of peopleResult.data ?? []) if (person.organization_id) peopleByOrganization.set(person.organization_id, (peopleByOrganization.get(person.organization_id) ?? 0) + 1);
  const organizations = organizationResult.data ?? [];
  const organizationNames = new Map(organizations.map((organization) => [organization.id, organization.name]));
  const activeSubmissions = (submissionResult.data ?? []).filter((submission) => !["declined", "withdrawn", "lost", "closed"].includes(submission.status)).length;

  return buildRevenueOperatingSystem({
    deals: (dealResult.data ?? []).filter((deal) => !deal.is_test).map((deal) => {
      const label = resolveDealLabel(deal);
      const task = tasksByDeal.get(deal.id);
      return {
        id: deal.id,
        title: label.label,
        borrower: deal.borrower_name ?? deal.name ?? null,
        amount: Number(deal.loan_amount ?? 0) || null,
        stage: deal.brokerage_stage ?? null,
        stageEnteredAt: deal.brokerage_stage_entered_at ?? null,
        ownerClerkUserId: deal.brokerage_stage_owner_clerk_user_id ?? null,
        banksSent: submissionsByDeal.get(deal.id) ?? 0,
        nextTask: task ? { id: task.id, title: task.title, dueAt: task.due_at ?? null } : null,
      };
    }),
    leads: leadResult.data ?? [],
    organizations: organizations.map((organization) => ({ id: organization.id, name: organization.name, ownerClerkUserId: organization.owner_clerk_user_id ?? null })),
    unlinkedPeople: (peopleResult.data ?? []).filter((person) => !person.organization_id).length,
    lenders: (profileResult.data ?? []).map((profile) => ({
      id: profile.id,
      name: organizationNames.get(profile.organization_id) ?? "Unnamed lender",
      hasAppetite: !!(profile.sba_7a_appetite || profile.sba_504_appetite || profile.conventional_appetite),
      hasGeography: profile.geography_mode === "nationwide" || (profile.state_codes ?? []).length > 0 || (profile.geographies ?? []).length > 0,
      contactCount: peopleByOrganization.get(profile.organization_id) ?? 0,
    })),
    activeSubmissions,
    templates: { active: templates.filter((template) => template.active).length, possible: TEMPLATE_TRIGGER_KEYS.length * 2 },
  });
}
