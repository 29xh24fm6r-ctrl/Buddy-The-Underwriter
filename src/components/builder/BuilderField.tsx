"use client";

import { BuddySourceBadge } from "./BuddySourceBadge";

type BuilderFieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  source?: "buddy" | "manual" | null;
  type?: "text" | "number" | "date" | "textarea";
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  maxLength?: number;
};

export function BuilderField({
  label,
  value,
  onChange,
  source,
  type = "text",
  placeholder,
  disabled,
  min,
  maxLength,
}: BuilderFieldProps) {
  const inputCls =
    "w-full rounded-lg border border-white/15 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-white/70">{label}</label>
        <BuddySourceBadge source={source} />
      </div>
      {type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          rows={4}
          className={inputCls}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          maxLength={maxLength}
          className={inputCls}
        />
      )}
    </div>
  );
}
