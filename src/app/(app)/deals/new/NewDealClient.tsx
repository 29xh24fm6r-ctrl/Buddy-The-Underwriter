"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { directDealDocumentUpload } from "@/lib/uploads/uploadFile";
import { markUploadsCompleted } from "@/lib/uploads/commitUploadedFile";

export default function NewDealClient({ bankId }: { bankId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dealName, setDealName] = useState(`Deal - ${new Date().toLocaleDateString()}`);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  const handleFiles = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    const fileArray = Array.from(selectedFiles);
    setFiles((prev) => [...prev, ...fileArray]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
    },
    [handleFiles]
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;

    setUploading(true);
    try {
      // 1. Create the deal
      const createRes = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: dealName || `Deal - ${new Date().toLocaleDateString()}` 
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error || "Failed to create deal");
      }

      const { dealId } = await createRes.json();
      console.log(`Created deal ${dealId}, uploading ${files.length} files...`);

      // 2. Upload files to the deal
      setUploadProgress({ current: 0, total: files.length });
      let successCount = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress({ current: i + 1, total: files.length });
        
        const result = await directDealDocumentUpload({
          dealId,
          file,
          checklistKey: null,
          source: "internal",
        });

        if (result.ok) {
          successCount++;
        } else {
          console.error(`Failed to upload ${file.name}:`, result.error);
        }
      }

      console.log(`Uploaded ${successCount}/${files.length} files to deal ${dealId}`);

      // 🔥 CRITICAL: Mark upload batch as complete to unblock auto-seed
      if (successCount > 0) {
        await markUploadsCompleted(dealId, bankId);
        console.log(`✅ Marked uploads completed for deal ${dealId}`);
      }

      // 3. Redirect to the deal cockpit (command center)
      router.push(`/deals/${dealId}/cockpit`);
    } catch (error) {
      console.error("Upload failed:", error);
      alert(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [files, dealName, bankId, router]);

  return (
    <div className="h-full flex flex-col bg-[#0a0d12]">
      {/* Header */}
      <div className="border-b border-gray-800 px-8 py-6 bg-[#0f1318]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">New Deal Intake</h1>
            <p className="text-sm text-gray-400">
              Upload documents to start a new deal package
            </p>
          </div>
          <Link
            href="/deals"
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">
          {/* Deal Name Input */}
          <div className="mb-8">
            <label htmlFor="dealName" className="block text-sm font-medium text-gray-300 mb-2">
              Deal Name
            </label>
            <input
              id="dealName"
              type="text"
              value={dealName}
              onChange={(e) => setDealName(e.target.value)}
              placeholder="Enter deal name..."
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Upload Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              relative border-2 border-dashed rounded-xl p-12 mb-8 transition-all
              ${
                isDragging
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-gray-700 bg-gray-800/30 hover:border-gray-600 hover:bg-gray-800/50"
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileInputChange}
              className="hidden"
              accept=".pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg"
            />

            <div className="flex flex-col items-center text-center">
              <div className="mb-4 p-4 rounded-full bg-blue-500/20 text-blue-400">
                <span className="material-symbols-outlined text-[48px]">
                  cloud_upload
                </span>
              </div>

              <h3 className="text-xl font-semibold text-white mb-2">
                {isDragging ? "Drop files here" : "Drag & Drop Deal Package"}
              </h3>

              <p className="text-sm text-gray-400 mb-6 max-w-md">
                Upload financial statements, tax returns, business documents, and any
                other supporting materials
              </p>

              <div className="flex gap-3">
                <button
                  onClick={handleBrowseClick}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                >
                  Browse Files
                </button>
                <button className="px-6 py-3 bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-200 font-medium rounded-lg transition-colors">
                  Import from Deal Room
                </button>
              </div>

              <p className="mt-4 text-xs text-gray-500">
                Supported: PDF, Excel, Word, Images • Max 500MB per file
              </p>
            </div>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">
                  Selected Files ({files.length})
                </h3>
                <button
                  onClick={() => setFiles([])}
                  className="text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Clear All
                </button>
              </div>

              <div className="space-y-2">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-gray-700/30 rounded-lg"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="material-symbols-outlined text-gray-400">
                        description
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{file.name}</p>
                        <p className="text-xs text-gray-400">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      className="ml-4 p-1 text-gray-400 hover:text-red-400 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        close
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {files.length > 0 && (
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setFiles([])}
                className="px-6 py-3 text-gray-400 hover:text-white transition-colors"
              >
                Clear
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {uploading ? (
                  <>
                    {uploadProgress.current}/{uploadProgress.total}
                    <span className="animate-spin material-symbols-outlined text-[20px]">
                      progress_activity
                    </span>
                    Uploading...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">
                      upload
                    </span>
                    Start Deal Processing
                  </>
                )}
              </button>
            </div>
          )}

          {/* Help Text */}
          <div className="mt-8 p-6 bg-blue-500/10 border border-blue-500/30 rounded-xl">
            <div className="flex gap-4">
              <span className="material-symbols-outlined text-blue-400 flex-shrink-0">
                info
              </span>
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">
                  What happens next?
                </h4>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>
                    • Documents will be automatically classified and extracted
                  </li>
                  <li>• Financial data will be parsed and analyzed</li>
                  <li>• Conditions and requirements will be generated</li>
                  <li>
                    • You'll be notified when the deal is ready for review
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
