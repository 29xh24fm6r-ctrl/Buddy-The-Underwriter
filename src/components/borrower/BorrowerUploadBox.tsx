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

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    setUploading(true);
    setStatus("uploading");

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const res = await fetch(`/api/deals/${dealId}/documents/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Upload failed. Please try again.");
        setStatus("idle");
        return;
      }

      setStatus("received");
      setTimeout(() => {
        setStatus("idle");
        onUploadComplete?.();
      }, 2000);
    } catch (err) {
      console.error("Upload error:", err);
      alert("Something went wrong. Please try again.");
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
        </>
      )}
    </div>
  );
}
