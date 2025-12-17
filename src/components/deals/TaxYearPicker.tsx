import React from "react";

type TaxYearOption = {
  year: number;
  label: string;
  sublabel: string;
};

type Props = {
  years: TaxYearOption[];
  selectedYear: number | null;
  onSelect: (year: number) => void;
};

export default function TaxYearPicker({ years, selectedYear, onSelect }: Props) {
  return (
    <div className="border rounded p-3 bg-gray-50">
      <div className="text-sm font-medium text-gray-700 mb-2">Tax Year</div>
      <div className="flex flex-wrap gap-2">
        {years.map((opt) => (
          <button
            key={opt.year}
            onClick={() => onSelect(opt.year)}
            className={`px-3 py-1 rounded text-sm border transition-colors ${
              selectedYear === opt.year
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
            }`}
          >
            <div className="font-medium">{opt.label}</div>
            <div className="text-xs opacity-75">{opt.sublabel}</div>
          </button>
        ))}
      </div>
    </div>
  );
}