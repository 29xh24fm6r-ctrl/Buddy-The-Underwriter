"use client";

import React, { useState } from "react";

/**
 * SBA God Mode: Explain Why Drawer
 * 
 * Side drawer that explains underwriting decisions in plain English.
 * No jargon, no PDFs, just clear explanations.
 */

interface ExplainWhyDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  topic: string;
  dealId: string;
}

interface Explanation {
  plain_english: string;
  key_factors: string[];
  what_you_can_do: string[];
  sba_rule_citation?: string;
}

export function ExplainWhyDrawer({ isOpen, onClose, topic, dealId }: ExplainWhyDrawerProps) {
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (isOpen && topic) {
      loadExplanation();
    }
  }, [isOpen, topic]);

  const loadExplanation = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/explain?topic=${encodeURIComponent(topic)}`);
      const data = await res.json();
      if (data.ok) {
        setExplanation(data.explanation);
      }
    } catch (err) {
      console.error("Failed to load explanation:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-semibold">Why is this required?</h2>
              <p className="text-sm text-gray-600 mt-1">{topic}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm text-gray-600">Generating explanation...</p>
            </div>
          ) : explanation ? (
            <>
              {/* Plain English Explanation */}
              <section>
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <span>💡</span>
                  Here's the deal
                </h3>
                <p className="text-gray-700 leading-relaxed">{explanation.plain_english}</p>
              </section>

              {/* Key Factors */}
              {explanation.key_factors.length > 0 && (
                <section>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span>🔍</span>
                    What we're looking at
                  </h3>
                  <ul className="space-y-2">
                    {explanation.key_factors.map((factor, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-blue-500 mt-1">•</span>
                        <span className="text-gray-700">{factor}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* What You Can Do */}
              {explanation.what_you_can_do.length > 0 && (
                <section>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span>✅</span>
                    What you can do
                  </h3>
                  <div className="space-y-2">
                    {explanation.what_you_can_do.map((action, idx) => (
                      <div key={idx} className="bg-blue-50 border border-blue-200 rounded p-3">
                        <p className="text-sm text-blue-900">{action}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* SBA Rule Citation */}
              {explanation.sba_rule_citation && (
                <section className="border-t pt-4">
                  <h3 className="text-sm font-medium text-gray-600 mb-2">The official rule</h3>
                  <p className="text-xs text-gray-500 bg-gray-50 p-3 rounded border">
                    {explanation.sba_rule_citation}
                  </p>
                </section>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <p>No explanation available for this topic.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 p-6">
          <p className="text-xs text-gray-600 mb-3">
            Still confused? We're here to help.
          </p>
          <button className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
            Chat with Support
          </button>
        </div>
      </div>
    </>
  );
}
