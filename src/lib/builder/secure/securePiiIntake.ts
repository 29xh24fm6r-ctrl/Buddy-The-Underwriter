import "server-only";

/**
 * Phase 56B — Secure PII Intake
 *
 * Stores encrypted SSN/TIN in deal_pii_records.
 * Builder sections only ever store last4 and presence flags.
 * Never logs plaintext. Never returns full value to client after submission.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import * as crypto from "node:crypto";

const ENCRYPTION_KEY = process.env.PII_ENCRYPTION_KEY ?? process.env.BUDDY_PII_KEY ?? "";

type StorePiiInput = {
  dealId: string;
  bankId: string;
  ownershipEntityId: string | null;
  piiType: "full_ssn" | "full_tin";
  plaintext: string;
  actorUserId: string;
};

type StorePiiResult = {
  ok: true;
  piiRecordId: string;
  last4: string;
} | {
  ok: false;
  error: string;
};

/**
 * Store encrypted PII. Returns only last4 — never the full value.
 */
export async function storeSecurePii(input: StorePiiInput): Promise<StorePiiResult> {
  const { dealId, bankId, ownershipEntityId, piiType, plaintext, actorUserId } = input;

  // Validate format
  const digits = plaintext.replace(/\D/g, "");
  if (piiType === "full_ssn" && digits.length !== 9) {
    return { ok: false, error: "SSN must be exactly 9 digits" };
  }
  if (piiType === "full_tin" && digits.length !== 9) {
    return { ok: false, error: "TIN must be exactly 9 digits" };
  }

  const last4 = digits.slice(-4);
  const encrypted = encryptValue(digits);

  const sb = supabaseAdmin();

  try {
    // Upsert — one PII record per (deal, entity, type)
    const { data, error } = await sb
      .from("deal_pii_records")
      .upsert({
        deal_id: dealId,
        ownership_entity_id: ownershipEntityId,
        pii_type: piiType,
        encrypted_payload: encrypted,
        last4,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "deal_id,ownership_entity_id,pii_type",
        ignoreDuplicates: false,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    // Audit — never log plaintext
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "builder.secure_pii_captured",
      uiState: "done",
      uiMessage: `Secure ${piiType === "full_ssn" ? "SSN" : "TIN"} captured`,
      meta: {
        pii_type: piiType,
        last4,
        ownership_entity_id: ownershipEntityId,
        actor: actorUserId,
        // NEVER include plaintext or encrypted payload in logs
      },
    }).catch(() => {});

    return { ok: true, piiRecordId: data.id, last4 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Check whether PII is on file for an entity.
 * Returns presence flags only — never the actual value.
 */
export async function getPiiStatus(dealId: string, ownershipEntityId: string): Promise<{
  ssnOnFile: boolean;
  ssnLast4: string | null;
  tinOnFile: boolean;
  tinLast4: string | null;
}> {
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("deal_pii_records")
    .select("pii_type, last4")
    .eq("deal_id", dealId)
    .eq("ownership_entity_id", ownershipEntityId);

  const records = data ?? [];
  const ssn = records.find((r: any) => r.pii_type === "full_ssn");
  const tin = records.find((r: any) => r.pii_type === "full_tin");

  return {
    ssnOnFile: Boolean(ssn),
    ssnLast4: ssn?.last4 ?? null,
    tinOnFile: Boolean(tin),
    tinLast4: tin?.last4 ?? null,
  };
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

function encryptValue(plaintext: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 16) {
    // Fallback: base64 encode (not secure — for dev only)
    return `dev_b64:${Buffer.from(plaintext).toString("base64")}`;
  }

  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, "buddy_pii_salt", 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `aes256:${iv.toString("hex")}:${encrypted}`;
}
