"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Phase 15 — Core Documents Panel (Structured Slots)
// ---------------------------------------------------------------------------

const glassPanel =
  "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

type SlotAttachment = {
  attachment_id: string;
  document_id: string;
  attached_by_role: string;
  attached_at: string;
  document: {
    id: string;
    original_filename: string;
    display_name: string | null;
    document_type: string | null;
    canonical_type: string | null;
    ai_confidence: number | null;
    ai_doc_type: string | null;
    ai_tax_year: number | null;
    artifact_status: string | null;
    checklist_key: string | null;
    finalized_at: string | null;
    gatekeeper_route: string | null;
    gatekeeper_doc_type: string | null;
    gatekeeper_needs_review: boolean | null;
    gatekeeper_tax_year: number | null;
  } | null;
};

type Slot = {
  id: string;
  deal_id: string;
  slot_key: string;
  slot_group: string;
  required: boolean;
  required_doc_type: string;
  required_tax_year: number | null;
  owner_id: string | null;
  owner_display_name: string | null;
  status: "empty" | "attached" | "validated" | "rejected" | "completed";
  validation_reason: string | null;
  sort_order: number;
  attachment: SlotAttachment | null;
  // Phase 15B
  slot_mode: "UPLOAD" | "INTERACTIVE";
  interactive_kind: string | null;
  help_title: string | null;
  help_reason: string | null;
  help_examples: string[] | null;
  help_alternatives: string[] | null;
};

type Props = {
  dealId: string;
  gatekeeperPrimaryRouting?: boolean;
};

// ---------------------------------------------------------------------------
// Slot group display labels
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<string, string> = {
  BUSINESS_TAX_RETURN: "Business Tax Returns",
  PERSONAL_TAX_RETURN: "Personal Tax Returns",
  PFS: "Personal Financial Statement",
  INCOME_STATEMENT: "Financial Statements",
  BALANCE_SHEET: "Financial Statements",
  SBA_FORMS: "SBA Required Forms",
  STARTUP_PACKAGE: "Startup Package",
  SELLER_FINANCIALS: "Seller / Target Financials",
  ACQUISITION_PACKAGE: "Acquisition Documents",
};

