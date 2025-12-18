"use client";

import { useState } from "react";

interface DealSetupCardProps {
  dealId: string;
}

export default function DealSetupCard({ dealId }: DealSetupCardProps) {
  const [loanType, setLoanType] = useState<string>("sba-7a");
  const [saving, setSaving] = useState(false);

  const handleLoanTypeChange = async (newType: string) => {
    setSaving(true);
    setLoanType(newType);

    try {
      // TODO: Persist to API
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log(`Loan type updated to: ${newType} for deal ${dealId}`);
    } catch (err) {
      console.error("Error updating loan type:", err);
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

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="mb-3">
        <h3 className="font-semibold text-sm mb-1">Deal Setup</h3>
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

      {/* Future: Add more deal config here */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500 italic">Additional settings coming soon</p>
      </div>
    </div>
  );
}
