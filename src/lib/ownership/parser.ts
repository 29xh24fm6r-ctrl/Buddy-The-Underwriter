// src/lib/ownership/parser.ts

type ParsedOwner = {
  fullName: string;
  ownershipPercent: number | null;
  email?: string | null;
};

/**
 * Parse natural language ownership corrections from borrower.
 * 
 * Examples:
 * - "Me 60, John 25, Sarah 15"
 * - "I'm 51%, spouse 49%"
 * - "Two owners: me and my partner, 50/50"
 * - "Matt Smith 55%, John Doe 25%, Sarah Jones 20%"
 * - "Add Mike Johnson, 10%, mike@example.com"
 */
export function parseOwnershipText(text: string, borrowerName?: string): ParsedOwner[] {
  const normalized = text.toLowerCase().trim();
  const owners: ParsedOwner[] = [];

  // Pattern 1: "Name XX%, Name YY%"
  const pattern1 = /([a-z]+(?:\s+[a-z]+){0,3})\s*[,:]?\s*(\d{1,3}(?:\.\d+)?)\s*%/gi;
  
  let match: RegExpExecArray | null;
  while ((match = pattern1.exec(text))) {
    let name = match[1].trim();
    const percent = Number(match[2]);

    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) continue;

    // Normalize common self-references
    if (/^(me|i|myself|self)$/i.test(name) && borrowerName) {
      name = borrowerName;
    }
    if (/^(spouse|partner|wife|husband)$/i.test(name)) {
      name = name.charAt(0).toUpperCase() + name.slice(1); // Capitalize
    }

    // Title case
    name = name
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

    if (name.length < 2) continue;

    owners.push({ fullName: name, ownershipPercent: percent });
  }

  // Pattern 2: "50/50" split
  if (owners.length === 0 && /50\s*\/\s*50/.test(normalized)) {
    if (borrowerName) {
      owners.push({ fullName: borrowerName, ownershipPercent: 50 });
    }
    owners.push({ fullName: "Partner", ownershipPercent: 50 });
  }

  // Pattern 3: "Name, XX%, email@example.com"
  const pattern3 = /([a-z]+(?:\s+[a-z]+){0,3})\s*,\s*(\d{1,3}(?:\.\d+)?)\s*%\s*,\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
  pattern3.lastIndex = 0;
  while ((match = pattern3.exec(text))) {
    let name = match[1].trim();
    const percent = Number(match[2]);
    const email = match[3].trim();

    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) continue;

    name = name
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

    owners.push({ fullName: name, ownershipPercent: percent, email });
  }

  // Deduplicate by name
  const seen = new Set<string>();
  return owners.filter((o) => {
    const key = o.fullName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Validate that ownership percentages add up (roughly) to 100%
 */
export function validateOwnershipTotals(owners: ParsedOwner[]): {
  valid: boolean;
  total: number;
  warning?: string;
} {
  const total = owners.reduce((sum, o) => sum + (o.ownershipPercent ?? 0), 0);

  if (Math.abs(total - 100) < 0.1) {
    return { valid: true, total };
  }

  if (total > 100) {
    return {
      valid: false,
      total,
      warning: `Ownership adds up to ${total.toFixed(1)}%. Should be 100% or less.`,
    };
  }

  if (total < 80) {
    return {
      valid: false,
      total,
      warning: `Only ${total.toFixed(1)}% assigned. Are there more owners?`,
    };
  }

  // 80-100 is acceptable (might be rounding or pending)
  return { valid: true, total };
}
