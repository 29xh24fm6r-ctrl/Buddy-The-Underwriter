"use client";

export function MilestoneChip({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
        active
          ? "border-emerald-500/30 bg-emerald-600/20 text-emerald-300"
          : "border-white/10 bg-white/5 text-white/50",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-2 w-2 rounded-full",
          active ? "bg-emerald-400" : "border border-white/30",
        ].join(" ")}
      />
      {label}
    </span>
  );
}
