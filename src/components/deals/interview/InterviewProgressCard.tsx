// src/components/deals/interview/InterviewProgressCard.tsx
"use client";

import React, { useMemo } from "react";
import type { AllowedFactKey } from "@/lib/interview/factKeys";
import { getRequiredFactKeys, normalizeLoanType } from "@/lib/interview/progress";

type Fact = {
  field_key: string;
  field_value: any;
  value_text: string | null;
  confirmed: boolean;
  created_at: string;
  confirmed_at: string | null;
  metadata?: any;
};

function pct(n: number, d: number) {
  if (d <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((n / d) * 100)));
}

function displayVal(f: Fact | null) {
  if (!f) return "";
  if (f.value_text) return f.value_text;
  if (typeof f.field_value === "string") return f.field_value;
  if (typeof f.field_value === "number" || typeof f.field_value === "boolean") return String(f.field_value);
  try {
    return JSON.stringify(f.field_value);
  } catch {
    return String(f.field_value);
  }
}

export default function InterviewProgressCard({
  facts,
  onJumpToMissingKey,
}: {
  facts: Fact[];
  onJumpToMissingKey?: (key: string) => void;
}) {
  const confirmedByKey = useMemo(() => {
    const map = new Map<string, Fact>();
    for (const f of facts) {
      if (!f.confirmed) continue;
      const existing = map.get(f.field_key);
      if (!existing) map.set(f.field_key, f);
      else {
        const a = existing.confirmed_at || existing.created_at;
        const b = f.confirmed_at || f.created_at;
        if (new Date(b).getTime() > new Date(a).getTime()) map.set(f.field_key, f);
      }
    }
    return map;
  }, [facts]);

  const requiredKeys = useMemo(() => getRequiredFactKeys(confirmedByKey), [confirmedByKey]);

  const suggestedPending = useMemo(() => {
    return facts.filter((f) => !f.confirmed && !!f.metadata?.suggested);
  }, [facts]);

  const confirmedRequiredCount = useMemo(() => {
    let c = 0;
    for (const k of requiredKeys) if (confirmedByKey.has(k)) c++;
    return c;
  }, [requiredKeys, confirmedByKey]);

  const percent = pct(confirmedRequiredCount, requiredKeys.length);

  const loanType = useMemo(() => {
    const f = confirmedByKey.get("loan_type_requested") || null;
    const norm = normalizeLoanType(f?.field_value);
    return norm || (f ? String(f.field_value || "").toUpperCase() : null);
  }, [confirmedByKey]);

  const missingKeys = useMemo(() => {
    return requiredKeys.filter((k) => !confirmedByKey.has(k));
  }, [requiredKeys, confirmedByKey]);

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Borrower Progress</div>
          <div className="text-xs text-muted-foreground">
            Progress is based on <span className="font-medium">confirmed</span> facts only.
          </div>
        </div>
        {loanType ? (
          <div className="text-xs text-muted-foreground">
            Loan type: <span className="font-mono">{loanType}</span>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            {confirmedRequiredCount}/{requiredKeys.length} required facts confirmed
          </div>
          <div>{percent}%</div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>

        {suggestedPending.length > 0 ? (
          <div className="text-xs text-muted-foreground">
            {suggestedPending.length} suggested facts waiting for one-tap confirm
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Confirmed highlights</div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-medium">{displayVal(confirmedByKey.get("requested_amount") || null)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Business</span>
              <span className="font-medium truncate max-w-[14rem]">
                {displayVal(confirmedByKey.get("legal_business_name") || null)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Contact</span>
              <span className="font-medium truncate max-w-[14rem]">
                {displayVal(confirmedByKey.get("best_contact_email") || null)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Next missing facts</div>
          <div className="mt-2 space-y-1">
            {missingKeys.slice(0, 5).map((k) => (
              <button
                key={k}
                type="button"
                className="w-full rounded-md border px-2 py-1 text-left text-xs hover:bg-accent"
                onClick={() => onJumpToMissingKey?.(k)}
                title="Jump to manual fact entry for this key"
              >
                <span className="font-mono">{k}</span>
              </button>
            ))}
            {missingKeys.length === 0 ? (
              <div className="text-xs text-muted-foreground">All required facts confirmed 🎯</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        Auditor note: Required keys are deterministic from your policy list; nothing is inferred.
      </div>
    </div>
  );
}
