// src/components/borrower/BulkUploadZone.tsx
"use client";

import React, { useRef, useState } from "react";
import { usePortalUpload } from "./hooks/usePortalUpload";

interface Props {
  token: string;
  onComplete?: () => void;
}

export default function BulkUploadZone({ token, onComplete }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const { uploadFiles, state, clear } = usePortalUpload(token);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    await uploadFiles(files);
    
    // Auto-refresh parent after successful upload
    if (onComplete) {
      setTimeout(() => {
        onComplete();
        clear();
      }, 3000);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      void handleFiles(e.target.files);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
      {/* Confirmation banner (shows after upload completes) */}
      {state.status === "success" && state.last && (
        <div className="border-b bg-green-50 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="h-3 w-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-green-900">
                {state.last.uploaded?.length || 0} file{(state.last.uploaded?.length || 0) === 1 ? "" : "s"} uploaded successfully
              </div>
              {state.last.activity && state.last.activity.length > 0 && (
                <div className="mt-2 space-y-1">
                  {state.last.activity.map((act, idx) => (
                    <div key={idx} className="text-sm text-green-700">
                      {act.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={clear}
              className="text-green-500 hover:text-green-700"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {state.status === "error" && (
        <div className="border-b bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-5 w-5 flex-shrink-0 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="h-3 w-3 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-red-900">Upload failed</div>
              <div className="mt-1 text-sm text-red-700">{state.error}</div>
            </div>
            <button
              type="button"
              onClick={clear}
              className="text-red-500 hover:text-red-700"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="p-6">
        <div className="mb-4">
          <div className="text-lg font-semibold tracking-tight">Upload documents</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Drag & drop files here, or click to browse. You can upload multiple files at once.
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={`
            relative rounded-xl border-2 border-dashed p-8 text-center transition-colors
            ${dragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"}
            ${state.status === "uploading" ? "pointer-events-none opacity-60" : "cursor-pointer"}
          `}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={handleClick}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleInputChange}
            disabled={state.status === "uploading"}
          />

          {state.status === "uploading" ? (
            <div className="space-y-3">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500" />
              <div className="text-sm font-medium">Uploading files…</div>
              <div className="text-xs text-muted-foreground">
                Please wait while we process your documents
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="text-sm font-medium text-gray-900">
                <span className="text-blue-600 hover:text-blue-700">Click to browse</span>
                {" "}or drag files here
              </div>
              <div className="text-xs text-gray-500">
                Upload one file or an entire folder at once
              </div>
            </div>
          )}
        </div>

        {/* File list preview (removed upload stats since we don't track that) */}
      </div>
    </div>
  );
}
