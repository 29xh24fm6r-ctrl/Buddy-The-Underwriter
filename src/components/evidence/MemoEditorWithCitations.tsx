"use client";

import { useState, useRef, useEffect } from "react";
import { DocHighlightModal } from "@/components/evidence/DocHighlightModal";
import type { MemoCitation } from "@/lib/evidence/memoCitations";

type MemoEditorWithCitationsProps = {
  dealId: string;
  initialText?: string;
  initialCitations?: MemoCitation[];
  onSave?: (text: string, citations: MemoCitation[]) => void;
};

/**
 * Credit Memo Editor with Auto-Citations.
 * Banker writes memo → Buddy suggests citations → Click to insert → Click citation to view evidence.
 */
export function MemoEditorWithCitations(props: MemoEditorWithCitationsProps) {
  const { dealId, initialText = "", initialCitations = [], onSave } = props;

  const [text, setText] = useState(initialText);
  const [citations, setCitations] = useState<MemoCitation[]>(initialCitations);
  const [availableSpans, setAvailableSpans] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [selectedCitation, setSelectedCitation] = useState<MemoCitation | null>(null);
  const [showCitationModal, setShowCitationModal] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load available evidence spans
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/deals/${dealId}/ai-events?scope=doc_intel`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);

      if (json?.ok) {
        const spans: any[] = [];
        for (const event of json.events || []) {
          const evidenceSpans = event.evidence_json?.evidence_spans || [];
          spans.push(...evidenceSpans);
        }
        setAvailableSpans(spans.slice(0, 20)); // limit to top 20
      }
    })();
  }, [dealId]);

  // Auto-suggest citations when text changes
  useEffect(() => {
    if (!text || availableSpans.length === 0) {
      setSuggestions([]);
      return;
    }

    // Simple keyword matching (production would use NLP/embeddings)
    const textLower = text.toLowerCase();
    const matched: any[] = [];

    for (const span of availableSpans) {
      const labelLower = String(span.label || "").toLowerCase();
      if (textLower.includes(labelLower)) {
        matched.push({ span, matchScore: 80 });
      }
    }

    setSuggestions(matched.slice(0, 5));
  }, [text, availableSpans]);

  const insertCitation = (span: any) => {
    const cursorPos = textareaRef.current?.selectionStart || text.length;

    const citationId = `cite_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const citationNum = citations.length + 1;

    const newCitation: MemoCitation = {
      id: citationId,
      span_id: span.id || `span_${span.attachment_id}`,
      attachment_id: span.attachment_id,
      start: span.start,
      end: span.end,
      label: span.label || "Evidence",
      confidence: span.confidence,
    };

    const marker = `[${citationNum}](#${citationId})`;
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const newText = before + marker + after;

    setText(newText);
    setCitations([...citations, newCitation]);
  };

  const handleCitationClick = (citationId: string) => {
    const citation = citations.find((c) => c.id === citationId);
    if (citation) {
      setSelectedCitation(citation);
      setShowCitationModal(true);
    }
  };

  const handleSave = () => {
    if (onSave) onSave(text, citations);
  };

  return (
    <div className="space-y-4">
      {/* Editor Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900">Credit Memo</div>
          <div className="text-xs text-gray-600">Write your analysis. Buddy will suggest citations.</div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Save Memo
        </button>
      </div>

      {/* Text Editor */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-96 w-full rounded-lg border border-gray-300 p-4 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Write your credit memo here. Reference key facts from documents, and Buddy will suggest citations..."
          />

          {/* Citation Count */}
          <div className="mt-2 text-xs text-gray-600">
            {citations.length} citation{citations.length !== 1 ? "s" : ""} added
          </div>
        </div>

        {/* Citation Suggestions Panel */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="text-xs font-semibold text-gray-700">Suggested Citations</div>
          <div className="mt-3 space-y-2">
            {suggestions.length === 0 ? (
              <div className="text-xs text-gray-500">
                Start writing to see citation suggestions...
              </div>
            ) : (
              suggestions.map((sug, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => insertCitation(sug.span)}
                  className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-blue-500 hover:bg-blue-50"
                >
                  <div className="text-xs font-semibold text-gray-900">
                    {sug.span.label || "Evidence"}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-600">
                    Match score: {sug.matchScore}%
                  </div>
                  {sug.span.confidence ? (
                    <div className="mt-1 text-[11px] text-gray-600">
                      Confidence: {Math.round(sug.span.confidence)}%
                    </div>
                  ) : null}
                  <div className="mt-2 text-[11px] text-blue-600">Click to insert →</div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Preview with Clickable Citations */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-xs font-semibold text-gray-700">Preview</div>
        <div className="mt-3 whitespace-pre-wrap text-sm text-gray-900">
          <MemoPreview text={text} citations={citations} onCitationClick={handleCitationClick} />
        </div>
      </div>

      {/* Citation List */}
      {citations.length > 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold text-gray-700">Citations</div>
          <div className="mt-3 space-y-2">
            {citations.map((citation, idx) => (
              <div
                key={citation.id}
                className="flex items-start justify-between gap-3 rounded border border-gray-200 p-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-900">
                    [{idx + 1}] {citation.label}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-600">
                    Chars {citation.start}–{citation.end}
                    {citation.confidence ? ` · ${Math.round(citation.confidence)}% confidence` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCitation(citation);
                    setShowCitationModal(true);
                  }}
                  className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                >
                  View
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Citation Evidence Modal */}
      {selectedCitation && showCitationModal ? (
        <DocHighlightModal
          open={showCitationModal}
          onClose={() => setShowCitationModal(false)}
          title={selectedCitation.label}
          loader={async () => {
            const res = await fetch(
              `/api/deals/${dealId}/documents/${selectedCitation.attachment_id}/text`,
              { cache: "no-store" }
            );
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.ok) throw new Error("Failed to load document");

            const text = String(json.doc?.extracted_text || "");
            const start = selectedCitation.start;
            const end = selectedCitation.end;

            const contextChars = 200;
            const left = Math.max(0, start - contextChars);
            const right = Math.min(text.length, end + contextChars);
            const snippet = text.slice(left, right);

            return {
              snippet,
              highlightStart: start - left,
              highlightEnd: end - left,
              truncated: false,
            };
          }}
        />
      ) : null}
    </div>
  );
}

function MemoPreview(props: {
  text: string;
  citations: MemoCitation[];
  onCitationClick: (citationId: string) => void;
}) {
  const { text, citations, onCitationClick } = props;

  // Replace citation markers with clickable superscripts
  const parts: React.ReactNode[] = [];
  const regex = /\[(\d+)\]\(#([a-z0-9_]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const [fullMatch, num, citeId] = match;
    const beforeText = text.slice(lastIndex, match.index);

    parts.push(beforeText);
    parts.push(
      <sup
        key={citeId}
        className="cursor-pointer text-blue-600 hover:underline"
        onClick={() => onCitationClick(citeId)}
        title={citations.find((c) => c.id === citeId)?.label || "Citation"}
      >
        {num}
      </sup>
    );

    lastIndex = match.index + fullMatch.length;
  }

  parts.push(text.slice(lastIndex));

  return <>{parts}</>;
}