function slotLabel(slot: Slot): string {
  if (slot.owner_display_name) {
    const base = GROUP_LABELS[slot.slot_group] ?? slot.slot_group;
    return slot.required_tax_year
      ? `${base} (${slot.owner_display_name}) — ${slot.required_tax_year}`
      : `${base} (${slot.owner_display_name})`;
  }

  if (slot.required_tax_year) {
    const base =
      slot.slot_group === "BUSINESS_TAX_RETURN"
        ? "Business Tax Return"
        : slot.slot_group === "PERSONAL_TAX_RETURN"
          ? "Personal Tax Return"
          : slot.required_doc_type;
    return `${base} — ${slot.required_tax_year}`;
  }

  // Use help_title if available (Phase 15B SBA slots)
  if (slot.help_title) return slot.help_title;

  switch (slot.slot_key) {
    case "PFS_CURRENT":
      return "Personal Financial Statement";
    case "INCOME_STATEMENT_YTD":
      return "YTD Income Statement";
    case "BALANCE_SHEET_CURRENT":
      return "Current Balance Sheet";
    case "BUSINESS_PLAN":
      return "Business Plan";
    case "PROJECTIONS_3YR":
      return "3-Year Financial Projections";
    case "OWNER_RESUME":
      return "Owner Resume";
    case "PURCHASE_AGREEMENT":
      return "Purchase Agreement";
    case "PRO_FORMA":
      return "Pro Forma Projections";
    case "BUYER_ENTITY_DOCS":
      return "Buyer Entity Documents";
    case "SBA_1919":
      return "SBA Form 1919";
    case "SBA_413":
      return "SBA Form 413 (PFS)";
    case "SBA_DEBT_SCHEDULE":
      return "Business Debt Schedule";
    default:
      return slot.slot_key.replace(/_/g, " ");
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

type BadgeColor = "gray" | "amber" | "blue" | "emerald" | "red";

function statusBadgeColor(slot: Slot): BadgeColor {
  if (slot.status === "empty") return "gray";
  if (slot.status === "rejected") return "amber"; // informational mismatch, not error
  if (slot.status === "validated" || slot.status === "completed") return "emerald";

  // "attached" — check if still processing
  const artifactStatus = slot.attachment?.document?.artifact_status;
  if (artifactStatus === "queued" || artifactStatus === "processing") return "amber";
  return "blue";
}

function statusLabel(slot: Slot): string {
  if (slot.status === "empty") return "Empty";
  if (slot.status === "rejected") return "Mismatch"; // informational, not rejection
  if (slot.status === "validated") return "Validated";
  if (slot.status === "completed") return "Completed";

  const artifactStatus = slot.attachment?.document?.artifact_status;
  if (artifactStatus === "queued" || artifactStatus === "processing") return "Processing";
  return "Attached";
}

const BADGE_STYLES: Record<BadgeColor, string> = {
  gray: "bg-white/10 text-white/50 border-white/10",
  amber: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  blue: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  red: "bg-red-500/20 text-red-400 border-red-500/30",
};

// ---------------------------------------------------------------------------
// Group slots into display sections
// ---------------------------------------------------------------------------

type SlotSection = {
  label: string;
  slots: Slot[];
};

function groupSlots(slots: Slot[]): SlotSection[] {
  const sections: SlotSection[] = [];
  const grouped: Record<string, Slot[]> = {};

  for (const slot of slots) {
    // Merge INCOME_STATEMENT and BALANCE_SHEET into "Financial Statements"
    const groupKey =
      slot.slot_group === "INCOME_STATEMENT" || slot.slot_group === "BALANCE_SHEET"
        ? "_FINANCIAL_STATEMENTS"
        : slot.slot_group;

    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(slot);
  }

  // Order: BTR, PTR, Financial Statements, PFS, SBA Forms, Startup, Seller, Acquisition
  const ORDER = [
    "BUSINESS_TAX_RETURN",
    "PERSONAL_TAX_RETURN",
    "_FINANCIAL_STATEMENTS",
    "PFS",
    "SBA_FORMS",
    "STARTUP_PACKAGE",
    "SELLER_FINANCIALS",
    "ACQUISITION_PACKAGE",
  ];

  for (const key of ORDER) {
    const group = grouped[key];
    if (!group || group.length === 0) continue;

    let label: string;
    switch (key) {
      case "BUSINESS_TAX_RETURN":
        label = "Business Tax Returns";
        break;
      case "PERSONAL_TAX_RETURN":
        label = "Personal Tax Returns";
        break;
      case "_FINANCIAL_STATEMENTS":
        label = "Financial Statements";
        break;
      case "PFS":
        label = "Personal Financial Statement";
        break;
      case "SBA_FORMS":
        label = "SBA Required Forms";
        break;
      case "STARTUP_PACKAGE":
        label = "Startup Package";
        break;
      case "SELLER_FINANCIALS":
        label = "Seller / Target Financials";
        break;
      case "ACQUISITION_PACKAGE":
        label = "Acquisition Documents";
        break;
      default:
        label = GROUP_LABELS[key] ?? key;
    }

    sections.push({ label, slots: group });
  }

  // Any remaining groups
  for (const key of Object.keys(grouped)) {
    if (ORDER.includes(key)) continue;
    sections.push({ label: key, slots: grouped[key] });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoreDocumentsPanel({ dealId, gatekeeperPrimaryRouting = false }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSlotRef = useRef<string | null>(null);

  const fetchSlots = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/slots`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok && json.slots) {
        setSlots(json.slots);
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  // Initial fetch + polling
  useEffect(() => {
    fetchSlots();
    const interval = setInterval(fetchSlots, 5000);
    return () => clearInterval(interval);
  }, [fetchSlots]);

  // Upload handler
  const handleUploadClick = (slotId: string) => {
    activeSlotRef.current = slotId;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slotId = activeSlotRef.current;
    if (!file || !slotId) return;

    // Reset input
    e.target.value = "";
    setUploadingSlot(slotId);

    try {
      // Step 1: Get signed URL
      const signRes = await fetch(`/api/deals/${dealId}/files/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        }),
      });
      const signData = await signRes.json();
      if (!signData?.ok || !signData?.upload?.signed_url) {
        throw new Error(signData?.error || "Failed to get upload URL");
      }

      const { file_id, object_path, signed_url, upload_session_id } = signData.upload;

      // Step 2: Upload bytes directly to storage
      const putRes = await fetch(signed_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Storage upload failed: ${putRes.status}`);
      }

      // Step 3: Record metadata with slot_id
      const recordRes = await fetch(`/api/deals/${dealId}/files/record`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(upload_session_id
            ? { "x-buddy-upload-session-id": upload_session_id }
            : {}),
        },
        body: JSON.stringify({
          file_id,
          object_path,
          session_id: upload_session_id,
          original_filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          slot_id: slotId,
        }),
      });
      const recordData = await recordRes.json();
      if (!recordData?.ok) {
        throw new Error(recordData?.error || "Failed to record upload");
      }

      // Refresh slots to show new state
      await fetchSlots();
    } catch (err: any) {
      console.error("[CoreDocumentsPanel] upload failed", err);
    } finally {
      setUploadingSlot(null);
      activeSlotRef.current = null;
    }
  };

  if (loading && slots.length === 0) {
    return (
      <div className={cn(glassPanel, "overflow-hidden")}>
        <div className={glassHeader}>
          <h3 className="text-sm font-semibold text-white/80">Core Documents</h3>
        </div>
        <div className="px-5 py-4 text-sm text-white/40">Loading...</div>
      </div>
    );
  }

  if (slots.length === 0) {
    return null; // No slots = deal hasn't been ignited yet
  }

  const sections = groupSlots(slots);
  const totalSlots = slots.length;
  const filledSlots = slots.filter(
    (s) => s.status === "attached" || s.status === "validated" || s.status === "completed",
  ).length;
  const validatedSlots = slots.filter(
    (s) => s.status === "validated" || s.status === "completed",
  ).length;

  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className={cn(glassHeader, "flex items-center justify-between")}>
        <h3 className="text-sm font-semibold text-white/80">Core Documents</h3>
        <span className="text-xs text-white/40">
          {validatedSlots}/{totalSlots} validated
        </span>
      </div>

      {/* Gatekeeper primary routing indicator */}
      {gatekeeperPrimaryRouting && (
        <p className="px-5 pt-1.5 text-[10px] text-white/25">
          Routing based on document content
        </p>
      )}

      {/* Progress bar */}
      <div className="px-5 pt-3 pb-1">
        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              validatedSlots === totalSlots
                ? "bg-emerald-500"
                : "bg-sky-500",
            )}
            style={{
              width: `${totalSlots > 0 ? (filledSlots / totalSlots) * 100 : 0}%`,
            }}
          />
        </div>
      </div>

      {/* Slot sections */}
      <div className="divide-y divide-white/5">
        {sections.map((section) => (
          <SlotSection
            key={section.label}
            section={section}
            dealId={dealId}
            uploadingSlot={uploadingSlot}
            onUploadClick={handleUploadClick}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slot section (collapsible group)
// ---------------------------------------------------------------------------

function SlotSection({
  section,
  dealId,
  uploadingSlot,
  onUploadClick,
}: {
  section: SlotSection;
  dealId: string;
  uploadingSlot: string | null;
  onUploadClick: (slotId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-5 py-2.5 text-xs font-medium text-white/60 hover:text-white/80 transition-colors"
      >
        <span>{section.label}</span>
        <svg
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            collapsed && "-rotate-90",
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="pb-1">
          {section.slots.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              dealId={dealId}
              isUploading={uploadingSlot === slot.id}
              onUploadClick={onUploadClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gatekeeper route badge
// ---------------------------------------------------------------------------

const GATEKEEPER_BADGE_CONFIG: Record<string, { label: string; style: string }> = {
  GOOGLE_DOC_AI_CORE: {
    label: "Core (DocAI)",
    style: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  },
  STANDARD: {
    label: "Standard",
    style: "bg-white/10 text-white/50 border-white/10",
  },
  NEEDS_REVIEW: {
    label: "Needs Review",
    style: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
};

function GatekeeperBadge({
  route,
  docType,
  taxYear,
}: {
  route: string;
  docType: string | null;
  taxYear: number | null;
}) {
  const cfg = GATEKEEPER_BADGE_CONFIG[route];
  if (!cfg) return null;

  const extra = [docType, taxYear].filter(Boolean).join(" ");

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
        cfg.style,
      )}
      title={extra ? `${cfg.label}: ${extra}` : cfg.label}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Slot row
// ---------------------------------------------------------------------------

function SlotRow({
  slot,
  dealId,
  isUploading,
  onUploadClick,
}: {
  slot: Slot;
  dealId: string;
  isUploading: boolean;
  onUploadClick: (slotId: string) => void;
}) {
  const color = statusBadgeColor(slot);
  const label = statusLabel(slot);
  const isProcessing = color === "amber";
  const hasDoc = slot.attachment?.document;

  return (
    <div className="group flex items-center gap-3 px-5 py-2 hover:bg-white/[0.02] transition-colors">
      {/* Status dot */}
      <div
        className={cn(
          "h-2 w-2 rounded-full flex-shrink-0",
          color === "gray" && "bg-white/20",
          color === "amber" && "bg-amber-400 animate-pulse",
          color === "blue" && "bg-sky-400",
          color === "emerald" && "bg-emerald-400",
          color === "red" && "bg-red-400",
        )}
      />

      {/* Label + doc info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white/80 truncate">
            {slotLabel(slot)}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
              BADGE_STYLES[color],
            )}
          >
            {label}
          </span>
          {hasDoc?.gatekeeper_route && (
            <GatekeeperBadge
              route={hasDoc.gatekeeper_route}
              docType={hasDoc.gatekeeper_doc_type}
              taxYear={hasDoc.gatekeeper_tax_year}
            />
          )}
        </div>

        {/* Attached doc filename */}
        {hasDoc && (
          <Link
            href={`/deals/${dealId}/documents/${slot.attachment!.document_id}`}
            className="text-xs text-white/40 hover:text-white/60 truncate block mt-0.5"
          >
            {hasDoc.display_name || hasDoc.original_filename}
          </Link>
        )}

        {/* Mismatch info (informational, not error) */}
        {slot.status === "rejected" && slot.validation_reason && (
          <p className="text-xs text-amber-400/80 mt-0.5">
            {slot.validation_reason.replace("mismatch_info: ", "")}
          </p>
        )}

        {/* Gatekeeper detected type differs from slot requirement */}
        {hasDoc?.gatekeeper_doc_type && slot.required_doc_type &&
          hasDoc.gatekeeper_doc_type.toUpperCase() !== slot.required_doc_type.toUpperCase() && (
          <span className="text-[10px] text-amber-400/60 mt-0.5 block">
            Detected: {hasDoc.gatekeeper_doc_type.replace(/_/g, " ")}
          </span>
        )}

        {/* Help reason (Phase 15B) */}
        {slot.help_reason && slot.status === "empty" && (
          <p className="text-xs text-white/30 mt-0.5 line-clamp-1">
            {slot.help_reason}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Upload/Replace/Complete button */}
        {(slot.status === "empty" || slot.status === "rejected") && (
          <button
            type="button"
            onClick={() => onUploadClick(slot.id)}
            disabled={isUploading || slot.slot_mode === "INTERACTIVE"}
            className={cn(
              "rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white/90 transition-colors",
              (isUploading || slot.slot_mode === "INTERACTIVE") && "opacity-50 cursor-not-allowed",
            )}
          >
            {isUploading
              ? "Uploading..."
              : slot.slot_mode === "INTERACTIVE"
                ? "Complete (soon)"
                : "Upload"}
          </button>
        )}

        {(slot.status === "attached" || slot.status === "validated") && !isProcessing && (
          <button
            type="button"
            onClick={() => onUploadClick(slot.id)}
            disabled={isUploading}
            className={cn(
              "rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/40 hover:bg-white/10 hover:text-white/70 transition-colors opacity-0 group-hover:opacity-100",
              isUploading && "opacity-50 cursor-not-allowed",
            )}
          >
            {isUploading ? "Uploading..." : "Replace"}
          </button>
        )}
      </div>
    </div>
  );
}
