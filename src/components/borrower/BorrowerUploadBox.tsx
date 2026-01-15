/**
 * BorrowerUploadBox — Upload feels instant & affirming
 * 
 * Design:
 * - No validation rules shown
 * - No file categories
 * - Just: "Drop here" → "Received" → "We're reviewing this"
 * 
 * If error → plain language only
 */

"use client";

import { useState } from "react";
import { directDealDocumentUpload } from "@/lib/uploads/uploadFile";

interface BorrowerUploadBoxProps {
  dealId: string;
  onUploadComplete?: () => void;
}

export function BorrowerUploadBox({
  dealId,
  onUploadComplete,
}: BorrowerUploadBoxProps) {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "received">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    setUploading(true);
    setStatus("uploading");
    setError(null);

    try {
      for (const file of files) {
        const result = await directDealDocumentUpload({
          dealId,
          file,
          checklistKey: null,
          source: "borrower",
        });
        if (!result.ok) {
          setError(result.error || "Upload failed. Please try again.");
          setStatus("idle");
          return;
        }
      }

      setStatus("received");
      setTimeout(() => {
        setStatus("idle");
        onUploadComplete?.();
      }, 2000);
    } catch (err) {
      console.error("Upload error:", err);
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Reuse the same upload path as drag-drop
    setUploading(true);
    setStatus("uploading");
    setError(null);
    try {
      for (const file of files) {
        const result = await directDealDocumentUpload({
          dealId,
          file,
          checklistKey: null,
          source: "borrower",
        });
        if (!result.ok) {
          setError(result.error || "Upload failed. Please try again.");
          setStatus("idle");
          return;
        }
      }

      setStatus("received");
      setTimeout(() => {
        setStatus("idle");
        onUploadComplete?.();
      }, 2000);
    } catch (err) {
      console.error("Upload error:", err);
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  if (status === "received") {
    return (
      <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-900/10 px-6 py-8 text-center">
        <div className="text-emerald-400 font-medium">Received</div>
        <div className="text-slate-400 text-sm mt-1">We're reviewing this now</div>
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className={`
        rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors
        ${
          uploading
            ? "border-blue-500/50 bg-blue-900/10"
            : "border-slate-700 bg-slate-900/30 hover:border-slate-600 hover:bg-slate-900/50"
        }
      `}
    >
      {uploading ? (
        <div className="text-blue-400">Uploading...</div>
      ) : (
        <>
          <div className="text-slate-300 font-medium">Drop files here</div>
          <div className="text-slate-500 text-sm mt-1">
            Or click to browse
          </div>
          <label className="mt-3 inline-flex cursor-pointer items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Choose files
            <input type="file" multiple className="hidden" onChange={handleFileSelect} />
          </label>
          {error ? (
            <div className="mt-3 text-sm text-red-400">{error}</div>
          ) : null}
        </>
      )}
    </div>
  );
}
