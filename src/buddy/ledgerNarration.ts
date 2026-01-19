export type LedgerNarration = { message: string; tone: "neutral" | "focused" | "caution" | "encouraging" };

export function narrateLedgerEvent(kind: string, payload?: Record<string, any>): LedgerNarration | null {
  switch (kind) {
    case "deal.document.uploaded":
      return { message: "Borrower uploaded a document. Analyzing…", tone: "neutral" };
    case "deal.checklist.updated": {
      const received = Number(payload?.received ?? NaN);
      const total = Number(payload?.total ?? NaN);
      if (Number.isFinite(received) && Number.isFinite(total)) {
        return { message: `Checklist updated. ${received} of ${total} received.`, tone: "neutral" };
      }
      return { message: "Checklist updated.", tone: "neutral" };
    }
    case "deal.underwriting.started":
      return { message: "Underwriting started. Document intake is now locked.", tone: "focused" };
    default:
      return null;
  }
}
