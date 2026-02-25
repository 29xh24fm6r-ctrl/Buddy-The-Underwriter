"use client";

import { useState } from "react";

/**
 * Extraction Evidence Panel (F2).
 *
 * Displays the "Why" behind extraction results:
 * - canonical_type
 * - anchors hit (extraction path)
 * - validator checks (pass/fail)
 * - extracted key facts list
 * - any conflicts (entity, year, validation)
 *
 * This is the trust surface — every doc shows evidence.
 */

// ── Types ─────────────────────────────────────────────────────────────

type ValidationCheck = {
  check: string;
  result: {
    status: "PASSED" | "SUSPECT";
    reason_code: string | null;
    message: string | null;
  };
};

type ExtractionEvidencePanelProps = {
  /** Canonical document type */
  canonicalType: string | null;
  /** Extraction path (gemini_structured, ocr_regex, etc.) */
  extractionPath: string | null;
  /** Extraction quality status */
  qualityStatus: "PASSED" | "SUSPECT" | null;
  /** Validator checks with pass/fail results */
  validationChecks?: ValidationCheck[];
  /** Extracted key facts (fact_key → value) */
  extractedFacts?: Array<{ factKey: string; value: number | string | null }>;
  /** Any conflicts detected */
  conflicts?: Array<{ type: string; detail: string }>;
  /** Engine version */
  engineVersion?: string | null;
  /** Prompt version */
  promptVersion?: string | null;
  /** Schema version */
  schemaVersion?: string | null;
};

// ── Component ─────────────────────────────────────────────────────────

export function ExtractionEvidencePanel({
  canonicalType,
  extractionPath,
  qualityStatus,
  validationChecks,
  extractedFacts,
  conflicts,
  engineVersion,
  promptVersion,
  schemaVersion,
}: ExtractionEvidencePanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-zinc-700 rounded-lg bg-zinc-900/50 text-sm">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-800/50 rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-400 text-xs">Extraction Evidence</span>
          {qualityStatus && (
            <span
              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                qualityStatus === "PASSED"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-amber-500/20 text-amber-400"
              }`}
            >
              {qualityStatus}
            </span>
          )}
          {conflicts && conflicts.length > 0 && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400">
              {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span className="text-zinc-500 text-xs">{expanded ? "collapse" : "expand"}</span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-zinc-800">
          {/* Type + Path */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div>
              <span className="text-zinc-500 text-xs block">Type</span>
              <span className="text-zinc-200 text-xs font-mono">
                {canonicalType ?? "—"}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 text-xs block">Extraction Path</span>
              <span className="text-zinc-200 text-xs font-mono">
                {extractionPath ?? "—"}
              </span>
            </div>
          </div>

          {/* Validator Checks */}
          {validationChecks && validationChecks.length > 0 && (
            <div>
              <span className="text-zinc-500 text-xs block mb-1">Validation Checks</span>
              <div className="space-y-1">
                {validationChecks.map((vc, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        vc.result.status === "PASSED"
                          ? "bg-emerald-400"
                          : "bg-amber-400"
                      }`}
                    />
                    <span className="text-zinc-300">{vc.check}</span>
                    {vc.result.reason_code && (
                      <span className="text-zinc-500">({vc.result.reason_code})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Conflicts */}
          {conflicts && conflicts.length > 0 && (
            <div>
              <span className="text-red-400 text-xs block mb-1">Conflicts</span>
              <div className="space-y-1">
                {conflicts.map((c, i) => (
                  <div key={i} className="text-xs text-red-300 bg-red-500/10 px-2 py-1 rounded">
                    <span className="font-medium">{c.type}:</span> {c.detail}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Extracted Facts */}
          {extractedFacts && extractedFacts.length > 0 && (
            <div>
              <span className="text-zinc-500 text-xs block mb-1">
                Extracted Facts ({extractedFacts.length})
              </span>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 max-h-32 overflow-y-auto">
                {extractedFacts.map((f, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-zinc-400 truncate">{f.factKey}</span>
                    <span className="text-zinc-200 font-mono ml-1">
                      {f.value != null ? String(f.value) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Versioning */}
          <div className="flex gap-3 text-[10px] text-zinc-600 pt-1 border-t border-zinc-800">
            {engineVersion && <span>engine: {engineVersion}</span>}
            {promptVersion && <span>prompts: {promptVersion}</span>}
            {schemaVersion && <span>schema: {schemaVersion}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
