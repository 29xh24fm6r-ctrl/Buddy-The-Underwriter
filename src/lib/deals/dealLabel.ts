export type DealNameFields = {
  id: string;
  display_name?: string | null;
  nickname?: string | null;
  borrower_name?: string | null;
  name?: string | null;
  legal_name?: string | null;
};

export type DealLabelResult = {
  label: string;
  source: "display_name" | "nickname" | "borrower_name" | "name" | "legal_name" | "fallback";
  needsName: boolean;
};

export function dealLabel(fields: DealNameFields): string {
  return resolveDealLabel(fields).label;
}

export function resolveDealLabel(fields: DealNameFields): DealLabelResult {
  const display = fields.display_name?.trim();
  if (display) {
    return { label: display, source: "display_name", needsName: false };
  }

  const nickname = fields.nickname?.trim();
  if (nickname) {
    return { label: nickname, source: "nickname", needsName: false };
  }

  const borrower = fields.borrower_name?.trim();
  if (borrower) {
    return { label: borrower, source: "borrower_name", needsName: false };
  }

  const name = fields.name?.trim();
  if (name) {
    return { label: name, source: "name", needsName: false };
  }

  const legal = fields.legal_name?.trim();
  if (legal) {
    return { label: legal, source: "legal_name", needsName: false };
  }

  const suffix = fields.id ? String(fields.id).slice(0, 8) : "unknown";
  return { label: `Deal ${suffix}`, source: "fallback", needsName: true };
}
