"use client";

import { useState, useEffect } from "react";

interface PolicyDefault {
  field_name: string;
  field_label: string;
  field_type: string;
  default_value: any;
  confidence_score: number;
  source_text: string;
  min_value?: number | null;
  max_value?: number | null;
}

interface FormFieldWithDefaultProps {
  fieldName: string;
  label: string;
  value: string | number;
  onChange: (value: string | number) => void;
  policyDefault?: PolicyDefault | null;
  type?: "text" | "number" | "percentage" | "currency";
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function FormFieldWithDefault({
  fieldName,
  label,
  value,
  onChange,
  policyDefault,
  type = "text",
  placeholder,
  required = false,
  disabled = false,
  className = "",
}: FormFieldWithDefaultProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  // Check if current value deviates from policy default
  const isDeviation = useMemo(() => {
    if (policyDefault && value) {
      const defaultVal = policyDefault.default_value?.toString() || "";
      const currentVal = value.toString();
      return currentVal !== defaultVal && defaultVal !== "";
    }
    return false;
  }, [value, policyDefault]);

  function handleApplyDefault() {
    if (policyDefault?.default_value !== undefined) {
      onChange(policyDefault.default_value);
    }
  }

  function renderInput() {
    const baseClasses = `w-full px-3 py-2 border rounded-lg ${
      isDeviation ? "border-yellow-400 bg-yellow-50" : "border-gray-300"
    } ${disabled ? "bg-gray-100 cursor-not-allowed" : ""} ${className}`;

    if (type === "percentage" || type === "number") {
      return (
        <div className="relative">
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            className={baseClasses}
            min={policyDefault?.min_value ?? undefined}
            max={policyDefault?.max_value ?? undefined}
            step={type === "percentage" ? "0.1" : "1"}
          />
          {type === "percentage" && (
            <span className="absolute right-3 top-2.5 text-gray-500">%</span>
          )}
        </div>
      );
    }

    if (type === "currency") {
      return (
        <div className="relative">
          <span className="absolute left-3 top-2.5 text-gray-500">$</span>
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            className={`${baseClasses} pl-7`}
            min={policyDefault?.min_value ?? undefined}
            max={policyDefault?.max_value ?? undefined}
          />
        </div>
      );
    }

    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={baseClasses}
      />
    );
  }

  return (
    <div className="space-y-2">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>

        {/* Policy default badge */}
        {policyDefault && (
          <div className="flex items-center gap-2">
            {isDeviation && (
              <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                ⚠️ Deviates from policy
              </span>
            )}
            <div className="relative">
              <button
                type="button"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                onClick={handleApplyDefault}
                className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200"
              >
                📋 Policy Default
              </button>

              {/* Tooltip */}
              {showTooltip && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-lg z-10">
                  <div className="space-y-2">
                    <div>
                      <span className="font-medium">Default Value:</span>{" "}
                      {policyDefault.default_value}
                    </div>
                    <div>
                      <span className="font-medium">Confidence:</span>{" "}
                      {Math.round(policyDefault.confidence_score * 100)}%
                    </div>
                    {policyDefault.source_text && (
                      <div className="text-gray-300 italic border-t border-gray-700 pt-2">
                        "{policyDefault.source_text}"
                      </div>
                    )}
                    {(policyDefault.min_value !== null || policyDefault.max_value !== null) && (
                      <div className="text-gray-300 border-t border-gray-700 pt-2">
                        {policyDefault.min_value !== null && (
                          <div>Min: {policyDefault.min_value}</div>
                        )}
                        {policyDefault.max_value !== null && (
                          <div>Max: {policyDefault.max_value}</div>
                        )}
                      </div>
                    )}
                    <div className="border-t border-gray-700 pt-2 text-gray-400">
                      Click to apply default
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input field */}
      {renderInput()}

      {/* Validation messages */}
      {policyDefault && (
        <>
          {typeof policyDefault.min_value === 'number' && value && parseFloat(value.toString()) < policyDefault.min_value && (
            <p className="text-xs text-red-600">
              Below minimum: {policyDefault.min_value}
            </p>
          )}
          {typeof policyDefault.max_value === 'number' && value && parseFloat(value.toString()) > policyDefault.max_value && (
            <p className="text-xs text-red-600">
              Exceeds maximum: {policyDefault.max_value}
            </p>
          )}
        </>
      )}
    </div>
  );
}
