import { ownerTriggers912 } from "@/lib/sba/forms/applicability";
import { FORM_912_TRIGGER_FIELDS } from "@/lib/sba/forms/form1919/fields";
import { determineGuaranteeType } from "@/lib/ownership/rules";

type SB = { from: (table: string) => any };

export type PerOwnerItem = {
  templateCode: string;
  ownershipEntityId: string;
  ownerName: string;
};

const PER_OWNER_TEMPLATE_CODES = new Set([
  "SBA_413",
  "SBA_912",
  "IRS_4506C",
  "SBA_148",
  "SBA_148L",
]);

export function isPerOwnerTemplateCode(code: string): boolean {
  return PER_OWNER_TEMPLATE_CODES.has(code);
}

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

/**
 * For a given deal, determines which per-owner forms need to be duplicated
 * and for which owners. Returns one entry per (templateCode, owner) pair.
 *
 * Per-owner form rules:
 * - SBA_413: all individual owners with 20%+ ownership
 * - SBA_912: only owners whose 1919/1244 character answers trigger 912
 * - IRS_4506C: all individual owners
 * - SBA_148: individual owners with unconditional guarantee type
 * - SBA_148L: individual owners with limited guarantee type
 */
export async function expandPerOwnerItems(
  dealId: string,
  templateCodes: string[],
  sb: SB,
): Promise<PerOwnerItem[]> {
  const perOwnerCodes = templateCodes.filter(isPerOwnerTemplateCode);
  if (perOwnerCodes.length === 0) return [];

  const triggerCols = FORM_912_TRIGGER_FIELDS.join(", ");
  const { data: owners } = await sb
    .from("ownership_entities")
    .select(`id, entity_type, display_name, ownership_pct, ${triggerCols}`)
    .eq("deal_id", dealId);

  const allOwners = (owners ?? []) as Array<Record<string, any>>;
  const individuals = allOwners.filter((o) => isIndividual(o.entity_type));

  const result: PerOwnerItem[] = [];

  for (const code of perOwnerCodes) {
    switch (code) {
      case "SBA_413": {
        for (const owner of individuals) {
          if ((owner.ownership_pct ?? 0) >= 20) {
            result.push({ templateCode: code, ownershipEntityId: owner.id, ownerName: owner.display_name ?? "Owner" });
          }
        }
        break;
      }

      case "SBA_912": {
        for (const owner of individuals) {
          if (ownerTriggers912(owner)) {
            result.push({ templateCode: code, ownershipEntityId: owner.id, ownerName: owner.display_name ?? "Owner" });
          }
        }
        break;
      }

      case "IRS_4506C": {
        for (const owner of individuals) {
          result.push({ templateCode: code, ownershipEntityId: owner.id, ownerName: owner.display_name ?? "Owner" });
        }
        break;
      }

      case "SBA_148": {
        for (const owner of individuals) {
          const gt = determineGuaranteeType(owner.ownership_pct);
          if (gt === "unconditional") {
            result.push({ templateCode: code, ownershipEntityId: owner.id, ownerName: owner.display_name ?? "Owner" });
          }
        }
        break;
      }

      case "SBA_148L": {
        for (const owner of individuals) {
          const gt = determineGuaranteeType(owner.ownership_pct);
          if (gt === "limited") {
            result.push({ templateCode: code, ownershipEntityId: owner.id, ownerName: owner.display_name ?? "Owner" });
          }
        }
        break;
      }
    }
  }

  return result;
}
