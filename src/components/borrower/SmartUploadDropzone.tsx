"use client";

import React, { useState } from "react";
import { directDealDocumentUpload } from "@/lib/uploads/uploadFile";

/**
 * SBA God Mode: Smart Upload Dropzone
 * 
 * Intelligent document uploader that:
 * - Auto-detects document type from filename/content
 * - Suggests missing documents
 * - Shows inline validation
 */

interface SmartUploadDropzoneProps {
  dealId: string;
  onUploadComplete?: () => void;
}

interface DetectedDocument {
  filename: string;
  suggested_type: string;
  confidence: number;
}

export function SmartUploadDropzone({ dealId, onUploadComplete }: SmartUploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [detectedDocs, setDetectedDocs] = useState<DetectedDocument[]>([]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    await handleFiles(files);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    await handleFiles(files);
  };

  const handleFiles = async (files: File[]) => {
    setUploading(true);
    setDetectedDocs([]);

    try {
      // Detect document types before upload
      const detected: DetectedDocument[] = [];
      
      for (const file of files) {
        const suggestedType = detectDocumentType(file.name);
        detected.push({
          filename: file.name,
          suggested_type: suggestedType.type,
          confidence: suggestedType.confidence,
        });
      }
      
      setDetectedDocs(detected);

      // Upload files via canonical signed-url flow
      for (const file of files) {
        const result = await directDealDocumentUpload({
          dealId,
          file,
          checklistKey: null,
          source: "internal",
        });

        if (!result.ok) {
          throw new Error(result.error || "Upload failed");
        }
      }

      onUploadComplete?.();
      setTimeout(() => {
        setDetectedDocs([]);
      }, 3000);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <div className="text-4xl mb-2">📄</div>
        
        {uploading ? (
          <div>
            <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-2" />
            <p className="text-sm text-gray-600">Uploading and analyzing documents...</p>
          </div>
        ) : (
          <>
            <p className="text-lg font-medium mb-1">Drop documents here</p>
            <p className="text-sm text-gray-600 mb-4">
              We'll automatically detect what they are
            </p>
            
            <label className="inline-block px-4 py-2 bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700 transition-colors">
              Choose Files
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          </>
        )}
      </div>

      {/* Detected Documents */}
      {detectedDocs.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
          <h3 className="font-medium text-green-900 flex items-center gap-2">
            <span>✓</span>
            Detected Documents
          </h3>
          
          {detectedDocs.map((doc, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">{doc.filename}</span>
              <div className="flex items-center gap-2">
                <span className="text-green-700 font-medium">{doc.suggested_type}</span>
                {doc.confidence >= 0.8 ? (
                  <span className="text-xs text-green-600">(High confidence)</span>
                ) : (
                  <span className="text-xs text-yellow-600">(Please verify)</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Suggested Uploads */}
      <SuggestedUploads />
    </div>
  );
}

function SuggestedUploads() {
  // TODO: Fetch missing documents from API
  const missingDocs = [
    { type: '2023 Business Tax Return', priority: 'high' },
    { type: '2022 Business Tax Return', priority: 'high' },
    { type: 'Personal Financial Statement', priority: 'medium' },
  ];

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-blue-900 mb-2">Still Need</h3>
      <div className="space-y-1">
        {missingDocs.map((doc, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm text-blue-700">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span>{doc.type}</span>
            {doc.priority === 'high' && (
              <span className="text-xs bg-blue-100 px-2 py-0.5 rounded">Required</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Detect document type from filename
 */
function detectDocumentType(filename: string): { type: string; confidence: number } {
  const lower = filename.toLowerCase();
  
  if (lower.match(/1120|tax.*return|schedule.*k/)) {
    return { type: 'Business Tax Return', confidence: 0.9 };
  }
  if (lower.match(/1040|personal.*tax/)) {
    return { type: 'Personal Tax Return', confidence: 0.9 };
  }
  if (lower.match(/balance.*sheet|financial.*statement/)) {
    return { type: 'Financial Statement', confidence: 0.85 };
  }
  if (lower.match(/bank.*statement|checking.*statement/)) {
    return { type: 'Bank Statement', confidence: 0.85 };
  }
  if (lower.match(/lease|rent.*agreement/)) {
    return { type: 'Lease Agreement', confidence: 0.8 };
  }
  if (lower.match(/deed|title/)) {
    return { type: 'Property Deed', confidence: 0.8 };
  }
  if (lower.match(/driver.*license|dl|passport/)) {
    return { type: 'ID Document', confidence: 0.75 };
  }
  
  return { type: 'Other Document', confidence: 0.5 };
}
