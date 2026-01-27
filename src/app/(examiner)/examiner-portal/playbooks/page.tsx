/**
 * Examiner Playbooks Page.
 *
 * Fetches and displays the examiner playbooks bundle.
 * Shows playbook hash for integrity verification.
 * Grant-scoped, read-only.
 */
"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Playbook = {
  id: string;
  title: string;
  purpose: string;
  steps: string[];
  notes: string[];
};

type PlaybooksBundle = {
  playbook_version: string;
  generated_at: string;
  playbooks: Playbook[];
};

export default function ExaminerPlaybooksPage() {
  const searchParams = useSearchParams();
  const grantId = searchParams?.get("grant_id") ?? "";

  const [bundle, setBundle] = useState<PlaybooksBundle | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/examiner/playbooks?format=json");
        const json = await res.json();
        if (json.ok) {
          setBundle(json.playbooks);
          setHash(json.playbook_hash ?? null);
        } else {
          setError(json.error?.message ?? "Failed to load playbooks.");
        }
      } catch {
        setError("Unable to load playbooks.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="text-sm text-gray-500 py-12 text-center">
        Loading playbooks...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="text-sm font-medium text-red-800 mb-1">Error</div>
        <div className="text-xs text-red-600">{error}</div>
      </div>
    );
  }

  const playbooks = bundle?.playbooks ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Examiner Playbooks
        </h2>
        {hash && (
          <span className="text-[10px] text-gray-400 font-mono">
            Hash: {hash.slice(0, 12)}…
          </span>
        )}
      </div>

      {bundle && (
        <div className="text-xs text-gray-500">
          Version {bundle.playbook_version} — Generated{" "}
          {new Date(bundle.generated_at).toLocaleString()}
        </div>
      )}

      {/* Playbook List */}
      <div className="space-y-3">
        {playbooks.map((pb) => (
          <div
            key={pb.id}
            className="bg-white border border-gray-200 rounded-lg"
          >
            <button
              onClick={() => toggleExpand(pb.id)}
              className="w-full text-left px-4 py-3 flex items-center justify-between"
            >
              <div>
                <div className="text-xs font-medium text-gray-900">
                  {pb.title}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {pb.purpose}
                </div>
              </div>
              <span className="text-gray-400 text-xs">
                {expanded.has(pb.id) ? "−" : "+"}
              </span>
            </button>

            {expanded.has(pb.id) && (
              <div className="px-4 pb-3 border-t border-gray-100 pt-3">
                <div className="text-[10px] text-gray-500 mb-1">Steps</div>
                <ol className="space-y-1 text-xs text-gray-700 list-decimal list-inside">
                  {pb.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                {pb.notes.length > 0 && (
                  <>
                    <div className="text-[10px] text-gray-500 mt-3 mb-1">
                      Notes
                    </div>
                    <ul className="space-y-0.5 text-xs text-gray-600">
                      {pb.notes.map((note, i) => (
                        <li key={i} className="text-[10px]">
                          • {note}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {grantId && (
        <a
          href={`/examiner-portal?grant_id=${encodeURIComponent(grantId)}`}
          className="text-xs text-blue-600 hover:text-blue-800 inline-block"
        >
          ← Back to portal
        </a>
      )}
    </div>
  );
}
