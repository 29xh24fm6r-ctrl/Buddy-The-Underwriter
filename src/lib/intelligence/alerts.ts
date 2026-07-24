import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  findLeadStale,
  findTaskOverdue,
  findConditionOverdue,
  findLenderResponseMissing,
  findReferralRelationshipStale,
  findDocumentMissing,
  type TriggerFinding,
} from "@/lib/automation/triggers";
import { findFundedDealsMissingVerification } from "./revenue";
import { listAlertFeedback, buildFeedbackLookup } from "./alertFeedback";
import type { AlertEntityType, IntelligenceAlert, Severity, SB } from "./types";

/**
 * Explainable intelligence — spec section 7.7. Every alert here is
 * derived from a deterministic finder already built in PR2-PR4 (lead SLA,
 * deal-stage queues, automation triggers) or the funding-verification gap
 * added in revenue.ts — this file adds no new "is something wrong" logic
 * of its own, only the explainability wrapper (severity/evidence/owner/
 * due date/source rule/action route) and dismiss/snooze filtering the
 * spec requires around whatever a finder already found.
 */

type AlertSpec = {
  alertKey: string;
  entityType: AlertEntityType;
  severity: Severity;
  titleFor: (f: TriggerFinding) => string;
  recommendation: string;
  sourceRule: string;
  actionRouteFor: (f: TriggerFinding) => string;
  evidenceFor: (f: TriggerFinding) => string[];
};

const SPECS: AlertSpec[] = [
  {
    alertKey: "lead_stale",
    entityType: "lead",
    severity: "high",
    titleFor: () => "Lead needs contact",
    recommendation: "Attempt contact with this lead today — it has exceeded the first-contact or next-action SLA.",
    sourceRule: "lead_sla.isOverdue (src/lib/leads/sla.ts)",
    actionRouteFor: (f) => `/admin/brokerage/crm/leads/${f.entityId}`,
    evidenceFor: (f) => Object.entries(f.context).map(([k, v]) => `${k}: ${String(v)}`),
  },
  {
    alertKey: "task_overdue",
    entityType: "task",
    severity: "medium",
    titleFor: () => "Task overdue",
    recommendation: "Complete or reassign this task — its due date has passed.",
    sourceRule: "brokerage_tasks.due_at < now() (src/lib/automation/triggers.ts:findTaskOverdue)",
    actionRouteFor: (f) => `/admin/brokerage/deals/${(f.context as { dealId?: string }).dealId ?? ""}`,
    evidenceFor: (f) => Object.entries(f.context).map(([k, v]) => `${k}: ${String(v)}`),
  },
  {
    alertKey: "condition_overdue",
    entityType: "deal",
    severity: "high",
    titleFor: () => "Underwriting condition overdue",
    recommendation: "Follow up on this outstanding closing condition — its due date has passed.",
    sourceRule: "brokerage_closing_conditions.due_date < now() (src/lib/automation/triggers.ts:findConditionOverdue)",
    actionRouteFor: (f) => `/admin/brokerage/deals/${f.entityId}`,
    evidenceFor: (f) => Object.entries(f.context).map(([k, v]) => `${k}: ${String(v)}`),
  },
  {
    alertKey: "lender_response_missing",
    entityType: "deal",
    severity: "high",
    titleFor: () => "Lender has not responded",
    recommendation: "Follow up with the lender — this deal has been in 'submitted' for over 7 days with no stage change.",
    sourceRule: "deals.brokerage_stage='submitted' aged >7d (src/lib/automation/triggers.ts:findLenderResponseMissing)",
    actionRouteFor: (f) => `/admin/brokerage/deals/${f.entityId}`,
    evidenceFor: (f) => Object.entries(f.context).map(([k, v]) => `${k}: ${String(v)}`),
  },
  {
    alertKey: "referral_relationship_stale",
    entityType: "person",
    severity: "medium",
    titleFor: () => "Referral relationship going cold",
    recommendation: "Reach out to this referral contact — there has been no contact in over 60 days.",
    sourceRule: "crm_people.last_contacted_at aged >60d (src/lib/automation/triggers.ts:findReferralRelationshipStale)",
    actionRouteFor: (f) => `/admin/brokerage/crm/people/${f.entityId}`,
    evidenceFor: (f) => Object.entries(f.context).map(([k, v]) => `${k}: ${String(v)}`),
  },
  {
    alertKey: "document_missing",
    entityType: "deal",
    severity: "critical",
    titleFor: () => "Required document missing",
    recommendation: "Request the missing document from the borrower — it is blocking this deal's progress.",
    sourceRule: "src/lib/automation/triggers.ts:findDocumentMissing",
    actionRouteFor: (f) => `/admin/brokerage/deals/${f.entityId}`,
    evidenceFor: (f) => Object.entries(f.context).map(([k, v]) => `${k}: ${String(v)}`),
  },
];

