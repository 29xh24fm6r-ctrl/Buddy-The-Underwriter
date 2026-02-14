/**
 * Phase 12 — Registry Versioning Types
 */

export type RegistryStatus = "draft" | "published" | "deprecated";

export interface RegistryVersion {
  id: string;
  versionName: string;
  versionNumber: number;
  contentHash: string | null;
  status: RegistryStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface RegistryEntry {
  id: string;
  registryVersionId: string;
  metricKey: string;
  definitionJson: Record<string, unknown>;
  definitionHash: string | null;
  createdAt: string;
}

/**
 * Registry binding embedded in every V2 snapshot.
 */
export interface RegistryBinding {
  registryVersionId: string;
  registryVersionName: string;
  registryContentHash: string;
}

/**
 * Phase 13 — Per-bank registry pin.
 * Allows a bank to be locked to a specific registry version.
 */
export interface BankRegistryPin {
  id: string;
  bankId: string;
  registryVersionId: string;
  pinnedAt: string;
  pinnedBy: string | null;
  reason: string | null;
}
