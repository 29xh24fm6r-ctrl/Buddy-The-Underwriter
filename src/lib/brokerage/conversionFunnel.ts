/**
 * BRK-10N Conversion Funnel — lead capture, session start, tracking.
 */
export type LeadCaptureResult = { ok: true; leadId: string; existing: boolean } | { ok: false; error: string };
export type StartSessionResult = { ok: true; dealId: string; tokenHash: string; leadId: string | null } | { ok: false; error: string };
type Row = Record<string, any>;
type SB = { from: (t: string) => any };
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_MS = 10 * 60 * 1000;
export const FEE_DISCLOSURE_TEXT = "A packaging fee of $1,000 applies for SBA loan preparation and lender matching services. This fee may be financed into the loan at closing, subject to lender approval. Buddy may also receive a referral fee from the selected lender, disclosed on SBA Form 159.";
export const PUBLIC_COPY = { headline: "Get your SBA loan package built and matched to the right lender.", feeDisclosure: FEE_DISCLOSURE_TEXT, noGuarantee: "Buddy does not guarantee loan approval. SBA loan approval is subject to lender underwriting, SBA guidelines, and borrower eligibility.", ctaStart: "Start your SBA package" };

export async function captureLead(input: { email?: string; phone?: string; firstName?: string; lastName?: string; businessName?: string; loanAmountRequested?: number; loanPurpose?: string; source?: string }, sb: SB): Promise<LeadCaptureResult> {
  const email = str(input.email); const source = str(input.source) ?? "website";
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "invalid_email" };
  if (email) { const { data: ex } = await sb.from("brokerage_leads").select("id, created_at").eq("email", email).eq("source", source).order("created_at", { ascending: false }).limit(1).maybeSingle(); if (ex) { const age = Date.now() - new Date(str(ex.created_at) ?? "").getTime(); if (age < COOLDOWN_MS) return { ok: true, leadId: String(ex.id), existing: true }; } }
  const { data: ins, error } = await sb.from("brokerage_leads").insert({ email, phone: str(input.phone), first_name: str(input.firstName), last_name: str(input.lastName), business_name: str(input.businessName), loan_amount_requested: num(input.loanAmountRequested), loan_purpose: str(input.loanPurpose), source, status: "new", created_at: new Date().toISOString() }).select("id").single();
  if (error || !ins) return { ok: false, error: error?.message ?? "insert_failed" };
  await sb.from("brokerage_conversion_events").insert({ lead_id: String(ins.id), event_type: "lead_captured", source, metadata: { email: email ?? "anonymous" } });
  return { ok: true, leadId: String(ins.id), existing: false };
}

export async function startBrokerageSession(input: { brokerageBankId: string; leadId?: string; source?: string }, sb: SB): Promise<StartSessionResult> {
  const dealId = crypto.randomUUID();
  const { error: de } = await sb.from("deals").insert({ id: dealId, bank_id: input.brokerageBankId, deal_type: "SBA", origin: "brokerage_anonymous", display_name: "New borrower inquiry", status: "active" });
  if (de) return { ok: false, error: `deal: ${de.message}` };
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const tokenHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
  const { error: te } = await sb.from("borrower_session_tokens").insert({ token_hash: tokenHash, deal_id: dealId, bank_id: input.brokerageBankId, expires_at: new Date(Date.now() + 90 * 24 * 3_600_000).toISOString() });
  if (te) return { ok: false, error: `token: ${te.message}` };
  let leadId = input.leadId ?? null;
  if (leadId) await sb.from("brokerage_leads").update({ status: "converted", converted_deal_id: dealId, converted_at: new Date().toISOString() }).eq("id", leadId);
  await sb.from("brokerage_conversion_events").insert({ lead_id: leadId, deal_id: dealId, event_type: "session_started", source: input.source });
  await sb.from("brokerage_conversion_events").insert({ lead_id: leadId, deal_id: dealId, event_type: "deal_created", source: input.source });
  return { ok: true, dealId, tokenHash, leadId };
}

export async function logConversionEvent(event: { leadId?: string; dealId?: string; eventType: string; source?: string; metadata?: Record<string, any> }, sb: SB): Promise<void> { await sb.from("brokerage_conversion_events").insert({ lead_id: event.leadId ?? null, deal_id: event.dealId ?? null, event_type: event.eventType, source: event.source ?? null, metadata: event.metadata ?? {} }); }

export function validatePublicContent(): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!PUBLIC_COPY.feeDisclosure.includes("$1,000")) issues.push("Fee must mention $1,000");
  if (PUBLIC_COPY.headline.toLowerCase().includes("guaranteed")) issues.push("No guarantee language");
  if (!PUBLIC_COPY.noGuarantee.includes("does not guarantee")) issues.push("Missing disclaimer");
  return { ok: issues.length === 0, issues };
}
