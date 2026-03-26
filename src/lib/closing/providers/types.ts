/**
 * Phase 57 — Closing Provider Abstraction
 */

export type CreateEnvelopeInput = {
  dealId: string;
  closingPackageId: string;
  documentIds: string[];
  recipients: Array<{
    name: string;
    email: string;
    role: string;
    routingOrder: number;
  }>;
};

export type CreateEnvelopeResult = {
  ok: boolean;
  providerEnvelopeId?: string;
  status?: "sent" | "draft";
  error?: string;
};

export type EnvelopeStatus = {
  providerEnvelopeId: string;
  status: "sent" | "delivered" | "completed" | "voided" | "declined";
  recipients: Array<{
    email: string;
    status: "sent" | "delivered" | "signed" | "completed" | "declined";
    signedAt?: string;
  }>;
};

export type ClosingProvider = {
  name: string;
  createEnvelope(input: CreateEnvelopeInput): Promise<CreateEnvelopeResult>;
  getEnvelopeStatus(providerEnvelopeId: string): Promise<EnvelopeStatus>;
  voidEnvelope(providerEnvelopeId: string, reason: string): Promise<{ ok: boolean; error?: string }>;
  downloadCompletedArtifacts(providerEnvelopeId: string): Promise<{
    ok: boolean;
    files?: Array<{ filename: string; bytes: Uint8Array }>;
    error?: string;
  }>;
};