async function findFundingVerificationAlerts(bankId: string, sb: SB): Promise<TriggerFinding[]> {
  const dealIds = await findFundedDealsMissingVerification(bankId, sb);
  return dealIds.map((id) => ({ entityType: "deal", entityId: id, dedupeKey: new Date().toISOString().slice(0, 10), context: {} }));
}

const FINDERS: Record<string, (bankId: string, sb: SB) => Promise<TriggerFinding[]>> = {
  lead_stale: findLeadStale,
  task_overdue: findTaskOverdue,
  condition_overdue: findConditionOverdue,
  lender_response_missing: findLenderResponseMissing,
  referral_relationship_stale: (bankId, sb) => findReferralRelationshipStale(bankId, 60, sb),
  document_missing: findDocumentMissing,
  funding_verification_missing: findFundingVerificationAlerts,
};

const FUNDING_VERIFICATION_SPEC: AlertSpec = {
  alertKey: "funding_verification_missing",
  entityType: "deal",
  severity: "medium",
  titleFor: () => "Funded deal missing revenue verification",
  recommendation: "Record a funding verification for this deal so its revenue can be recognized.",
  sourceRule: "deals.brokerage_stage='funded' with no verified brokerage_funding_verifications row (src/lib/intelligence/revenue.ts:findFundedDealsMissingVerification)",
  actionRouteFor: (f) => `/admin/brokerage/deals/${f.entityId}`,
  evidenceFor: () => ["Deal is in a funded stage with no recorded funding verification."],
};

const ALL_SPECS = [...SPECS, FUNDING_VERIFICATION_SPEC];

export async function computeIntelligenceAlerts(bankId: string, userId: string | null = null, sb: SB = supabaseAdmin()): Promise<IntelligenceAlert[]> {
  const feedbackRows = await listAlertFeedback(bankId, sb);
  const lookup = buildFeedbackLookup(feedbackRows);

  const alerts: IntelligenceAlert[] = [];
  for (const spec of ALL_SPECS) {
    const finder = FINDERS[spec.alertKey];
    const findings = await finder(bankId, sb);
    for (const finding of findings) {
      const teamKey = `${spec.entityType}:${finding.entityId}:${spec.alertKey}:`;
      const personalKey = userId ? `${spec.entityType}:${finding.entityId}:${spec.alertKey}:${userId}` : null;
      const feedback = (personalKey && lookup.get(personalKey)) || lookup.get(teamKey);
      alerts.push({
        alertKey: spec.alertKey,
        entityType: spec.entityType,
        entityId: finding.entityId,
        title: spec.titleFor(finding),
        recommendation: spec.recommendation,
        severity: spec.severity,
        dueDate: (finding.context as { dueAt?: string; dueDate?: string }).dueAt ?? (finding.context as { dueDate?: string }).dueDate ?? null,
        owner: null,
        evidence: spec.evidenceFor(finding),
        sourceRule: spec.sourceRule,
        actionRoute: spec.actionRouteFor(finding),
        feedbackState: feedback?.state ?? null,
        snoozedUntil: feedback?.snoozed_until ?? null,
      });
    }
  }

  const active = alerts.filter((a) => a.feedbackState !== "dismissed" && a.feedbackState !== "snoozed");
  const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return active.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}
