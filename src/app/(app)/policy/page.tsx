/**
 * /policy - Living Credit Policy
 * 
 * Shows uploaded policy docs, extracted rules, drift indicators,
 * and suggested policy updates.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import Link from "next/link";

export default async function PolicyPage() {
  const bankId = await getCurrentBankId();
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
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Living Credit Policy</h1>
        <p className="text-sm text-gray-600 mt-1">
          Policy documents, extracted rules, and drift detection
        </p>
      </div>

      {/* Active Policies */}
      <div className="grid grid-cols-2 gap-4">
        {/* Committee Policy */}
        <div className="border rounded-lg p-4 bg-white">
          <h3 className="text-lg font-semibold mb-3">Committee Policy</h3>
          {committeePolicy ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Status:</span>
                <span className={`font-medium ${committeePolicy.enabled ? "text-green-600" : "text-gray-400"}`}>
                  {committeePolicy.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="mt-3">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Trigger Rules</h4>
                <div className="space-y-1 text-xs">
                  {Object.entries(committeePolicy.rules_json || {}).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <span className="text-gray-600">{key.replace(/_/g, " ")}</span>
                      <span className="font-mono font-medium">{JSON.stringify(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Not configured</p>
          )}
        </div>

        {/* Attestation Policy */}
        <div className="border rounded-lg p-4 bg-white">
          <h3 className="text-lg font-semibold mb-3">Attestation Policy</h3>
          {attestationPolicy ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Required Count:</span>
                <span className="font-medium text-purple-600">{attestationPolicy.required_count}</span>
              </div>
              {attestationPolicy.required_roles && attestationPolicy.required_roles.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Required Roles</h4>
                  <div className="flex flex-wrap gap-2">
                    {attestationPolicy.required_roles.map((role: string) => (
                      <span key={role} className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Not configured</p>
          )}
        </div>
      </div>

      {/* Extracted Policy Rules */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">AI-Extracted Policy Rules</h2>
        <p className="text-sm text-gray-600 mb-4">
          Rules extracted from uploaded policy documents. Requires human approval before enforcement.
        </p>
        {extractedRules && extractedRules.length > 0 ? (
          <div className="space-y-3">
            {extractedRules.map((rule: any) => (
              <div
                key={rule.id}
                className={`border-l-4 p-3 rounded ${
                  rule.approved
                    ? "border-green-500 bg-green-50"
                    : "border-yellow-500 bg-yellow-50"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-sm">
                    Policy Rule #{rule.id.slice(0, 8)}
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    rule.approved
                      ? "bg-green-100 text-green-800"
                      : "bg-yellow-100 text-yellow-800"
                  }`}>
                    {rule.approved ? "Approved" : "Pending Review"}
                  </span>
                </div>
                <div className="text-xs space-y-1">
                  {Object.entries(rule.rules_json || {}).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-gray-600">{key.replace(/_/g, " ")}</span>
                      <span className="font-mono font-medium">{JSON.stringify(value)}</span>
                    </div>
                  ))}
                </div>
                {rule.explanation && (
                  <div className="mt-2 text-xs text-gray-700 italic">
                    {rule.explanation}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No extracted rules yet. Upload policy documents and run extraction.
          </p>
        )}
      </div>

      {/* Policy Actions */}
      <div className="border rounded-lg p-4 bg-white">
        <h2 className="text-lg font-semibold mb-3">Policy Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/settings/committee"
            className="border rounded-lg p-3 hover:bg-gray-50 transition-colors"
          >
            <div className="font-medium text-sm">Configure Committee Policy</div>
            <div className="text-xs text-gray-600 mt-1">Set trigger rules for committee review</div>
          </Link>
          <Link
            href="/settings/attestation"
            className="border rounded-lg p-3 hover:bg-gray-50 transition-colors"
          >
            <div className="font-medium text-sm">Configure Attestation Policy</div>
            <div className="text-xs text-gray-600 mt-1">Set required signatories and roles</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
