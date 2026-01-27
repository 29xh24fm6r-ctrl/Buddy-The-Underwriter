/**
 * Copilot Actions — banker-only CTAs for validate + draft email.
 *
 * All actions are governed:
 *  - validate: read-only checks
 *  - draft email: generates plain text, does NOT send
 *
 * Client-side component.
 */
"use client";

import React, { useState } from "react";

// ── Types ─────────────────────────────────────────

type ActionResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

// ── Component ─────────────────────────────────────

export function CopilotActions({
  dealId,
  canValidate,
  canDraftEmail,
}: {
  dealId: string;
  canValidate: boolean;
  canDraftEmail: boolean;
}) {
  const [validateResult, setValidateResult] = useState<ActionResult | null>(null);
  const [emailResult, setEmailResult] = useState<ActionResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const runAction = async (path: string, setter: (r: ActionResult) => void) => {
    setLoading(path);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: dealId }),
      });
      const data = await res.json();
      setter({
        ok: data.ok,
        data: data.validation ?? data.draft ?? data,
        error: data.error?.message,
      });
    } catch (err) {
      setter({ ok: false, error: err instanceof Error ? err.message : "Action failed" });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {canValidate && (
          <button
            onClick={() => runAction("/api/copilot/validate", setValidateResult)}
            disabled={loading !== null}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading === "/api/copilot/validate" ? "Validating..." : "Validate Case"}
          </button>
        )}
        {canDraftEmail && (
          <button
            onClick={() => runAction("/api/copilot/draft-missing-docs-email", setEmailResult)}
            disabled={loading !== null}
            className="text-xs px-3 py-1.5 rounded bg-gray-600 text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {loading === "/api/copilot/draft-missing-docs-email" ? "Generating..." : "Draft Missing Docs Email"}
          </button>
        )}
      </div>

      {/* Validate result */}
      {validateResult && (
        <div className={`p-2 rounded text-xs ${validateResult.ok ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
          {validateResult.ok ? (
            <div>
              <div className="font-medium text-green-800 mb-1">Validation Complete</div>
              <ValidationChecks data={validateResult.data} />
            </div>
          ) : (
            <div className="text-red-700">Validation failed: {validateResult.error}</div>
          )}
        </div>
      )}

      {/* Email draft result */}
      {emailResult && (
        <div className={`p-2 rounded text-xs ${emailResult.ok ? "bg-blue-50 border border-blue-200" : "bg-red-50 border border-red-200"}`}>
          {emailResult.ok ? (
            <div>
              <div className="font-medium text-blue-800 mb-1">Draft Generated (Not Sent)</div>
              <pre className="text-[11px] font-mono whitespace-pre-wrap text-gray-700 bg-white p-2 rounded max-h-48 overflow-y-auto">
                {(emailResult.data as any)?.emailDraft ?? JSON.stringify(emailResult.data, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="text-red-700">Email generation failed: {emailResult.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

function ValidationChecks({ data }: { data: unknown }) {
  const checks = (data as any)?.checks;
  if (!Array.isArray(checks)) return null;

  return (
    <div className="space-y-0.5">
      {checks.map((c: { check: string; passed: boolean; detail: string }, i: number) => (
        <div key={i} className="flex gap-2 items-center">
          <span className={c.passed ? "text-green-600" : "text-red-600"}>
            {c.passed ? "PASS" : "FAIL"}
          </span>
          <span className="text-gray-700">{c.check}</span>
          <span className="text-gray-400 truncate">{c.detail}</span>
        </div>
      ))}
    </div>
  );
}
