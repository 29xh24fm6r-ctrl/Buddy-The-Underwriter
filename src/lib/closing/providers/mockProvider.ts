/**
 * Phase 57 — Mock Closing Provider
 *
 * First implementation for development and testing.
 * Real providers (DocuSign, etc.) plug in via the same interface.
 */

import type { ClosingProvider, CreateEnvelopeInput, CreateEnvelopeResult, EnvelopeStatus } from "./types";

export const mockProvider: ClosingProvider = {
  name: "mock",

  async createEnvelope(input: CreateEnvelopeInput): Promise<CreateEnvelopeResult> {
    const envelopeId = `mock-env-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return { ok: true, providerEnvelopeId: envelopeId, status: "sent" };
  },

  async getEnvelopeStatus(providerEnvelopeId: string): Promise<EnvelopeStatus> {
    return {
      providerEnvelopeId,
      status: "sent",
      recipients: [],
    };
  },

  async voidEnvelope(providerEnvelopeId: string, reason: string) {
    return { ok: true };
  },

  async downloadCompletedArtifacts(providerEnvelopeId: string) {
    return { ok: true, files: [] };
  },
};
