"use client";

import { ScreenArtifactContent } from "@/lib/screens/templates";

type ScreenRendererProps = {
  content: ScreenArtifactContent;
  onAction?: (action: string) => void;
};

export function ScreenRenderer(props: ScreenRendererProps) {
  const { content, onAction } = props;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
        <h1 className="text-2xl font-semibold text-slate-900">
          {content.header.title}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {content.header.subtitle}
        </p>
      </div>

      {/* Sections */}
      {content.sections.map((section, idx) => (
        <div
          key={idx}
          className="rounded-lg border border-slate-200 bg-slate-50/50 p-4"
        >
          <h3 className="mb-3 text-sm font-medium text-slate-900">
            {section.title}
          </h3>

          {/* Section content by type */}
          <div className="mt-4">
            {section.type === "cards" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(section.items || []).map((item, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-slate-200 bg-white p-3"
                  >
                    <div className="text-xs text-slate-600">{item.label}</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">
                      {item.value}
                    </div>
                    {item.status && (
                      <StatusBadge status={item.status} className="mt-2" />
                    )}
                  </div>
                ))}
              </div>
            )}

            {section.type === "table" && (
              <div className="space-y-1">
                {(section.items || []).map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-6 py-2"
                  >
                    <span className="text-sm text-slate-600">
                      {item.label}
                    </span>
                    <span className="text-sm font-medium text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            )}

            {section.type === "list" && (
              <div className="space-y-1">
                {(section.items || []).map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-6 py-2"
                  >
                    <span className="text-sm text-slate-600">{item.label}</span>
                    <span className="text-sm font-medium text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            )}

            {section.type === "text" && (
              <div className="space-y-2">
                {(section.items || []).map((item, i) => (
                  <div key={i} className="text-sm text-slate-600">
                    {item.value}
                  </div>
                ))}
              </div>
            )}

            {section.type === "form" && (
              <div className="space-y-4">
                {(section.items || []).map((item, i) => (
                  <div key={i}>
                    <label className="text-sm text-slate-600">
                      {item.label}
                    </label>
                    <input
                      type="text"
                      placeholder={item.value}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section actions */}
          {section.actions && section.actions.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {section.actions.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onAction?.(action.action)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({
  status,
  className = "",
}: {
  status: "neutral" | "good" | "warn" | "bad";
  className?: string;
}) {
  const styles = {
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    bad: "border-rose-200 bg-rose-50 text-rose-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${styles[status]} ${className}`}
    >
      {status}
    </span>
  );
}
