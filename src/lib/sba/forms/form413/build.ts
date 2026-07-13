import { FORM_413_FIELDS, missingRequiredFields } from "@/lib/sba/forms/form413/fields";

export type Form413SignerInput = {
  ownership_entity_id: string;
  fields: Record<string, string | number | boolean | null>;
};

export type Form413Input = {
  signers: Form413SignerInput[];
};

export type Form413SignatureStatus = {
  ownership_entity_id: string;
  has_valid_signature: boolean;
  signed_at: string | null;
  expires_at: string | null;
  /** true once expires_at is within 14 days (including already expired). */
  needs_resignature: boolean;
};

export type Form413BuildResult = {
  form: "413";
  input: Form413Input;
  missing: Array<{ ownership_entity_id: string; missing: string[] }>;
  signatures: Form413SignatureStatus[];
  is_complete: boolean;
};

const STALENESS_DAYS = 90;
const RESIGN_WARNING_DAYS = 14;
const MS_PER_DAY = 86_400_000;

function computeSignatureStatus(ownershipEntityId: string, signedAt: unknown): Form413SignatureStatus {
  const signedAtStr = typeof signedAt === "string" && signedAt ? signedAt : null;
  let expiresAt: string | null = null;
  let needsResignature = signedAtStr === null;

  if (signedAtStr) {
    const signedDate = new Date(signedAtStr);
    if (!Number.isNaN(signedDate.getTime())) {
      const expiresDate = new Date(signedDate.getTime() + STALENESS_DAYS * MS_PER_DAY);
      expiresAt = expiresDate.toISOString().slice(0, 10);
      const daysUntilExpiry = (expiresDate.getTime() - Date.now()) / MS_PER_DAY;
      needsResignature = daysUntilExpiry <= RESIGN_WARNING_DAYS;
    }
  }

  return {
    ownership_entity_id: ownershipEntityId,
    // E-sign ceremony ships in S3 — hardcoded false until wired (spec non-goal),
    // regardless of whether a paper signed_at date is on file.
    has_valid_signature: false,
    signed_at: signedAtStr,
    expires_at: expiresAt,
    needs_resignature: needsResignature,
  };
}

export function buildForm413(input: Form413Input): Form413BuildResult {
  const missing = input.signers.map((signer) => ({
    ownership_entity_id: signer.ownership_entity_id,
    missing: missingRequiredFields(FORM_413_FIELDS, signer.fields),
  }));

  const signatures = input.signers.map((signer) =>
    computeSignatureStatus(signer.ownership_entity_id, signer.fields.signed_at),
  );

  const isComplete =
    missing.every((m) => m.missing.length === 0) && signatures.every((s) => !s.needs_resignature);

  return { form: "413", input, missing, signatures, is_complete: isComplete };
}
