"use client";

import React, { useState } from "react";

interface BorrowerQaModalProps {
  dealId: string;
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * STEP 12: Text-based Q&A modal
 * Borrower asks a question → we show answer + citations
 */
export function BorrowerQaModal({
  dealId,
  sessionId,
  open,
  onClose,
}: BorrowerQaModalProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleAsk = async () => {
    if (!question.trim() || !sessionId) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/interview/sessions/${sessionId}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });

      if (!res.ok) throw new Error("Failed to get answer");

      const data = await res.json();
      setAnswer(data.answer);
      setCitations(data.citations || []);
    } catch (err) {
      console.error("Q&A error:", err);
      setAnswer("Sorry, I couldn't answer that right now. Please try again.");
      setCitations([]);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setQuestion("");
    setAnswer(null);
    setCitations([]);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>❓</span>
            <span>Ask Buddy anything</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 hover:bg-gray-100 text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {!answer ? (
            <>
              <textarea
                value={question}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQuestion(e.target.value)}
                placeholder="Type your question here... (e.g., 'What documents do I need for an SBA 7(a) loan?')"
                rows={4}
                className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
              <button
                onClick={handleAsk}
                disabled={!question.trim() || !sessionId || loading}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="animate-spin">⏳</span>
                    <span>Thinking...</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span>📤</span>
                    <span>Ask</span>
                  </span>
                )}
              </button>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-2">Your question:</h4>
                  <p className="text-gray-700">{question}</p>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-2">Buddy's answer:</h4>
                  <p className="text-gray-700 whitespace-pre-wrap">{answer}</p>
                </div>

                {citations.length > 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h4 className="font-semibold text-gray-900 mb-2">What Buddy used:</h4>
                    <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                      {citations.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <button
                onClick={handleBack}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span className="inline-flex items-center gap-2">
                  <span>←</span>
                  <span>Back to intake</span>
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
