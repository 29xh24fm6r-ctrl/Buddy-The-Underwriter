/**
 * /deals/[dealId]/decision/overrides - Override management UI
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

type Props = { params: Promise<{ dealId: string }> };

export default async function OverridesPage({ params }: Props) {
  const { dealId } = await params;
  await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data: overrides } = await sb
    .from("decision_overrides")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Decision Overrides</h1>
      <p className="text-gray-600">
        Human overrides applied to automated decision logic ({overrides?.length || 0} total)
      </p>

      {!overrides || overrides.length === 0 ? (
        <div className="border rounded-lg p-8 text-center text-gray-500">
          No overrides applied to this deal
        </div>
      ) : (
        <div className="space-y-4">
          {overrides.map((ov: any) => (
            <div
              key={ov.id}
              className={`border rounded-lg p-4 ${
                ov.severity === "critical"
                  ? "border-red-300 bg-red-50"
                  : ov.severity === "high"
                    ? "border-orange-300 bg-orange-50"
                    : "bg-white"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-semibold">{ov.field_path}</div>
                <div
                  className={`text-xs px-2 py-1 rounded ${
                    ov.severity === "critical"
                      ? "bg-red-200 text-red-800"
                      : ov.severity === "high"
                        ? "bg-orange-200 text-orange-800"
                        : "bg-gray-200 text-gray-800"
                  }`}
                >
                  {ov.severity || "normal"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-2 text-sm">
                <div>
                  <span className="text-gray-600">Old:</span> {ov.old_value}
                </div>
                <div>
                  <span className="text-gray-600">New:</span> {ov.new_value}
                </div>
              </div>

              <div className="text-sm text-gray-700 mb-1">
                <span className="font-medium">Reason:</span> {ov.reason}
              </div>

              {ov.justification && (
                <div className="text-sm text-gray-600">
                  <span className="font-medium">Justification:</span> {ov.justification}
                </div>
              )}

              <div className="text-xs text-gray-400 mt-2">
                {new Date(ov.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
