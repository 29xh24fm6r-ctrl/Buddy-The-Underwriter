import "server-only";

import { buildForm1919WithSignature } from "@/lib/sba/forms/form1919/buildWithSignature";
import { buildForm413WithSignature } from "@/lib/sba/forms/form413/buildWithSignature";
import { buildForm912WithSignature } from "@/lib/sba/forms/form912/buildWithSignature";
import { buildForm4506cWithSignature } from "@/lib/sba/forms/form4506c/buildWithSignature";
import { buildForm155WithSignature } from "@/lib/sba/forms/form155/buildWithSignature";
import { buildForm159PayloadForDeal } from "@/lib/brokerage/compliancePackage";
import { toFieldValues as toForm159FieldValues } from "@/lib/sba/forms/render159";

/**
 * Computes the same flattened field values each form's render*Pdf() already
 * uses to fill the official PDF for the lender package (see e.g.
 * form1919/render.ts's flattenFieldValues) — reused here so SignWell's
 * document is prefilled with what Buddy already collected, instead of the
 * signer retyping everything. Keyed by Buddy's internal field names;
 * fieldMaps.ts's buildTemplateFields() translates those to SignWell's
 * per-template api_ids.
 *
 * Never throws and never blocks signing: any missing data, incomplete
 * form, or build error just yields {} (no prefill) — requestSignature()
 * falls back to a blank SignWell document, the same behavior as before
 * this feature existed.
 */
export async function computeSignwellPrefillFields(args: {
  formCode: string;
  dealId: string;
  bankId: string;
  signerOwnershipEntityId: string;
  sb: any;
}): Promise<Record<string, string>> {
  const { formCode, dealId, bankId, signerOwnershipEntityId, sb } = args;

  try {
    switch (formCode) {
      case "FORM_1919": {
        const buildResult = await buildForm1919WithSignature(dealId, sb);
        return flattenForm1919(buildResult);
      }

      case "FORM_413": {
        const buildResult = await buildForm413WithSignature(dealId, sb);
        const signer = buildResult.input.signers.find((s: any) => s.ownership_entity_id === signerOwnershipEntityId);
        return signer ? flattenRecord(signer.fields) : {};
      }

      case "FORM_912": {
        const buildResult = await buildForm912WithSignature(dealId, sb);
        if (!buildResult.applicable) return {};
        const person = buildResult.input.persons.find((p: any) => p.ownership_entity_id === signerOwnershipEntityId);
        return person ? flattenRecord(person.fields) : {};
      }

      case "FORM_4506C": {
        const buildResult = await buildForm4506cWithSignature(dealId, bankId, sb);
        const signer = buildResult.input.signers.find((s: any) => s.ownership_entity_id === signerOwnershipEntityId);
        if (!signer) return {};
        const values = flattenRecord(signer.fields);
        for (const [k, v] of Object.entries(buildResult.input.thirdParty)) {
          if (v != null) values[`third_party.${k}`] = String(v);
        }
        return values;
      }

      case "FORM_155": {
        const buildResult = await buildForm155WithSignature(dealId, bankId, sb);
        if (!buildResult.applicable) return {};
        return flattenRecord(buildResult.input);
      }

      case "FORM_159": {
        const { fields, missing } = await buildForm159PayloadForDeal(dealId, sb, bankId);
        if (missing.length > 0) return {};
        return toForm159FieldValues(fields);
      }

      default:
        return {};
    }
  } catch {
    return {};
  }
}

function flattenRecord(obj: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null) values[k] = String(v);
  }
  return values;
}

function flattenForm1919(result: {
  input: {
    sectionI: Record<string, unknown>;
    sectionII: Array<{ fields: Record<string, unknown> }>;
    sectionIII: Array<{ fields: Record<string, unknown> }>;
  };
}): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.input.sectionI)) {
    if (v != null) values[`section_i.${k}`] = String(v);
  }
  result.input.sectionII.forEach((person, i) => {
    for (const [k, v] of Object.entries(person.fields)) {
      if (v != null) values[`section_ii.${i}.${k}`] = String(v);
    }
  });
  result.input.sectionIII.forEach((entity, i) => {
    for (const [k, v] of Object.entries(entity.fields)) {
      if (v != null) values[`section_iii.${i}.${k}`] = String(v);
    }
  });
  return values;
}
