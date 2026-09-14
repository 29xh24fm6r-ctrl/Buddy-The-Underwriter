import { columnForStage, daysInStage, isParked, isStalled } from "@/lib/dealStage/board";
import { CLOSED_LEADS, leadTitle, type LeadSnapshot } from "@/lib/crm/workspaceModel";

export type RevenueDeal = {
  id: string;
  title: string;
  borrower: string | null;
  amount: number | null;
  stage: string | null;
  stageEnteredAt: string | null;
  ownerClerkUserId: string | null;
  banksSent: number;
  nextTask: { id: string; title: string; dueAt: string | null } | null;
};

export type RevenueOrganization = {
  id: string;
  name: string;
  ownerClerkUserId: string | null;
};

export type RevenueLender = {
  id: string;
  name: string;
  hasAppetite: boolean;
  hasGeography: boolean;
  contactCount: number;
};

export type RevenueTemplateCoverage = {
  active: number;
  possible: number;
};

export type RevenueOperatingSystem = ReturnType<typeof buildRevenueOperatingSystem>;

const money = (value: number | null | undefined) => Number(value ?? 0) || 0;
const coverage = (ready: number, total: number) => total === 0 ? 100 : Math.round((ready / total) * 100);

export function buildRevenueOperatingSystem(input: {
  deals: RevenueDeal[];
  leads: LeadSnapshot[];
  organizations: RevenueOrganization[];
  unlinkedPeople: number;
  lenders: RevenueLender[];
  activeSubmissions: number;
  templates: RevenueTemplateCoverage;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const activeDeals = input.deals.filter(
    (deal) => !isParked(deal.stage) && !["funded", "post_close"].includes(deal.stage ?? ""),
  );
  const activeLeads = input.leads.filter((lead) => !CLOSED_LEADS.has(lead.status));
  const convertedLeads = input.leads.filter((lead) => lead.status === "converted");
  const unassignedDeals = activeDeals.filter((deal) => !deal.ownerClerkUserId);
  const dealsWithoutNextAction = activeDeals.filter((deal) => !deal.nextTask);
  const stalledDeals = activeDeals.filter((deal) => isStalled(deal.stage, deal.stageEnteredAt, now));
  const unassignedOrganizations = input.organizations.filter((organization) => !organization.ownerClerkUserId);
  const incompleteLenders = input.lenders.filter(
    (lender) => !lender.hasAppetite || !lender.hasGeography || lender.contactCount === 0,
  );
  const templatePercent = input.templates.possible
    ? Math.round((input.templates.active / input.templates.possible) * 100)
    : 0;
  const momentumSignals = [
    { id: "deal-owners", label: "Deal ownership", href: "/admin/brokerage/pipeline?owner=unassigned", percent: coverage(activeDeals.length - unassignedDeals.length, activeDeals.length), detail: `${activeDeals.length - unassignedDeals.length} of ${activeDeals.length} active deals assigned` },
    { id: "next-actions", label: "Next-action coverage", href: "/admin/brokerage/pipeline?attention=1", percent: coverage(activeDeals.length - dealsWithoutNextAction.length, activeDeals.length), detail: `${activeDeals.length - dealsWithoutNextAction.length} of ${activeDeals.length} active deals ready to move` },
    { id: "relationship-owners", label: "Relationship ownership", href: "/admin/brokerage/crm?view=relationships&owner=unassigned", percent: coverage(input.organizations.length - unassignedOrganizations.length, input.organizations.length), detail: `${input.organizations.length - unassignedOrganizations.length} of ${input.organizations.length} companies assigned` },
    { id: "lender-readiness", label: "Lender intelligence", href: "/admin/brokerage/crm/buyers", percent: input.lenders.length ? coverage(input.lenders.length - incompleteLenders.length, input.lenders.length) : 0, detail: input.lenders.length ? `${input.lenders.length - incompleteLenders.length} of ${input.lenders.length} lender profiles ready` : "Add the first lender profile" },
    { id: "message-readiness", label: "Message readiness", href: "/admin/brokerage/crm/templates", percent: templatePercent, detail: `${input.templates.active} of ${input.templates.possible} approved templates active` },
  ];
  const momentumPercent = Math.round(momentumSignals.reduce((sum, signal) => sum + signal.percent, 0) / momentumSignals.length);
  const momentumLevels = [
    { name: "Launchpad", at: 0 },
    { name: "Building momentum", at: 20 },
    { name: "Deal flow", at: 40 },
    { name: "High velocity", at: 60 },
    { name: "Elite operator", at: 80 },
    { name: "Brokerage mastery", at: 100 },
  ];
  const levelIndex = momentumLevels.reduce((current, level, index) => momentumPercent >= level.at ? index : current, 0);
  const nextLevel = momentumLevels[levelIndex + 1] ?? null;

  const work = activeDeals
    .map((deal) => {
      const reasons: string[] = [];
      if (!deal.ownerClerkUserId) reasons.push("Needs an owner");
      if (!deal.nextTask) reasons.push("No next action");
      if (isStalled(deal.stage, deal.stageEnteredAt, now)) reasons.push("Stalled in stage");
      const overdue = !!deal.nextTask?.dueAt && Date.parse(deal.nextTask.dueAt) < now.getTime();
      if (overdue) reasons.push("Task overdue");
      const severity = !deal.ownerClerkUserId || !deal.nextTask || overdue ? "critical" : reasons.length ? "warning" : "healthy";
      return {
        id: deal.id,
        title: deal.title,
        borrower: deal.borrower,
        amount: deal.amount,
        stage: deal.stage ?? "intake",
        stageGroup: columnForStage(deal.stage),
        daysInStage: daysInStage(deal.stageEnteredAt, now),
        ownerClerkUserId: deal.ownerClerkUserId,
        nextTask: deal.nextTask,
        banksSent: deal.banksSent,
        reasons,
        severity,
      };
    })
    .filter((item) => item.reasons.length)
    .sort((a, b) => {
      const rank = { critical: 0, warning: 1, healthy: 2 } as const;
      return rank[a.severity as keyof typeof rank] - rank[b.severity as keyof typeof rank]
        || (b.amount ?? 0) - (a.amount ?? 0)
        || a.title.localeCompare(b.title);
    });

  const funnel = ["qualifying", "packaging", "out_to_banks", "term_sheet", "closing", "funded"].map((id) => {
    const rows = input.deals.filter((deal) => columnForStage(deal.stage) === id);
    return { id, count: rows.length, value: rows.reduce((sum, deal) => sum + money(deal.amount), 0) };
  });

  const setup = [
    {
      id: "owners",
      label: "Assign every active deal",
      complete: unassignedDeals.length === 0,
      detail: unassignedDeals.length ? `${unassignedDeals.length} deal${unassignedDeals.length === 1 ? "" : "s"} need an owner` : "Every active deal has an owner",
      href: "/admin/brokerage/pipeline?owner=unassigned",
    },
    {
      id: "actions",
      label: "Give every deal a next action",
      complete: dealsWithoutNextAction.length === 0,
      detail: dealsWithoutNextAction.length ? `${dealsWithoutNextAction.length} deal${dealsWithoutNextAction.length === 1 ? "" : "s"} need a next action` : "Every active deal has a next action",
      href: "/admin/brokerage/pipeline?attention=1",
    },
    {
      id: "relationships",
      label: "Assign relationship ownership",
      complete: unassignedOrganizations.length === 0,
      detail: unassignedOrganizations.length ? `${unassignedOrganizations.length} compan${unassignedOrganizations.length === 1 ? "y" : "ies"} need an owner` : "Every company has an owner",
      href: "/admin/brokerage/crm?view=relationships&owner=unassigned",
    },
    {
      id: "lenders",
      label: "Complete lender intelligence",
      complete: input.lenders.length > 0 && incompleteLenders.length === 0,
      detail: input.lenders.length === 0 ? "Add your first lender" : incompleteLenders.length ? `${incompleteLenders.length} lender profile${incompleteLenders.length === 1 ? "" : "s"} need attention` : "Lender appetite, geography, and contacts are ready",
      href: "/admin/brokerage/crm/buyers",
    },
    {
      id: "templates",
      label: "Prepare client communications",
      complete: templatePercent === 100,
      detail: `${input.templates.active} of ${input.templates.possible} email and SMS templates active`,
      href: "/admin/brokerage/crm/templates",
    },
    {
      id: "placements",
      label: "Start lender distribution",
      complete: input.activeSubmissions > 0 || activeDeals.length === 0,
      detail: input.activeSubmissions ? `${input.activeSubmissions} active lender placement${input.activeSubmissions === 1 ? "" : "s"}` : "No active lender placements",
      href: "/admin/brokerage/crm/buyers",
    },
  ];

  const knownStageAges = activeDeals
    .map((deal) => daysInStage(deal.stageEnteredAt, now))
    .filter((age): age is number => age !== null);
  const criticalDealIds = new Set(work.filter((item) => item.severity === "critical").map((item) => item.id));
  const overdueDealIds = new Set(work.filter((item) => item.reasons.includes("Task overdue")).map((item) => item.id));

  return {
    generatedAt: now.toISOString(),
    metrics: {
      activeDeals: activeDeals.length,
      pipelineValue: activeDeals.reduce((sum, deal) => sum + money(deal.amount), 0),
      needsAttention: work.length,
      unassignedDeals: unassignedDeals.length,
      activeLeads: activeLeads.length,
      convertedLeads: convertedLeads.length,
      relationships: input.organizations.length,
      activeSubmissions: input.activeSubmissions,
    },
    health: {
      stalledDeals: stalledDeals.length,
      dealsWithoutNextAction: dealsWithoutNextAction.length,
      unassignedOrganizations: unassignedOrganizations.length,
      unlinkedPeople: input.unlinkedPeople,
      incompleteLenders: incompleteLenders.length,
      templatePercent,
    },
    executive: {
      ownershipCoverage: coverage(activeDeals.length - unassignedDeals.length, activeDeals.length),
      nextActionCoverage: coverage(activeDeals.length - dealsWithoutNextAction.length, activeDeals.length),
      averageStageAgeDays: knownStageAges.length ? Math.round(knownStageAges.reduce((sum, age) => sum + age, 0) / knownStageAges.length) : null,
      criticalPipelineValue: activeDeals.filter((deal) => criticalDealIds.has(deal.id)).reduce((sum, deal) => sum + money(deal.amount), 0),
      distributedDeals: activeDeals.filter((deal) => deal.banksSent > 0).length,
      overdueDeals: overdueDealIds.size,
    },
    funnel,
    setup: {
      complete: setup.filter((item) => item.complete).length,
      total: setup.length,
      items: setup,
    },
    momentum: {
      percent: momentumPercent,
      level: momentumLevels[levelIndex].name,
      levelNumber: levelIndex + 1,
      nextLevel: nextLevel?.name ?? null,
      nextLevelAt: nextLevel?.at ?? 100,
      signals: momentumSignals.map((signal) => ({
        ...signal,
        potential: Math.ceil((100 - signal.percent) / momentumSignals.length),
      })),
    },
    work,
    leads: activeLeads.slice(0, 12).map((lead) => ({
      id: lead.id,
      title: leadTitle(lead),
      status: lead.status,
      nextAction: lead.next_action ?? null,
      dueAt: lead.next_action_due_at ?? null,
    })),
  };
}
