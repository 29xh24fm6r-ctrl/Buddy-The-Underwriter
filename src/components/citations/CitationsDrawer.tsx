/**
 * Citations Drawer Component
 * 
 * Displays inline [1], [2], [3] style citations that expand to show:
 * - Source label (Deal Doc / SBA SOP / Bank Policy)
 * - Page number
 * - Quote snippet
 * - Link to view full document
 */

"use client";

import { useState } from "react";
import { X, FileText, BookOpen, Building2 } from "lucide-react";

export interface Citation {
  source_kind: "DEAL_DOC" | "SBA_SOP" | "BANK_POLICY";
  label: string;
  page?: number;
  page_start?: number;
  page_end?: number;
  section?: string;
  quote: string;
  chunk_id?: string;
}

interface CitationsDrawerProps {
  citations: Citation[];
  dealId?: string;
}

export function CitationsDrawer({ citations, dealId }: CitationsDrawerProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (citations.length === 0) return null;

  const getIcon = (kind: Citation["source_kind"]) => {
    switch (kind) {
      case "DEAL_DOC":
        return <FileText className="h-4 w-4 text-blue-600" />;
      case "SBA_SOP":
        return <BookOpen className="h-4 w-4 text-green-600" />;
      case "BANK_POLICY":
        return <Building2 className="h-4 w-4 text-purple-600" />;
    }
  };

  const getPageDisplay = (c: Citation) => {
    if (c.page) return `p${c.page}`;
    if (c.page_start && c.page_end) return `pp${c.page_start}-${c.page_end}`;
    return "";
  };

  return (
    <div className="mt-6 border-t pt-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-3">Citations</h4>
      <div className="space-y-2">
        {citations.map((citation, idx) => (
          <div
            key={idx}
            className="border rounded-lg p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <button
              onClick={() => setExpanded(expanded === idx ? null : idx)}
              className="w-full text-left flex items-start gap-2"
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-white border border-gray-300 flex items-center justify-center text-xs font-medium">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {getIcon(citation.source_kind)}
                  <span className="font-medium text-sm text-gray-900">
                    {citation.label}
                  </span>
                  {getPageDisplay(citation) && (
                    <span className="text-xs text-gray-500">
                      {getPageDisplay(citation)}
                    </span>
                  )}
                </div>
                {expanded === idx && (
                  <div className="mt-2 text-sm text-gray-700 bg-white p-3 rounded border">
                    <p className="italic">"{citation.quote}"</p>
                    {citation.section && (
                      <p className="mt-2 text-xs text-gray-600">
                        Section: {citation.section}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Inline Citation Component (for use in text)
 * 
 * Usage: This is eligible <InlineCitation index={1} /> per SBA rules.
 */

interface InlineCitationProps {
  index: number;
  onClick?: () => void;
}

export function InlineCitation({ index, onClick }: InlineCitationProps) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium hover:bg-blue-200 transition-colors mx-0.5"
      title={`View citation ${index}`}
    >
      {index}
    </button>
  );
}

/**
 * Text with Citations Parser
 * 
 * Parses text like "This is eligible [1] per SBA rules [2]."
 * and renders inline citations as clickable buttons.
 */

interface TextWithCitationsProps {
  text: string;
  citations: Citation[];
  onCitationClick?: (index: number) => void;
}

export function TextWithCitations({ text, citations, onCitationClick }: TextWithCitationsProps) {
  // Parse [1], [2], etc. and replace with InlineCitation components
  const parts = text.split(/(\[\d+\])/g);

  return (
    <p className="text-gray-900">
      {parts.map((part, idx) => {
        const match = part.match(/\[(\d+)\]/);
        if (match) {
          const citationIndex = parseInt(match[1], 10);
          return (
            <InlineCitation
              key={idx}
              index={citationIndex}
              onClick={() => onCitationClick?.(citationIndex - 1)}
            />
          );
        }
        return <span key={idx}>{part}</span>;
      })}
    </p>
  );
}
