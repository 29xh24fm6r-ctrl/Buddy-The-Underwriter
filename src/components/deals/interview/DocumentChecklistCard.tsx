// src/components/deals/interview/DocumentChecklistCard.tsx
"use client";

import React, { useMemo } from "react";
import { computeMissingFactKeys, getChecklistRule, normalizeLoanType } from "@/lib/interview/docChecklist";

type Fact = {
  id: string;
  field_key: string;
  confirmed: boolean;
  field_value: any;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function DocumentChecklistCard({
  facts,
  onJumpToKey,
}: {
  facts: Fact[];
  onJumpToKey?: (key: string) => void;
}) {
  const confirmedLoanTypeRaw = useMemo(() => {
    const f = facts.find((x) => x.confirmed && x.field_key === "loan_type_requested");
    return f?.field_value ?? null;
  }, [facts]);

  const rule = useMemo(() => {
    const lt = normalizeLoanType(confirmedLoanTypeRaw);
    return getChecklistRule(lt);
  }, [confirmedLoanTypeRaw]);

  const confirmedFactKeys = useMemo(() => {
    const set = new Set<string>();
    for (const f of facts) if (f.confirmed) set.add(f.field_key);
    return set;
  }, [facts]);

  const missingRequiredFacts = useMemo(() => computeMissingFactKeys(confirmedFactKeys, rule), [confirmedFactKeys, rule]);

  const requiredFactsDone = useMemo(() => {
    const required = rule.factKeys.filter((k) => k.required).length;
    const done = rule.factKeys.filter((k) => k.required).filter((k) => confirmedFactKeys.has(k.key)).length;
    return { required, done };
  }, [rule, confirmedFactKeys]);

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{rule.title}</div>
          <div className="text-xs text-muted-foreground">
            Checklist is guidance. Exact requests can vary by lender policy and deal specifics.
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Required facts:{" "}
          <span className="font-medium text-foreground">
            {requiredFactsDone.done}/{requiredFactsDone.required}
          </span>
        </div>
      </div>

      {missingRequiredFacts.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Missing required facts</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {missingRequiredFacts.map((k) => (
              <button
                key={k}
                type="button"
                className={cx("rounded-full border bg-background px-3 py-1 text-xs hover:bg-accent")}
                onClick={() => onJumpToKey?.(k)}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          ✅ Required facts are complete. Next step is document uploads + verification.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-3">
          <div className="text-sm font-medium">Facts (what Buddy will confirm)</div>
          <ul className="mt-2 space-y-2">
            {rule.factKeys.map((k) => {
              const ok = confirmedFactKeys.has(k.key);
              return (
                <li key={k.key} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-mono text-xs">{k.key}</div>
                    <div className="text-muted-foreground">{k.label}</div>
                  </div>
                  <div className={cx("text-xs", ok ? "text-emerald-600" : k.required ? "text-amber-600" : "text-muted-foreground")}>
                    {ok ? "confirmed" : k.required ? "required" : "optional"}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-lg border p-3">
          <div className="text-sm font-medium">Documents (typical)</div>
          <ul className="mt-2 space-y-2">
            {rule.docs.map((d) => (
              <li key={d.key} className="text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs">{d.key}</div>
                    <div className="text-muted-foreground">{d.label}</div>
                    {d.notes ? <div className="text-xs text-muted-foreground mt-1">{d.notes}</div> : null}
                  </div>
                  <div className={cx("text-xs", d.required ? "text-amber-600" : "text-muted-foreground")}>
                    {d.required ? "required" : "optional"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Note: "Required" here means required for a complete intake experience. Underwriting decisions are based on verified documentation and policy.
      </div>
    </div>
  );
}
