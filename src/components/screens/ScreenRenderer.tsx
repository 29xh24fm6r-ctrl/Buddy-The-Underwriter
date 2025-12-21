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
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold text-white">
          {content.header.title}
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          {content.header.subtitle}
        </p>
      </div>

      {/* Sections */}
      {content.sections.map((section, idx) => (
        <div
          key={idx}
          className="rounded-2xl border border-white/10 bg-white/5 p-6"
        >
          <h2 className="text-lg font-semibold text-white">
            {section.title}
          </h2>

          {/* Section content by type */}
          <div className="mt-4">
            {section.type === "cards" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {(section.items || []).map((item, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="text-xs text-slate-400">{item.label}</div>
                    <div className="mt-1 text-2xl font-semibold text-white">
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
              <div className="space-y-2">
                {(section.items || []).map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3"
                  >
                    <div className="text-sm font-medium text-white">
                      {item.label}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm text-slate-300">{item.value}</div>
                      {item.status && <StatusBadge status={item.status} />}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {section.type === "list" && (
              <div className="space-y-2">
                {(section.items || []).map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3"
                  >
                    <div className="text-sm text-white">{item.label}</div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm text-slate-300">{item.value}</div>
                      {item.status && <StatusBadge status={item.status} />}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {section.type === "text" && (
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                {(section.items || []).map((item, i) => (
                  <div key={i} className="text-sm text-slate-200">
                    {item.value}
                  </div>
                ))}
              </div>
            )}

            {section.type === "form" && (
              <div className="space-y-4">
                {(section.items || []).map((item, i) => (
                  <div key={i}>
                    <label className="text-sm text-slate-300">
                      {item.label}
                    </label>
                    <input
                      type="text"
                      placeholder={item.value}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
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
                  className="rounded-lg border border-white/10 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
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
    neutral: "border-white/10 bg-white/5 text-slate-200",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    bad: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${styles[status]} ${className}`}
    >
      {status}
    </span>
  );
}
