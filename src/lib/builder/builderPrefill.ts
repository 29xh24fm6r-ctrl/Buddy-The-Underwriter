import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BuilderPrefill,
  BorrowerCard,
  DealSectionData,
  BusinessSectionData,
  StorySectionData,
} from "./builderTypes";

const PLACEHOLDER_NAMES = new Set([
  "Unassigned Owner",
  "Unassigned Business",
  "Unknown Owner",
  "Unknown Business",
]);

/**
 * Load prefill data for the Deal Builder.
 * Sequential queries — no FK-dependent joins.
 * Only fills null/empty fields. Saved builder data always wins.
 */
export async function loadBuilderPrefill(
  dealId: string,
  sb: SupabaseClient,
): Promise<BuilderPrefill> {
  const sources: Record<string, "buddy" | "manual"> = {};

  // 1. deals → name, loan_amount, stage
  const { data: dealRow } = await sb
    .from("deals")
    .select("name, loan_amount, stage, borrower_name")
    .eq("id", dealId)
    .maybeSingle();

  const deal: Partial<DealSectionData> = {};
  if (dealRow?.loan_amount) {
    deal.requested_amount = Number(dealRow.loan_amount);
    sources["deal.requested_amount"] = "buddy";
  }

  // 2. ownership_entities → all rows for deal_id
  const { data: entities } = await sb
    .from("ownership_entities")
    .select("id, display_name, entity_type, ownership_pct, title")
    .eq("deal_id", dealId);

  let owners: Partial<BorrowerCard>[] = (entities ?? []).map((e: any) => {
    sources[`owners.${e.id}.full_legal_name`] = "buddy";
    return {
      id: e.id,
      ownership_entity_id: e.id,
      full_legal_name: (e.display_name ?? "").split(/[\n\r]+/)[0].trim() || undefined,
      ownership_pct: e.ownership_pct != null ? Number(e.ownership_pct) : undefined,
      title: e.title ?? undefined,
    };
  });

  if (owners.length === 0) {
    const { data: dealEntities } = await sb
      .from("deal_entities")
      .select("id, entity_kind, name, legal_name, role, entity_type")
      .eq("deal_id", dealId)
      .eq("entity_kind", "PERSON");

    owners = (dealEntities ?? [])
      .filter((e: any) => {
        const displayName: string = (e.name ?? e.legal_name ?? "").trim();
        return displayName.length > 0 && !PLACEHOLDER_NAMES.has(displayName);
      })
      .map((e: any) => {
        const displayName: string = (e.name ?? e.legal_name ?? "").trim();
        sources[`owners.${e.id}.full_legal_name`] = "buddy";
        return {
          id: e.id,
          ownership_entity_id: undefined,
          full_legal_name: displayName || undefined,
          title: e.role ?? undefined,
        };
      });
  }

  // 3. deal_memo_overrides → existing overrides
  const { data: overridesRow } = await sb
    .from("deal_memo_overrides")
    .select("overrides")
    .eq("deal_id", dealId)
    .maybeSingle();

  const overrides = (overridesRow as any)?.overrides as Record<string, unknown> | null;

  const story: Partial<StorySectionData> = {};
  if (overrides) {
    if (typeof overrides.use_of_proceeds === "string" && overrides.use_of_proceeds.trim()) {
      story.loan_purpose_narrative = overrides.use_of_proceeds as string;
      sources["story.loan_purpose_narrative"] = "manual";
    }
    if (typeof overrides.principal_background === "string" && overrides.principal_background.trim()) {
      story.management_qualifications = overrides.principal_background as string;
      sources["story.management_qualifications"] = "manual";
    }
    if (typeof overrides.competitive_position === "string" && overrides.competitive_position.trim()) {
      story.competitive_position = overrides.competitive_position as string;
      sources["story.competitive_position"] = "manual";
    }
    if (typeof overrides.key_weaknesses === "string" && overrides.key_weaknesses.trim()) {
      story.known_weaknesses = overrides.key_weaknesses as string;
      sources["story.known_weaknesses"] = "manual";
    }
    if (typeof overrides.key_strengths === "string" && overrides.key_strengths.trim()) {
      story.deal_strengths = overrides.key_strengths as string;
      sources["story.deal_strengths"] = "manual";
    }
    if (typeof overrides.committee_notes === "string" && overrides.committee_notes.trim()) {
      story.committee_notes = overrides.committee_notes as string;
      sources["story.committee_notes"] = "manual";
    }
  }

  // 4. deal_financial_facts → ENTITY_TYPE, DATE_FORMED
  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, fact_value_text, fact_value_num")
    .eq("deal_id", dealId)
    .in("fact_key", ["ENTITY_TYPE", "DATE_FORMED"]);

  const business: Partial<BusinessSectionData> = {};
  if (dealRow?.name) {
    business.legal_entity_name = dealRow.name;
    sources["business.legal_entity_name"] = "buddy";
  }

  for (const f of facts ?? []) {
    if (f.fact_key === "ENTITY_TYPE" && f.fact_value_text) {
      business.entity_type = f.fact_value_text as any;
      sources["business.entity_type"] = "buddy";
    }
    if (f.fact_key === "DATE_FORMED" && f.fact_value_text) {
      business.date_formed = f.fact_value_text;
      sources["business.date_formed"] = "buddy";
    }
  }

  // 5. buddy_research_narratives → latest version 3 (BIE)
  // Need to find the mission for this deal first
  const { data: missions } = await sb
    .from("buddy_research_missions")
    .select("id")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (missions && missions.length > 0) {
    const missionIds = missions.map((m: any) => m.id);
    const { data: narrative } = await sb
      .from("buddy_research_narratives")
      .select("sections")
      .in("mission_id", missionIds)
      .eq("version", 3)
      .limit(1)
      .maybeSingle();

    if (narrative?.sections && Array.isArray(narrative.sections)) {
      const extractSection = (...titles: string[]): string => {
        for (const title of titles) {
          const sec = (narrative.sections as any[]).find(
            (s: any) => s.title === title,
          );
          if (sec?.sentences) {
            const text = (sec.sentences as any[])
              .map((s: any) => s.text ?? "")
              .filter((t: string) => t.length > 0 && !t.startsWith("BIE_META:"))
              .join(" ")
              .trim();
            if (text) return text;
          }
        }
        return "";
      };

      const bizOverview = extractSection("Business Overview", "Industry Overview");
      if (bizOverview && !business.operations_description) {
        business.operations_description = bizOverview;
        sources["business.operations_description"] = "buddy";
      }

      const mgmt = extractSection("Management Backgrounds", "Management");
      if (mgmt && !story.management_qualifications) {
        story.management_qualifications = mgmt;
        sources["story.management_qualifications"] = "buddy";
      }

      const comp = extractSection("Competitive Landscape", "Competitive Position");
      if (comp && !story.competitive_position) {
        story.competitive_position = comp;
        sources["story.competitive_position"] = "buddy";
      }
    }
  }

  return { deal, business, owners, story, sources };
}
