"use client";

import { useState } from "react";

type ExportModalProps = {
  shareUrl: string;
  onClose: () => void;
};

export function ExportModal(props: ExportModalProps) {
  const { shareUrl, onClose } = props;
  const [copied, setCopied] = useState(false);

  const fullUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${shareUrl}`
      : shareUrl;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Share this screen
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Anyone with this link can view this screen
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <div className="mt-6">
          <label className="text-xs text-slate-400">Shareable link</label>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={fullUrl}
              readOnly
              className="flex-1 rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-sm text-white focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-lg">🔗</div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-white">
                Link expires: Never
              </div>
              <div className="mt-1 text-xs text-slate-400">
                This screen is public and will remain accessible. Save it to
                your account to edit or continue.
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
