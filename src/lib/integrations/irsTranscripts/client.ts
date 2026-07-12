import "server-only";
import { z } from "zod";

/**
 * SPEC S4 D-2 — IRS transcript vendor client. Per the addendum ("IRS
 * vendor v1: prefer NCS or IDology over IRS direct — IRS direct requires
 * Designated User auth that takes 30+ days to provision"), the default
 * vendor is `ncs`, overridable via IRS_TRANSCRIPT_VENDOR. This is
 * independent of `borrower_irs_transcript_requests.vendor`'s DB column
 * default (`irs_direct`, matching the spec's own migration SQL) — the row
 * always records whichever vendor actually serviced the request, set
 * explicitly by submission.ts, not left to the column default.
 *
 * No IRS_VENDOR_API_KEY is configured in this environment — calls throw a
 * clear configuration error rather than silently no-op.
 */

export type IrsTranscriptVendor = "irs_direct" | "ncs" | "idology" | "wolters_kluwer";

export function currentIrsVendor(): IrsTranscriptVendor {
  return (process.env.IRS_TRANSCRIPT_VENDOR as IrsTranscriptVendor) ?? "ncs";
}

function getConfig(): { base: string; apiKey: string } {
  const base = process.env.IRS_VENDOR_BASE_URL;
  const apiKey = process.env.IRS_VENDOR_API_KEY;
  if (!base || !apiKey) {
    throw new Error("Missing IRS_VENDOR_BASE_URL / IRS_VENDOR_API_KEY — IRS transcript vendor not yet provisioned. See .env.example.");
  }
  return { base, apiKey };
}

async function irsVendorFetch(path: string, init: RequestInit): Promise<unknown> {
  const { base, apiKey } = getConfig();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`IRS transcript vendor API ${path} failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json();
}

const SubmitTranscriptResponseSchema = z.object({
  vendor_request_id: z.string(),
  status: z.string(),
});
export type SubmitTranscriptResponse = z.infer<typeof SubmitTranscriptResponseSchema>;

export async function submitVendorTranscriptRequest(args: {
  signed4506cPdfBase64: string;
  taxYears: number[];
  transcriptTypes: string[];
}): Promise<SubmitTranscriptResponse> {
  const raw = await irsVendorFetch("/transcript-requests", {
    method: "POST",
    body: JSON.stringify({
      form_4506c_pdf: args.signed4506cPdfBase64,
      tax_years: args.taxYears,
      transcript_types: args.transcriptTypes,
    }),
  });
  return SubmitTranscriptResponseSchema.parse(raw);
}

const PollTranscriptResponseSchema = z.object({
  status: z.string(),
  transcripts: z
    .array(
      z.object({
        tax_year: z.number(),
        transcript_type: z.string(),
        fields: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional(),
      }),
    )
    .optional(),
});
export type PollTranscriptResponse = z.infer<typeof PollTranscriptResponseSchema>;

export async function pollVendorTranscriptRequest(vendorRequestId: string): Promise<PollTranscriptResponse> {
  const raw = await irsVendorFetch(`/transcript-requests/${encodeURIComponent(vendorRequestId)}`, { method: "GET" });
  return PollTranscriptResponseSchema.parse(raw);
}
