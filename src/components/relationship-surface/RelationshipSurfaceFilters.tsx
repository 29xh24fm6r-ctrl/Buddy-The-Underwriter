"use client";

interface Props {
  priorityBucket: string | null;
  reasonFamily: string | null;
  changedOnly: boolean;
  onPriorityBucketChange: (v: string | null) => void;
  onReasonFamilyChange: (v: string | null) => void;
  onChangedOnlyChange: (v: boolean) => void;
}

const PRIORITY_OPTIONS = [
  { value: "", label: "All Priorities" },
  { value: "critical", label: "Critical" },
  { value: "urgent", label: "Urgent" },
  { value: "watch", label: "Watch" },
  { value: "healthy", label: "Healthy" },
];

const FAMILY_OPTIONS = [
  { value: "", label: "All Families" },
  { value: "integrity", label: "Integrity" },
  { value: "review", label: "Review" },
  { value: "borrower", label: "Borrower" },
  { value: "monitoring", label: "Monitoring" },
  { value: "renewal", label: "Renewal" },
  { value: "growth", label: "Growth" },
  { value: "protection", label: "Protection" },
  { value: "crypto", label: "Crypto" },
  { value: "informational", label: "Informational" },
];

const selectCls =
  "rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white focus:border-blue-500/50 focus:outline-none";

export default function RelationshipSurfaceFilters({
  priorityBucket,
  reasonFamily,
  changedOnly,
  onPriorityBucketChange,
  onReasonFamilyChange,
  onChangedOnlyChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        className={selectCls}
        value={priorityBucket ?? ""}
        onChange={(e) => onPriorityBucketChange(e.target.value || null)}
      >
        {PRIORITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        className={selectCls}
        value={reasonFamily ?? ""}
        onChange={(e) => onReasonFamilyChange(e.target.value || null)}
      >
        {FAMILY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 text-sm text-white/70 cursor-pointer">
        <input
          type="checkbox"
          checked={changedOnly}
          onChange={(e) => onChangedOnlyChange(e.target.checked)}
          className="rounded border-white/20"
        />
        Changed only
      </label>
    </div>
  );
}
