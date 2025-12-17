// lib/intelligence/c3LiteExtract.ts
import "server-only";

export type C3LiteResult = {
  borrower?: {
    name?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      raw?: string;
    };
    ein_last4?: string;
    confidence?: number; // 0..1
  };
};

function pickFirstLine(s: string): string {
  return s.trim().split("\n")[0]?.trim() ?? "";
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function isPlausibleEntityName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3) return false;

  // Reject obvious labels / junk
  const bad = /^(borrower|applicant|legal name|company name|business name|address|ein|tax id)\b/i;
  if (bad.test(n)) return false;

  // Too many digits is usually not a name
  const digits = (n.match(/\d/g) ?? []).length;
  if (digits > Math.ceil(n.length * 0.25)) return false;

  return true;
}

function isPlausibleAddressRaw(raw: string): boolean {
  const r = raw.trim();
  if (r.length < 10) return false;
  // Must include at least one digit and a 2-letter state + ZIP
  const hasStreetNumber = /\d{2,6}/.test(r);
  const hasStateZip = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(r);
  return hasStreetNumber && hasStateZip;
}

function scoreBorrowerSignals(args: {
  name?: string;
  addressRaw?: string;
  einLast4?: string;
}): number {
  // Weighted scoring (deterministic)
  // Name: 0.40, Address: 0.35, EIN last4: 0.25 = total 1.00
  const wName = 0.4;
  const wAddr = 0.35;
  const wEin = 0.25;

  let score = 0;

  if (args.name && isPlausibleEntityName(args.name)) score += wName;
  if (args.addressRaw && isPlausibleAddressRaw(args.addressRaw)) score += wAddr;
  if (args.einLast4 && /^\d{4}$/.test(args.einLast4)) score += wEin;

  return clamp01(score);
}

export async function extractC3Lite({
  text,
}: {
  text: string;
}): Promise<C3LiteResult> {
  if (!text) return {};

  const normalized = text.replace(/\r/g, "\n");
  const borrower: NonNullable<C3LiteResult["borrower"]> = {};

  // -----------------------------
  // EIN (LAST 4 ONLY) — NEVER RETURN FULL EIN
  // -----------------------------
  const einLabelMatch =
    normalized.match(
      /(EIN|Tax ID|Federal ID|FEIN)[^\dX\*]*([0-9X\*]{2}-?[0-9X\*]{7}|[0-9X\*]{9})/i
    ) ?? null;

  if (einLabelMatch) {
    const token = einLabelMatch[2] ?? "";
    const digitsOnly = token.replace(/\D/g, "");
    const maskedDigits = token.replace(/[^0-9]/g, "");
    const source = digitsOnly.length ? digitsOnly : maskedDigits;

    if (source.length >= 4) {
      borrower.ein_last4 = source.slice(-4);
    }
  } else {
    // Common masked formats like XX-XXX1234 or **-*****1234
    const masked =
      normalized.match(/(?:XX-XXX|X{2}-X{3}|\*{2}-\*{3})(\d{4})/i) ??
      normalized.match(/(?:\*{2}-\*{5})(\d{4})/i) ??
      null;

    if (masked?.[1]) borrower.ein_last4 = masked[1];
  }

  // -----------------------------
  // BORROWER / ENTITY NAME
  // -----------------------------
  const namePatterns: RegExp[] = [
    /Borrower[:\s]+(.+)/i,
    /Applicant[:\s]+(.+)/i,
    /Legal Name[:\s]+(.+)/i,
    /Company Name[:\s]+(.+)/i,
    /Business Name[:\s]+(.+)/i,
  ];

  for (const pattern of namePatterns) {
    const m = normalized.match(pattern);
    if (m?.[1]) {
      const candidate = pickFirstLine(m[1]);
      if (candidate) {
        borrower.name = candidate;
        break;
      }
    }
  }

  // -----------------------------
  // ADDRESS (RAW BLOCK) — NO /s FLAG
  // -----------------------------
  const addressMatch = normalized.match(
    /(\d{2,6}\s+[\s\S]{0,120}?\n[\s\S]{0,120}?,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/
  );

  if (addressMatch?.[1]) {
    borrower.address = { raw: addressMatch[1].trim() };
  }

  // -----------------------------
  // CONFIDENCE SCORE (0..1)
  // -----------------------------
  borrower.confidence = scoreBorrowerSignals({
    name: borrower.name,
    addressRaw: borrower.address?.raw,
    einLast4: borrower.ein_last4,
  });

  // Clean empty borrower (but keep if confidence > 0 because that means we found something)
  const hasAny =
    !!borrower.name || !!borrower.address?.raw || !!borrower.ein_last4;

  if (!hasAny) return {};

  return { borrower };
}
