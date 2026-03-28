"use client";

/**
 * Phase 65J — Review Requirements Table
 */

type Requirement = {
  id: string;
  requirementCode: string;
  title: string;
  borrowerVisible: boolean;
  status: string;
  required: boolean;
  evidenceType: string;
};

type Props = {
  requirements: Requirement[];
};

const STATUS_STYLES: Record<string, string> = {
  pending: "text-white/40",
  requested: "text-amber-400",
  submitted: "text-blue-400",
  under_review: "text-blue-300",
  completed: "text-emerald-400",
  waived: "text-white/30",
};

export default function ReviewRequirementsTable({ requirements }: Props) {
  if (requirements.length === 0) return null;

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <table className="w-full">
        <thead className="glass-header">
          <tr>
            <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase">Requirement</th>
            <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-24">Audience</th>
            <th className="px-4 py-2 text-left text-[11px] font-semibold text-white/70 uppercase w-24">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {requirements.map((r) => (
            <tr key={r.id} className="glass-row">
              <td className="px-4 py-2 text-xs text-white/70">
                {r.title}
                {r.required && <span className="ml-1 text-red-400">*</span>}
              </td>
              <td className="px-4 py-2 text-xs text-white/40">
                {r.borrowerVisible ? "Borrower" : "Banker"}
              </td>
              <td className="px-4 py-2">
                <span className={`text-xs font-medium capitalize ${STATUS_STYLES[r.status] ?? "text-white/40"}`}>
                  {r.status.replace(/_/g, " ")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
