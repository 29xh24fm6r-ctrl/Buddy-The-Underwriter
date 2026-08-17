import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { VENDOR_NPI_APPROVAL } from "./vendorApproval";
import type { GatewayProvider } from "./roleConfig";

export type AIProviderCommissioningStatus = {
  provider: GatewayProvider;
  label: string;
  roles: string;
  credentialConfigured: boolean;
  npiApproved: boolean;
  recentSuccesses: number;
  recentFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  commissioned: boolean;
};

export type AICommissioningReadiness = {
  fullyCommissioned: boolean;
  providers: AIProviderCommissioningStatus[];
};

type GatewayRow = {
  provider: string;
  outcome: string;
  created_at: string;
};

const PROVIDERS: Array<{
  provider: GatewayProvider;
  label: string;
  roles: string;
  credential: () => boolean;
}> = [
  {
    provider: "google",
    label: "Gemini",
    roles: "Primary generator",
    credential: () => Boolean(process.env.GEMINI_API_KEY),
  },
  {
    provider: "openai",
    label: "OpenAI",
    roles: "Structurer and generator failover",
    credential: () => Boolean(process.env.OPENAI_API_KEY),
  },
  {
    provider: "anthropic",
    label: "Claude",
    roles: "Independent verifier",
    credential: () => Boolean(process.env.ANTHROPIC_API_KEY),
  },
];

export function buildAICommissioningReadiness(rows: GatewayRow[]): AICommissioningReadiness {
  const providers = PROVIDERS.map((definition) => {
    const calls = rows.filter((row) => row.provider === definition.provider);
    const successes = calls.filter((row) => row.outcome === "success");
    const failures = calls.filter((row) => row.outcome === "failure");
    const credentialConfigured = definition.credential();
    const npiApproved = VENDOR_NPI_APPROVAL[definition.provider] === "APPROVED";
    const lastSuccessAt = successes[0]?.created_at ?? null;
    const lastFailureAt = failures[0]?.created_at ?? null;

    return {
      provider: definition.provider,
      label: definition.label,
      roles: definition.roles,
      credentialConfigured,
      npiApproved,
      recentSuccesses: successes.length,
      recentFailures: failures.length,
      lastSuccessAt,
      lastFailureAt,
      // A key and approval are necessary but not sufficient: require a
      // recorded successful production adapter call as commissioning proof.
      commissioned: credentialConfigured && npiApproved && lastSuccessAt !== null,
    };
  });

  return {
    fullyCommissioned: providers.every((provider) => provider.commissioned),
    providers,
  };
}

export async function getAICommissioningReadiness(
  sb: SupabaseClient,
): Promise<AICommissioningReadiness> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("ai_gateway_calls")
    .select("provider,outcome,created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("[ai-commissioning] gateway ledger read failed", error.message);
  }

  return buildAICommissioningReadiness((data ?? []) as GatewayRow[]);
}
