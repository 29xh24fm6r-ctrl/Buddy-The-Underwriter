import "server-only";

/**
 * Deduplication domain service — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR1.
 *
 * Cautious, explainable, rule-based duplicate detection (no fuzzy ML) —
 * every suggestion carries its confidence and the exact reasons it
 * matched, and nothing is ever merged automatically. A merge is always an
 * explicit, audited action (mergePeople/mergeOrganizations) that soft-
 * merges the losing record (merged_into_id/merged_at — never deleted) and
 * writes a full snapshot to crm_merge_log, so it's always inspectable and
 * the source record's history never disappears.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CrmPerson } from "./people";
import type { CrmOrganization } from "./organizations";
import type { SB } from "./types";

export type DuplicateCandidate<T> = {
  a: T;
  b: T;
  confidence: number;
  reasons: string[];
};

function normalizeName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeOrgName(s: string | null | undefined): string {
  return normalizeName(s).replace(/[.,]/g, "").replace(/\b(inc|llc|corp|co|ltd|company)\b\.?/g, "").trim();
}

export async function findDuplicatePeople(bankId: string, sb: SB = supabaseAdmin()): Promise<Array<DuplicateCandidate<CrmPerson>>> {
  const { data, error } = await sb
    .from("crm_people")
    .select("*")
    .eq("bank_id", bankId)
    .is("merged_into_id", null);
  if (error) throw new Error(`findDuplicatePeople failed: ${error.message}`);

  const people = (data ?? []) as CrmPerson[];
  const candidates: Array<DuplicateCandidate<CrmPerson>> = [];

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      const reasons: string[] = [];
      let confidence = 0;

      const emailA = normalizeName(a.email);
      const emailB = normalizeName(b.email);
      if (emailA && emailA === emailB) {
        reasons.push("exact email match");
        confidence = Math.max(confidence, 0.95);
      }

      const phoneA = (a.phone ?? a.mobile_phone ?? "").replace(/\D/g, "");
      const phoneB = (b.phone ?? b.mobile_phone ?? "").replace(/\D/g, "");
      if (phoneA.length >= 7 && phoneA === phoneB) {
        reasons.push("exact phone match");
        confidence = Math.max(confidence, 0.9);
      }

      const nameA = normalizeName(`${a.first_name ?? ""} ${a.last_name ?? ""}`);
      const nameB = normalizeName(`${b.first_name ?? ""} ${b.last_name ?? ""}`);
      if (nameA && nameA === nameB) {
        reasons.push("exact full-name match");
        confidence = Math.max(confidence, a.organization_id && a.organization_id === b.organization_id ? 0.75 : 0.5);
        if (a.organization_id && a.organization_id === b.organization_id) {
          reasons.push("same organization");
        }
      }

      if (reasons.length > 0) {
        candidates.push({ a, b, confidence, reasons });
      }
    }
  }

  return candidates.sort((x, y) => y.confidence - x.confidence);
}

export async function findDuplicateOrganizations(bankId: string, sb: SB = supabaseAdmin()): Promise<Array<DuplicateCandidate<CrmOrganization>>> {
  const { data, error } = await sb
    .from("crm_organizations")
    .select("*")
    .eq("bank_id", bankId)
    .is("merged_into_id", null);
  if (error) throw new Error(`findDuplicateOrganizations failed: ${error.message}`);

  const orgs = (data ?? []) as CrmOrganization[];
  const candidates: Array<DuplicateCandidate<CrmOrganization>> = [];

  for (let i = 0; i < orgs.length; i++) {
    for (let j = i + 1; j < orgs.length; j++) {
      const a = orgs[i];
      const b = orgs[j];
      const reasons: string[] = [];
      let confidence = 0;

      const nameA = normalizeName(a.name);
      const nameB = normalizeName(b.name);
      if (nameA && nameA === nameB) {
        reasons.push("exact name match");
        confidence = Math.max(confidence, 0.9);
      } else {
        const cleanA = normalizeOrgName(a.name);
        const cleanB = normalizeOrgName(b.name);
        if (cleanA && cleanA === cleanB) {
          reasons.push("same name ignoring suffix (Inc/LLC/Corp)");
          confidence = Math.max(confidence, 0.7);
        }
      }

      const siteA = normalizeName(a.website_url).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
      const siteB = normalizeName(b.website_url).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
      if (siteA && siteA === siteB) {
        reasons.push("same website");
        confidence = Math.max(confidence, 0.85);
      }

      if (reasons.length > 0) {
        candidates.push({ a, b, confidence, reasons });
      }
    }
  }

  return candidates.sort((x, y) => y.confidence - x.confidence);
}

export type MergeInput = {
  bankId: string;
  sourceId: string;
  targetId: string;
  mergedByClerkUserId: string;
  reason?: string | null;
};

export async function mergePeople(input: MergeInput, sb: SB = supabaseAdmin()): Promise<void> {
  if (input.sourceId === input.targetId) throw new Error("Cannot merge a person into itself.");

  const { data: source, error: sourceErr } = await sb
    .from("crm_people")
    .select("*")
    .eq("id", input.sourceId)
    .eq("bank_id", input.bankId)
    .single();
  if (sourceErr || !source) throw new Error(`mergePeople: source not found (${sourceErr?.message})`);

  const { data: target, error: targetErr } = await sb
    .from("crm_people")
    .select("id")
    .eq("id", input.targetId)
    .eq("bank_id", input.bankId)
    .single();
  if (targetErr || !target) throw new Error(`mergePeople: target not found (${targetErr?.message})`);

  // Repoint everything that references the source person, then soft-merge it.
  await sb.from("crm_person_organization_roles").update({ person_id: input.targetId }).eq("person_id", input.sourceId).eq("bank_id", input.bankId);
  await sb.from("crm_activities").update({ target_person_id: input.targetId }).eq("target_person_id", input.sourceId).eq("bank_id", input.bankId);
  await sb.from("deal_party_roles").update({ person_id: input.targetId }).eq("person_id", input.sourceId).eq("bank_id", input.bankId);
  await sb.from("deal_source_attribution").update({ referring_person_id: input.targetId }).eq("referring_person_id", input.sourceId).eq("bank_id", input.bankId);

  const { error: mergeErr } = await sb
    .from("crm_people")
    .update({ merged_into_id: input.targetId, merged_at: new Date().toISOString() })
    .eq("id", input.sourceId)
    .eq("bank_id", input.bankId);
  if (mergeErr) throw new Error(`mergePeople: failed to flag source merged (${mergeErr.message})`);

  const { error: logErr } = await sb.from("crm_merge_log").insert({
    bank_id: input.bankId,
    entity_type: "person",
    source_id: input.sourceId,
    target_id: input.targetId,
    merged_by_clerk_user_id: input.mergedByClerkUserId,
    reason: input.reason ?? null,
    source_snapshot: source,
  });
  if (logErr) throw new Error(`mergePeople: failed to write merge log (${logErr.message})`);
}

export async function mergeOrganizations(input: MergeInput, sb: SB = supabaseAdmin()): Promise<void> {
  if (input.sourceId === input.targetId) throw new Error("Cannot merge an organization into itself.");

  const { data: source, error: sourceErr } = await sb
    .from("crm_organizations")
    .select("*")
    .eq("id", input.sourceId)
    .eq("bank_id", input.bankId)
    .single();
  if (sourceErr || !source) throw new Error(`mergeOrganizations: source not found (${sourceErr?.message})`);

  const { data: target, error: targetErr } = await sb
    .from("crm_organizations")
    .select("id")
    .eq("id", input.targetId)
    .eq("bank_id", input.bankId)
    .single();
  if (targetErr || !target) throw new Error(`mergeOrganizations: target not found (${targetErr?.message})`);

  await sb.from("crm_people").update({ organization_id: input.targetId }).eq("organization_id", input.sourceId).eq("bank_id", input.bankId);
  await sb.from("crm_person_organization_roles").update({ organization_id: input.targetId }).eq("organization_id", input.sourceId).eq("bank_id", input.bankId);
  await sb.from("crm_activities").update({ target_organization_id: input.targetId }).eq("target_organization_id", input.sourceId).eq("bank_id", input.bankId);
  await sb.from("deal_party_roles").update({ organization_id: input.targetId }).eq("organization_id", input.sourceId).eq("bank_id", input.bankId);
  await sb.from("deal_source_attribution").update({ referring_organization_id: input.targetId }).eq("referring_organization_id", input.sourceId).eq("bank_id", input.bankId);
  await sb.from("deal_source_attribution").update({ co_broker_org_id: input.targetId }).eq("co_broker_org_id", input.sourceId).eq("bank_id", input.bankId);
  await sb.from("deals").update({ referral_source_org_id: input.targetId }).eq("referral_source_org_id", input.sourceId).eq("bank_id", input.bankId);
  await sb.from("brokerage_leads").update({ referral_source_org_id: input.targetId }).eq("referral_source_org_id", input.sourceId).eq("bank_id", input.bankId);

  const { error: mergeErr } = await sb
    .from("crm_organizations")
    .update({ merged_into_id: input.targetId, merged_at: new Date().toISOString() })
    .eq("id", input.sourceId)
    .eq("bank_id", input.bankId);
  if (mergeErr) throw new Error(`mergeOrganizations: failed to flag source merged (${mergeErr.message})`);

  const { error: logErr } = await sb.from("crm_merge_log").insert({
    bank_id: input.bankId,
    entity_type: "organization",
    source_id: input.sourceId,
    target_id: input.targetId,
    merged_by_clerk_user_id: input.mergedByClerkUserId,
    reason: input.reason ?? null,
    source_snapshot: source,
  });
  if (logErr) throw new Error(`mergeOrganizations: failed to write merge log (${logErr.message})`);
}
