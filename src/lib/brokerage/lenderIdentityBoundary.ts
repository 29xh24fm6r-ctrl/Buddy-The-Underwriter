export type LenderIdentity = { userId: string; lenderBankId: string };

export type LenderIdentitySelection =
  | { ok: true; identity: LenderIdentity }
  | {
      ok: false;
      reason: "not_a_lender" | "ambiguous_lender_identity" | "invalid_lender_identity";
    };

const MAX_ID_LENGTH = 160;

function safeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

/**
 * Selects one deterministic lender identity from authoritative database rows.
 * Multiple active lender agreements are rejected instead of silently choosing
 * whichever row PostgREST happens to return first.
 */
export function selectLenderIdentity(
  userIdValue: unknown,
  memberships: unknown,
  agreements: unknown,
): LenderIdentitySelection {
  const userId = safeId(userIdValue);
  if (!userId || !Array.isArray(memberships) || !Array.isArray(agreements)) {
    return { ok: false, reason: "invalid_lender_identity" };
  }

  const bankIds = new Set<string>();
  for (const row of memberships) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, reason: "invalid_lender_identity" };
    }
    const bankId = safeId((row as Record<string, unknown>).bank_id);
    if (!bankId) return { ok: false, reason: "invalid_lender_identity" };
    bankIds.add(bankId);
  }
  if (bankIds.size === 0) return { ok: false, reason: "not_a_lender" };

  const activeBankIds = new Set<string>();
  for (const row of agreements) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, reason: "invalid_lender_identity" };
    }
    const bankId = safeId((row as Record<string, unknown>).lender_bank_id);
    if (!bankId || !bankIds.has(bankId)) {
      return { ok: false, reason: "invalid_lender_identity" };
    }
    activeBankIds.add(bankId);
  }

  if (activeBankIds.size === 0) return { ok: false, reason: "not_a_lender" };
  if (activeBankIds.size !== 1) {
    return { ok: false, reason: "ambiguous_lender_identity" };
  }

  return {
    ok: true,
    identity: { userId, lenderBankId: [...activeBankIds][0] },
  };
}
