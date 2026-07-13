import "server-only";
import { z } from "zod";

/**
 * SPEC S3 B-5 — pure HTTP wrapper around a self-hosted DocuSeal instance.
 * Embed-as-service only — no fork, no source modification (AGPL-3.0
 * obligation does not trigger; see infrastructure/docuseal/README.md).
 *
 * No DOCUSEAL_API_TOKEN is configured in this environment (no Cloud Run
 * deployment exists yet — see infrastructure/docuseal/). Calls here throw
 * a clear configuration error rather than silently no-op.
 */

function getBaseUrl(): string {
  const url = process.env.DOCUSEAL_BASE_URL;
  if (!url) {
    throw new Error("Missing DOCUSEAL_BASE_URL — DocuSeal not yet deployed. See infrastructure/docuseal/README.md.");
  }
  return url;
}

function getApiToken(): string {
  const token = process.env.DOCUSEAL_API_TOKEN;
  if (!token) {
    throw new Error("Missing DOCUSEAL_API_TOKEN — DocuSeal not yet deployed. See infrastructure/docuseal/README.md.");
  }
  return token;
}

async function docusealFetch(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: {
      "X-Auth-Token": getApiToken(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DocuSeal API ${path} failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json();
}

const SubmitterSchema = z.object({
  id: z.number(),
  submission_id: z.number(),
  email: z.string().nullable().optional(),
  slug: z.string(),
  status: z.string(),
});

const SubmissionSchema = z.object({
  id: z.number(),
  status: z.string(),
  submitters: z.array(SubmitterSchema),
  documents: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  audit_log_url: z.string().nullable().optional(),
});
export type DocusealSubmission = z.infer<typeof SubmissionSchema>;

export async function createDocusealSubmission(args: {
  templateId: string;
  submitters: Array<{ email: string; name: string; role?: string; fields?: Record<string, unknown> }>;
  externalId: string;
  sendEmail?: boolean;
  signOrdered?: boolean;
}): Promise<DocusealSubmission> {
  const raw = await docusealFetch("/submissions", {
    method: "POST",
    body: JSON.stringify({
      template_id: args.templateId,
      submitters: args.submitters,
      external_id: args.externalId,
      send_email: args.sendEmail ?? false,
      order: args.signOrdered ? "preserved" : "random",
    }),
  });
  // DocuSeal's create-submission response is an array of submitter objects
  // sharing one submission_id, not a single submission object — normalize.
  const submitters = z.array(SubmitterSchema).parse(raw);
  return {
    id: submitters[0]?.submission_id ?? 0,
    status: "pending",
    submitters,
  };
}

export async function fetchDocusealSubmission(submissionId: string): Promise<DocusealSubmission> {
  const raw = await docusealFetch(`/submissions/${encodeURIComponent(submissionId)}`, { method: "GET" });
  return SubmissionSchema.parse(raw);
}

export async function downloadDocusealSignedPdf(submissionId: string, documentName?: string): Promise<Buffer> {
  const submission = await fetchDocusealSubmission(submissionId);
  const doc = documentName
    ? submission.documents?.find((d) => d.name === documentName)
    : submission.documents?.[0];
  if (!doc) {
    throw new Error(`DocuSeal submission ${submissionId} has no downloadable document`);
  }
  const res = await fetch(doc.url);
  if (!res.ok) {
    throw new Error(`Failed to download DocuSeal document: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function downloadDocusealAuditTrail(submissionId: string): Promise<Buffer | null> {
  const submission = await fetchDocusealSubmission(submissionId);
  if (!submission.audit_log_url) return null;
  const res = await fetch(submission.audit_log_url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}
