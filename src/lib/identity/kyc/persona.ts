import "server-only";
import { z } from "zod";

/**
 * SPEC S3 A-2 — pure HTTP wrapper around the Persona REST API.
 * https://api.withpersona.com/api/v1
 *
 * No PERSONA_API_KEY is configured in this environment — calls here throw
 * a clear configuration error rather than silently no-op or fabricate a
 * response. The wrapper itself is real and ready.
 */

const PERSONA_BASE_URL = "https://api.withpersona.com/api/v1";
const PERSONA_VERSION = "2023-01-05";

function getApiKey(): string {
  const key = process.env.PERSONA_API_KEY;
  if (!key) {
    throw new Error("Missing PERSONA_API_KEY — Persona account not yet provisioned. See .env.example.");
  }
  return key;
}

async function personaFetch(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${PERSONA_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Persona-Version": PERSONA_VERSION,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Persona API ${path} failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json();
}

const PersonaInquirySchema = z.object({
  data: z.object({
    id: z.string(),
    type: z.literal("inquiry"),
    attributes: z.object({
      status: z.string(),
      "reference-id": z.string().nullable().optional(),
      "name-first": z.string().nullable().optional(),
      "name-last": z.string().nullable().optional(),
      fields: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
});
export type PersonaInquiry = z.infer<typeof PersonaInquirySchema>;

export async function createPersonaInquiry(args: {
  templateId: string;
  referenceId: string;
  fields?: { nameFirst?: string; nameLast?: string };
}): Promise<PersonaInquiry> {
  const raw = await personaFetch("/inquiries", {
    method: "POST",
    body: JSON.stringify({
      data: {
        attributes: {
          "inquiry-template-id": args.templateId,
          "reference-id": args.referenceId,
          fields: {
            "name-first": args.fields?.nameFirst,
            "name-last": args.fields?.nameLast,
          },
        },
      },
    }),
  });
  return PersonaInquirySchema.parse(raw);
}

export async function fetchPersonaInquiry(inquiryId: string): Promise<PersonaInquiry> {
  const raw = await personaFetch(`/inquiries/${encodeURIComponent(inquiryId)}`, { method: "GET" });
  return PersonaInquirySchema.parse(raw);
}

const OneTimeLinkSchema = z.object({
  meta: z.object({
    "one-time-link": z.string(),
  }),
});

export async function generatePersonaOneTimeLink(inquiryId: string): Promise<string> {
  const raw = await personaFetch(`/inquiries/${encodeURIComponent(inquiryId)}/one-time-link`, {
    method: "POST",
  });
  const parsed = OneTimeLinkSchema.parse(raw);
  return parsed.meta["one-time-link"];
}
