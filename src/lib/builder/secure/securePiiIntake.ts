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
const MIN_ENCRYPTION_KEY_LENGTH = 16;

export type PiiType = "full_ssn" | "full_tin" | "spouse_full_ssn";

type StorePiiInput = {
  dealId: string;
  bankId: string;
  ownershipEntityId: string | null;
  piiType: PiiType;
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
  errorCode?: "encryption_not_configured";
};

/**
 * Store encrypted PII. Returns only last4 — never the full value.
 */
export async function storeSecurePii(input: StorePiiInput): Promise<StorePiiResult> {
  const { dealId, bankId, ownershipEntityId, piiType, plaintext, actorUserId } = input;

  // Fail closed: refuse to store SSN/TIN at all if the encryption key isn't
  // configured, rather than silently degrading to reversible base64. This
  // is a server-misconfiguration error, not a borrower/banker input error —
  // callers should surface it as 5xx, not 4xx (see errorCode below).
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    console.error(
      "[securePiiIntake] PII_ENCRYPTION_KEY not configured or too short — refusing to store PII",
    );
    return {
      ok: false,
      error: "PII encryption is not configured on this environment.",
      errorCode: "encryption_not_configured",
    };
  }

  // Validate format
  const digits = plaintext.replace(/\D/g, "");
  if ((piiType === "full_ssn" || piiType === "spouse_full_ssn") && digits.length !== 9) {
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
      uiMessage: `Secure ${piiType === "full_tin" ? "TIN" : "SSN"} captured`,
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
  spouseSsnOnFile: boolean;
  spouseSsnLast4: string | null;
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
  const spouseSsn = records.find((r: any) => r.pii_type === "spouse_full_ssn");

  return {
    ssnOnFile: Boolean(ssn),
    ssnLast4: ssn?.last4 ?? null,
    tinOnFile: Boolean(tin),
    tinLast4: tin?.last4 ?? null,
    spouseSsnOnFile: Boolean(spouseSsn),
    spouseSsnLast4: spouseSsn?.last4 ?? null,
  };
}

/**
 * Decrypts full PII for embedding into a legal document at render time
 * ONLY (SBA Form 912 §3, SBA Form 413 signature-block SSN fields). Never
 * call this from anything that returns to a browser or gets logged — the
 * caller is responsible for using the return value exactly once, to fill
 * a PDF field, and discarding it. Returns null if no record is on file, so
 * callers can distinguish "not collected yet" from "collected but this
 * table has a different record" without throwing.
 *
 * Uses the real supabaseAdmin() client directly (not an injected one) —
 * for render.ts call sites that already take an injectable Supabase
 * client (for testability), query deal_pii_records with that client and
 * call decryptStoredPii() below instead of this function.
 */
export async function getDecryptedPii(
  dealId: string,
  ownershipEntityId: string,
  piiType: PiiType,
): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("deal_pii_records")
    .select("encrypted_payload")
    .eq("deal_id", dealId)
    .eq("ownership_entity_id", ownershipEntityId)
    .eq("pii_type", piiType)
    .maybeSingle();

  const encrypted = (data as { encrypted_payload?: string } | null)?.encrypted_payload;
  if (!encrypted) return null;
  return decryptStoredPii(encrypted);
}

/**
 * Decrypts an already-fetched `deal_pii_records.encrypted_payload` value.
 * Exported so callers with their own injected Supabase client (e.g.
 * render.ts modules, which take `supabase` as a parameter for
 * testability rather than importing supabaseAdmin() directly) can fetch
 * the row themselves and decrypt without going through getDecryptedPii()'s
 * hard-coded supabaseAdmin() call.
 */
export function decryptStoredPii(encryptedPayload: string): string | null {
  return decryptValue(encryptedPayload);
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

function encryptValue(plaintext: string): string {
  // storeSecurePii checks ENCRYPTION_KEY presence/length before calling this
  // — no insecure fallback path here. If that invariant is ever violated,
  // scryptSync below throws rather than silently degrading.
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, "buddy_pii_salt", 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `aes256:${iv.toString("hex")}:${encrypted}`;
}

function decryptValue(stored: string): string | null {
  // dev_b64: was an insecure fallback format that encryptValue no longer
  // produces (see above) — intentionally not handled here either, so a
  // stray record in that format decrypts to null (safe) rather than
  // silently succeeding.
  if (stored.startsWith("aes256:")) {
    const [, ivHex, encryptedHex] = stored.split(":");
    if (!ivHex || !encryptedHex || !ENCRYPTION_KEY || ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) return null;
    try {
      const key = crypto.scryptSync(ENCRYPTION_KEY, "buddy_pii_salt", 32);
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(ivHex, "hex"));
      let decrypted = decipher.update(encryptedHex, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch {
      return null;
    }
  }
  return null;
}
