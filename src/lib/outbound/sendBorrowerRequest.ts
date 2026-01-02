// Intentionally minimal: this file is the single seam to connect
// tenant email routing + Twilio SMS later without touching business logic.

export type BorrowerRequestMessage = {
  toEmail?: string | null;
  toPhone?: string | null;
  borrowerName?: string | null;
  dealId: string;
  links: { checklist_key: string; url: string }[];
};

export async function sendBorrowerRequest(_msg: BorrowerRequestMessage) {
  // TODO: integrate:
  // - tenant_email_routing / bank_email_routing for outbound email
  // - Twilio SMS using existing helpers + bank_id scoping
  // For now: no-op.
  return { ok: true };
}
