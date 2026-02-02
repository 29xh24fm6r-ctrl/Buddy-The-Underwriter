/**
 * /policy - Living Credit Policy
 *
 * Shows uploaded policy docs, extracted rules, drift indicators,
 * and suggested policy updates.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import {
  GlassShell,
  GlassPageHeader,
  GlassPanel,
  GlassActionCard,
} from "@/components/layout";

export default async function PolicyPage() {
  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) redirect("/select-bank");
  const bankId = bankPick.bankId;
  const sb = supabaseAdmin();

  // Fetch extracted policy rules
  const { data: extractedRules } = await sb
    .from("policy_extracted_rules")
    .select("*")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false });

  // Fetch committee policy
  const { data: committeePolicy } = await sb
    .from("bank_credit_committee_policies")
    .select("*")
    .eq("bank_id", bankId)
    .maybeSingle();

  // Fetch attestation policy
  const { data: attestationPolicy } = await sb
    .from("bank_attestation_policies")
    .select("*")
    .eq("bank_id", bankId)
    .maybeSingle();

  return (
    <GlassShell>
      <GlassPageHeader
        title="Living Credit Policy"
        subtitle="Policy documents, extracted rules, and drift detection"
      />

      {/* Active Policies */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Committee Policy */}
        <GlassPanel header="Committee Policy">
          {committeePolicy ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60">Status:</span>
                <span
                  className={`font-medium ${committeePolicy.enabled ? "text-emerald-400" : "text-white/40"}`}
                >
                  {committeePolicy.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="mt-3">
                <h4 className="text-sm font-medium text-white/70 mb-2">Trigger Rules</h4>
                <div className="space-y-1 text-xs">
                  {Object.entries(committeePolicy.rules_json || {}).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between bg-white/[0.03] p-2 rounded border border-white/5"
                    >
                      <span className="text-white/60">{key.replace(/_/g, " ")}</span>
                      <span className="font-mono font-medium text-white">
                        {JSON.stringify(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/50">Not configured</p>
          )}
        </GlassPanel>

        {/* Attestation Policy */}
        <GlassPanel header="Attestation Policy">
          {attestationPolicy ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60">Required Count:</span>
                <span className="font-medium text-purple-400">
                  {attestationPolicy.required_count}
                </span>
              </div>
              {attestationPolicy.required_roles &&
                attestationPolicy.required_roles.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-white/70 mb-2">Required Roles</h4>
                    <div className="flex flex-wrap gap-2">
                      {attestationPolicy.required_roles.map((role: string) => (
                        <span
                          key={role}
                          className="text-xs bg-purple-500/20 text-purple-300 px-2 py-1 rounded border border-purple-500/30"
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          ) : (
            <p className="text-sm text-white/50">Not configured</p>
          )}
        </GlassPanel>
      </div>

      {/* Extracted Policy Rules */}
      <GlassPanel header="AI-Extracted Policy Rules" className="mb-6">
        <p className="text-sm text-white/60 mb-4">
          Rules extracted from uploaded policy documents. Requires human approval before
          enforcement.
        </p>
        {extractedRules && extractedRules.length > 0 ? (
          <div className="space-y-3">
            {extractedRules.map((rule: any) => (
              <div
                key={rule.id}
                className={`border-l-4 p-3 rounded ${
                  rule.approved
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-amber-500 bg-amber-500/10"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-sm text-white">
                    Policy Rule #{rule.id.slice(0, 8)}
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      rule.approved
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    }`}
                  >
                    {rule.approved ? "Approved" : "Pending Review"}
                  </span>
                </div>
                <div className="text-xs space-y-1">
                  {Object.entries(rule.rules_json || {}).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-white/60">{key.replace(/_/g, " ")}</span>
                      <span className="font-mono font-medium text-white">
                        {JSON.stringify(value)}
                      </span>
                    </div>
                  ))}
                </div>
                {rule.explanation && (
                  <div className="mt-2 text-xs text-white/70 italic">{rule.explanation}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/50">
            No extracted rules yet. Upload policy documents and run extraction.
          </p>
        )}
      </GlassPanel>

      {/* Policy Actions */}
      <div className="grid grid-cols-2 gap-4">
        <GlassActionCard
          icon="groups"
          iconColor="text-purple-400"
          title="Configure Committee Policy"
          description="Set trigger rules for committee review"
          href="/settings/committee"
          actionLabel="Configure"
        />
        <GlassActionCard
          icon="verified_user"
          iconColor="text-emerald-400"
          title="Configure Attestation Policy"
          description="Set required signatories and roles"
          href="/settings/attestation"
          actionLabel="Configure"
        />
      </div>
    </GlassShell>
  );
}
