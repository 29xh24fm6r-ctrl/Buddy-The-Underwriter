// src/components/borrower/EligibilityStatusCard.tsx
"use client";

import { useState, useEffect } from "react";
import { EligibilityResult } from "@/lib/sba7a/eligibility";

type Props = {
  token: string;
  answers: Record<string, any>;
  onEligibilityChange?: (result: EligibilityResult) => void;
};

export function EligibilityStatusCard({ token, answers, onEligibilityChange }: Props) {
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  
  // Re-evaluate eligibility whenever answers change
  useEffect(() => {
    evaluateEligibility();
  }, [answers]);
  
  const evaluateEligibility = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/borrower/${token}/eligibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      
      const data = await res.json();
      
      if (data.ok) {
        setEligibility(data.eligibility);
        onEligibilityChange?.(data.eligibility);
      }
    } catch (e) {
      console.error('Failed to evaluate eligibility:', e);
    } finally {
      setLoading(false);
    }
  };
  
  if (!eligibility) {
    return null;
  }
  
  const getStatusColor = () => {
    switch (eligibility.status) {
      case 'ELIGIBLE':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'INELIGIBLE':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'UNKNOWN':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };
  
  const getStatusIcon = () => {
    switch (eligibility.status) {
      case 'ELIGIBLE':
        return '✅';
      case 'INELIGIBLE':
        return '❌';
      case 'UNKNOWN':
        return '❓';
      default:
        return 'ℹ️';
    }
  };
  
  const getStatusTitle = () => {
    switch (eligibility.status) {
      case 'ELIGIBLE':
        return 'SBA 7(a) Eligible';
      case 'INELIGIBLE':
        return 'Not Eligible for SBA 7(a)';
      case 'UNKNOWN':
        return 'More Information Needed';
      default:
        return 'Eligibility Unknown';
    }
  };
  
  const getStatusMessage = () => {
    switch (eligibility.status) {
      case 'ELIGIBLE':
        return 'Based on your answers, you appear eligible for an SBA 7(a) loan. Continue to complete your application.';
      case 'INELIGIBLE':
        return 'Based on your answers, you may not qualify for an SBA 7(a) loan. See reasons below. You may still qualify for conventional financing.';
      case 'UNKNOWN':
        return 'We need more information to determine your SBA 7(a) eligibility. Please answer the questions below.';
      default:
        return '';
    }
  };
  
  return (
    <div className={`border rounded-lg p-6 ${getStatusColor()}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{getStatusIcon()}</span>
          <div>
            <h3 className="text-lg font-bold">{getStatusTitle()}</h3>
            <p className="text-sm mt-1">{getStatusMessage()}</p>
          </div>
        </div>
        
        {loading && (
          <div className="animate-spin h-5 w-5 border-2 border-current border-t-transparent rounded-full"></div>
        )}
      </div>
      
      {/* Progress Bar */}
      {eligibility.status === 'UNKNOWN' && eligibility.missing.length > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span>Application Progress</span>
            <span>{eligibility.gates_passed.length} / {eligibility.gates_passed.length + eligibility.missing.length} gates</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-500"
              style={{
                width: `${(eligibility.gates_passed.length / (eligibility.gates_passed.length + eligibility.missing.length)) * 100}%`,
              }}
            ></div>
          </div>
        </div>
      )}
      
      {/* Toggle Details */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="text-sm font-medium underline hover:no-underline"
      >
        {showDetails ? 'Hide Details' : 'Show Details'}
      </button>
      
      {/* Details */}
      {showDetails && (
        <div className="mt-4 space-y-4">
          {/* Gates Passed */}
          {eligibility.gates_passed.length > 0 && (
            <div>
              <h4 className="font-medium text-sm mb-2">✅ Gates Passed ({eligibility.gates_passed.length})</h4>
              <ul className="text-sm space-y-1 list-disc list-inside">
                {eligibility.gates_passed.map((gate, i) => (
                  <li key={i}>{gate}</li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Gates Failed */}
          {eligibility.gates_failed.length > 0 && (
            <div>
              <h4 className="font-medium text-sm mb-2">❌ Gates Failed ({eligibility.gates_failed.length})</h4>
              <ul className="text-sm space-y-1 list-disc list-inside">
                {eligibility.gates_failed.map((gate, i) => (
                  <li key={i}>{gate}</li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Reasons */}
          {eligibility.reasons.length > 0 && (
            <div>
              <h4 className="font-medium text-sm mb-2">Reasons</h4>
              <ul className="text-sm space-y-1">
                {eligibility.reasons.map((reason, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex-shrink-0">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Missing Info */}
          {eligibility.missing.length > 0 && (
            <div>
              <h4 className="font-medium text-sm mb-2">❓ Missing Information ({eligibility.missing.length})</h4>
              <ul className="text-sm space-y-1 list-disc list-inside">
                {eligibility.missing.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Warnings */}
          {eligibility.warnings.length > 0 && (
            <div>
              <h4 className="font-medium text-sm mb-2">⚠️ Warnings</h4>
              <ul className="text-sm space-y-1">
                {eligibility.warnings.map((warning, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex-shrink-0">•</span>
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      
      {/* Action Button */}
      {eligibility.status === 'INELIGIBLE' && (
        <div className="mt-4 pt-4 border-t border-current/20">
          <button className="text-sm font-medium underline hover:no-underline">
            Explore Conventional Financing Options →
          </button>
        </div>
      )}
    </div>
  );
}
