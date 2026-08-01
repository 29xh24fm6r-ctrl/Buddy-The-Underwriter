import "server-only";

/**
 * §3.C — Character-question explicit confirmation.
 *
 * The spec constraint: "an LLM must not infer a criminal-history answer
 * from conversational text. Extraction may pre-fill; only an explicit
 * borrower action confirms."
 *
 * This module handles:
 * - Recording that a borrower explicitly confirmed a character answer
 * - Checking which character answers have been confirmed for an owner
 * - Writing both the canonical column AND the confirmation atomically
 */

import { CHARACTER_QUESTION_KEYS } from "@/lib/sba/forms/questionBank";

type SB = { from: (table: string) => any };

export type ConfirmCharacterAnswerInput = {
  dealId: string;
  ownershipEntityId: string;
  fieldKey: string;
  answer: boolean;
  confirmedBy?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type CharacterConfirmationStatus = {
  fieldKey: string;
  answer: boolean | null;
  confirmed: boolean;
  confirmedAt: string | null;
};

/**
 * Confirms a character question answer for an owner. Writes both the
 * canonical ownership_entities column AND the confirmation record.
 *
 * Throws if fieldKey is not a recognized character question.
 */
export async function confirmCharacterAnswer(
  sb: SB,
  input: ConfirmCharacterAnswerInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { dealId, ownershipEntityId, fieldKey, answer, confirmedBy, ipAddress, userAgent } = input;

  if (!CHARACTER_QUESTION_KEYS.has(fieldKey)) {
    return { ok: false, error: `not_a_character_question: ${fieldKey}` };
  }

  // Look up the source column from the registry
  const { BORROWER_FIELD_REGISTRY } = await import("@/lib/sba/forms/borrowerFieldRegistry");
  const entry = BORROWER_FIELD_REGISTRY.find((e) => e.key === fieldKey);
  if (!entry) {
    return { ok: false, error: `field_not_in_registry: ${fieldKey}` };
  }

  // 1. Write canonical column on ownership_entities
  const { error: updateErr } = await sb
    .from("ownership_entities")
    .update({ [entry.sourceColumn]: answer })
    .eq("id", ownershipEntityId)
    .eq("deal_id", dealId);

  if (updateErr) {
    return { ok: false, error: `column_write_failed: ${updateErr.message}` };
  }

  // 2. Upsert confirmation record
  const { error: confirmErr } = await sb
    .from("character_question_confirmations")
    .upsert(
      {
        deal_id: dealId,
        ownership_entity_id: ownershipEntityId,
        field_key: fieldKey,
        answer,
        confirmed_at: new Date().toISOString(),
        confirmed_by: confirmedBy ?? "borrower",
        ip_address: ipAddress ?? null,
        user_agent: userAgent ?? null,
      },
      { onConflict: "deal_id,ownership_entity_id,field_key" },
    );

  if (confirmErr) {
    return { ok: false, error: `confirmation_write_failed: ${confirmErr.message}` };
  }

  return { ok: true };
}

/**
 * Bulk confirm multiple character answers for one owner in a single call.
 * Used by the intake UI's character-question section submit.
 */
export async function confirmCharacterAnswersBulk(
  sb: SB,
  opts: {
    dealId: string;
    ownershipEntityId: string;
    answers: Record<string, boolean>;
    confirmedBy?: string;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<{ ok: true; confirmed: string[] } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  const confirmed: string[] = [];

  for (const [fieldKey, answer] of Object.entries(opts.answers)) {
    const result = await confirmCharacterAnswer(sb, {
      dealId: opts.dealId,
      ownershipEntityId: opts.ownershipEntityId,
      fieldKey,
      answer,
      confirmedBy: opts.confirmedBy,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
    });
    if (result.ok) {
      confirmed.push(fieldKey);
    } else {
      errors.push(`${fieldKey}: ${result.error}`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, confirmed };
}

/**
 * Returns the confirmation status for all character questions for one owner.
 */
export async function getCharacterConfirmationStatus(
  sb: SB,
  opts: { dealId: string; ownershipEntityId: string },
): Promise<CharacterConfirmationStatus[]> {
  const { BORROWER_FIELD_REGISTRY } = await import("@/lib/sba/forms/borrowerFieldRegistry");

  // Load owner row for current column values
  const characterEntries = BORROWER_FIELD_REGISTRY.filter((e) => CHARACTER_QUESTION_KEYS.has(e.key));
  const columns = [...new Set(characterEntries.map((e) => e.sourceColumn))];

  const { data: ownerRow } = await sb
    .from("ownership_entities")
    .select(columns.join(", "))
    .eq("id", opts.ownershipEntityId)
    .maybeSingle();

  // Load confirmations
  const { data: confirmations } = await sb
    .from("character_question_confirmations")
    .select("field_key, confirmed_at")
    .eq("deal_id", opts.dealId)
    .eq("ownership_entity_id", opts.ownershipEntityId);

  const confirmationMap = new Map<string, string>(
    (confirmations ?? []).map((c: any) => [c.field_key, c.confirmed_at as string]),
  );

  return characterEntries.map((entry) => ({
    fieldKey: entry.key,
    answer: (ownerRow as Record<string, unknown> | null)?.[entry.sourceColumn] as boolean | null ?? null,
    confirmed: confirmationMap.has(entry.key),
    confirmedAt: confirmationMap.get(entry.key) ?? null,
  }));
}
