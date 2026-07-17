import "server-only";
import { z } from "zod";

/**
 * Pure HTTP wrapper around the SignWell REST API.
 * https://developers.signwell.com — base URL https://www.signwell.com/api/v1,
 * auth header X-Api-Key. Replaces src/lib/esign/docuseal/client.ts (see
 * docs/build-logs/ARC00_VENDOR_PROVISIONING_CHECKLIST.md item 3 for why:
 * DocuSeal was a self-hosted Cloud Run deployment never provisioned;
 * SignWell has a hosted API on every tier including free).
 *
 * No SIGNWELL_API_KEY is configured in this environment — calls here throw
 * a clear configuration error rather than silently no-op.
 */

const SIGNWELL_BASE_URL = "https://www.signwell.com/api/v1";

function getApiKey(): string {
  const key = process.env.SIGNWELL_API_KEY;
  if (!key) {
    throw new Error("Missing SIGNWELL_API_KEY — SignWell account not yet provisioned. See .env.example.");
  }
  return key;
}

function isTestMode(): boolean {
  return process.env.SIGNWELL_TEST_MODE !== "false";
}

async function signwellFetch(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${SIGNWELL_BASE_URL}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": getApiKey(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SignWell API ${path} failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json();
}

const RecipientSchema = z.object({
  id: z.union([z.string(), z.number()]),
  email: z.string().nullable().optional(),
  status: z.string().optional(),
  signing_url: z.string().nullable().optional(),
  embedded_signing_url: z.string().nullable().optional(),
});

const DocumentSchema = z.object({
  id: z.union([z.string(), z.number()]),
  status: z.string(),
  test_mode: z.boolean().optional(),
  recipients: z.array(RecipientSchema),
  completed_pdf_url: z.string().nullable().optional(),
});
export type SignwellDocument = z.infer<typeof DocumentSchema>;

/**
 * Creates a SignWell document from an already-filled PDF (base64) rather
 * than a SignWell-hosted template. This is the whole point of the
 * fill-then-sign pipeline: SignWell never holds SBA form content — the
 * content is filled by src/lib/sba/forms/*​/render.ts before this is ever
 * called, and SignWell only adds signature/date fields on top of a
 * complete document. Replaces createSignwellDocumentFromTemplate, which
 * drove a SignWell-hosted template per SBA form (content lived in
 * SignWell's dashboard — see the AAR for why that was backwards).
 *
 * `fields` positions signature/date fields on the uploaded PDF
 * (`https://developers.signwell.com/reference/document-fields`). No SBA
 * form's real page coordinates have been confirmed against SignWell's API
 * yet (same "unverified against a live account" caveat as
 * verifySignwellWebhook.ts) — callers may omit it and let SignWell fall
 * back to its default per-recipient placement rather than ship guessed
 * coordinates onto a legal document.
 */
export async function createSignwellDocumentFromFile(args: {
  fileBase64: string;
  fileName: string;
  documentName: string;
  recipients: Array<{ id: string; email: string; name: string }>;
  externalId: string;
  embeddedSigning?: boolean;
  redirectUrl?: string;
  fields?: unknown[][];
}): Promise<SignwellDocument> {
  const raw = await signwellFetch("/documents", {
    method: "POST",
    body: JSON.stringify({
      test_mode: isTestMode(),
      draft: false,
      name: args.documentName,
      files: [{ name: args.fileName, file_base64: args.fileBase64 }],
      embedded_signing: args.embeddedSigning ?? true,
      redirect_url: args.redirectUrl,
      metadata: { external_id: args.externalId },
      recipients: args.recipients.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
      })),
      fields: args.fields ?? [[]],
    }),
  });
  return DocumentSchema.parse(raw);
}

export async function fetchSignwellDocument(documentId: string): Promise<SignwellDocument> {
  const raw = await signwellFetch(`/documents/${encodeURIComponent(documentId)}`, { method: "GET" });
  return DocumentSchema.parse(raw);
}

/**
 * Downloads the completed, signed PDF. SignWell's "Audit & Lock" feature
 * (enabled by default on document creation) appends a signing-certificate
 * page to this same PDF — unlike DocuSeal there is no separate downloadable
 * audit-trail artifact, so this is the only document byte stream this
 * client needs to fetch and store.
 */
export async function downloadSignwellCompletedPdf(documentId: string): Promise<Buffer> {
  const raw = await signwellFetch(`/documents/${encodeURIComponent(documentId)}/completed_pdf?url_only=true`, {
    method: "GET",
  });
  const { url } = z.object({ url: z.string() }).parse(raw);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download SignWell completed PDF: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
