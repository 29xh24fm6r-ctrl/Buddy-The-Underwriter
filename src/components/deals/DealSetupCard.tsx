"use client";

import { useState, useEffect } from "react";

interface DealSetupCardProps {
  dealId: string;
}

export default function DealSetupCard({ dealId }: DealSetupCardProps) {
  const [loanType, setLoanType] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [loading, setLoading] = useState(true);

  // Load current loan type from deal intake on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/intake/get`);
        const data = await res.json();
        if (data?.ok && data?.intake?.loan_type) {
          setLoanType(data.intake.loan_type);
        } else {
          setLoanType("sba-7a"); // default for new deals
        }
      } catch {
        setLoanType("sba-7a");
      } finally {
        setLoading(false);
      }
    })();
  }, [dealId]);

  const handleLoanTypeChange = async (newType: string) => {
    setSaving(true);
    setSaveStatus("idle");
    const prevType = loanType;
    setLoanType(newType); // optimistic

    try {
      const res = await fetch(`/api/deals/${dealId}/intake/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loanType: newType }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setLoanType(prevType); // revert
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    } catch {
      setLoanType(prevType); // revert
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setSaving(false);
    }
  };

  const loanTypes = [
    { id: "sba-7a", label: "SBA 7(a)", desc: "General purpose loans" },
    { id: "sba-504", label: "SBA 504", desc: "Real estate/equipment" },
    { id: "cre", label: "CRE", desc: "Commercial real estate" },
    { id: "loc", label: "LOC", desc: "Line of credit" },
    { id: "term", label: "Term Loan", desc: "Fixed term financing" },
  ];

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm mb-1">Deal Setup</h3>
          {saveStatus === "saved" && (
            <span className="text-xs text-emerald-600 font-medium">Saved</span>
          )}
          {saveStatus === "error" && (
            <span className="text-xs text-red-600 font-medium">Save failed — try again</span>
          )}
        </div>
        <p className="text-xs text-gray-600">Configure loan parameters</p>
      </div>

      {/* Loan Type Selector */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">Loan Type</label>
        <div className="space-y-2">
          {loanTypes.map((type) => (
            <label
              key={type.id}
              className={`flex items-start p-2 rounded border cursor-pointer transition-colors ${
                loanType === type.id
                  ? "bg-blue-50 border-blue-300"
                  : "bg-white border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="loanType"
                value={type.id}
                checked={loanType === type.id}
                onChange={(e) => handleLoanTypeChange(e.target.value)}
                disabled={saving}
                className="mt-0.5 mr-2"
              />
              <div className="flex-1">
                <div className="font-medium text-sm">{type.label}</div>
                <div className="text-xs text-gray-600">{type.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
