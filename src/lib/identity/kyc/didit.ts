import "server-only";
import { z } from "zod";

/**
 * Pure HTTP wrapper around the Didit v3 identity verification API.
 * https://docs.didit.me — base URL https://verification.didit.me/v3,
 * auth header x-api-key. Replaces src/lib/identity/kyc/persona.ts (see
 * docs/build-logs/ARC00_VENDOR_PROVISIONING_CHECKLIST.md item 2 for why:
 * Didit's IAL2-equivalent workflow — ID scan + liveness + face match — is
 * 80% cheaper than Persona with a permanent 500/mo free tier).
 *
 * No DIDIT_API_KEY is configured in this environment — calls here throw a
 * clear configuration error rather than silently no-op.
 */

const DIDIT_BASE_URL = "https://verification.didit.me/v3";

function getApiKey(): string {
  const key = process.env.DIDIT_API_KEY;
  if (!key) {
    throw new Error("Missing DIDIT_API_KEY — Didit account not yet provisioned. See .env.example.");
  }
  return key;
}

async function diditFetch(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${DIDIT_BASE_URL}${path}`, {
    ...init,
    headers: {
      "x-api-key": getApiKey(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Didit API ${path} failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json();
}

const DiditSessionSchema = z.object({
  session_id: z.string(),
  session_number: z.number().optional(),
  vendor_data: z.string().nullable().optional(),
  status: z.string(),
  workflow_id: z.string(),
  callback: z.string().nullable().optional(),
  url: z.string(),
});
export type DiditSession = z.infer<typeof DiditSessionSchema>;

/**
 * Create a hosted KYC verification session. Redirect the borrower to
 * `session.url` (or embed in an iframe) — Didit's hosted UI handles ID
 * capture, liveness, and face match, then notifies Buddy via webhook.
 * `vendorData` = `deal:${dealId}:owner:${ownershipEntityId}` for
 * unambiguous webhook routing, mirroring the Persona referenceId pattern.
 */
export async function createDiditSession(args: {
  workflowId: string;
  vendorData: string;
  callbackUrl?: string;
}): Promise<DiditSession> {
  const raw = await diditFetch("/session/", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: args.workflowId,
      vendor_data: args.vendorData,
      callback: args.callbackUrl,
    }),
  });
  return DiditSessionSchema.parse(raw);
}

export async function fetchDiditSession(sessionId: string): Promise<DiditSession> {
  const raw = await diditFetch(`/session/${encodeURIComponent(sessionId)}/`, { method: "GET" });
  return DiditSessionSchema.parse(raw);
}

const DiditDecisionSchema = z.object({
  session_id: z.string(),
  status: z.string(),
}).passthrough();
export type DiditDecision = z.infer<typeof DiditDecisionSchema>;

export async function getDiditSessionDecision(sessionId: string): Promise<DiditDecision> {
  const raw = await diditFetch(`/session/${encodeURIComponent(sessionId)}/decision/`, { method: "GET" });
  return DiditDecisionSchema.parse(raw);
}
