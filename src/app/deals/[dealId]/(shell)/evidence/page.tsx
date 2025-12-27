"use client";

import dynamic from "next/dynamic";

const PdfEvidenceSpansViewer = dynamic(
  async () => {
    try {
      const mod = await import("@/components/evidence/PdfEvidenceSpansViewer");
      return mod.default;
    } catch {
      return function Missing() {
        return null;
      };
    }
  },
  { ssr: false }
);

function parseBbox(v: string | null) {
  if (!v) return null;
  try {
    const j = JSON.parse(v);
    if (typeof j?.x === "number") return j;
  } catch {}
  return null;
}

export default async function DealEvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dealId } = await params;
  const sp = await searchParams;

  const kind = (sp.kind as string) ?? "pdf";
  const sourceId = (sp.sourceId as string) ?? "";
  const label = (sp.label as string) ?? sourceId;
  const page = sp.page ? Number(sp.page as string) : undefined;
  const bbox = parseBbox((sp.bbox as string) ?? null);
  const spanIds = typeof sp.spanIds === "string" ? (sp.spanIds as string).split(",").filter(Boolean) : [];

  return (
    <div className="space-y-3">
      <div>
        <div className="text-lg font-semibold">Evidence</div>
        <div className="text-sm text-muted-foreground">
          {label} {page ? `• page ${page}` : ""} {kind ? `• ${kind}` : ""}
        </div>
      </div>

      <div className="rounded-2xl border border-border-dark bg-[#0b0d10] p-4">
        {/* If PdfEvidenceSpansViewer exists, use it. Otherwise show a wired fallback. */}
        <PdfEvidenceSpansViewer
          // NOTE: adapt these prop names if your component differs.
          // This page is the single integration point for citation→viewer.
          dealId={dealId}
          attachmentId={sourceId}
          // Optional props that may be supported:
          // page={page}
          // bbox={bbox ?? undefined}
          // spanIds={spanIds}
        />

        <div className="mt-3 text-sm text-muted-foreground">
          Evidence viewer integration point. Viewing: <span className="font-mono">{sourceId}</span>
          {page ? ` at page ${page}` : ""}
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          If the PDF viewer is not rendering, ensure <span className="font-mono">src/components/evidence/PdfEvidenceSpansViewer.tsx</span> exists.
          Current props: dealId, attachmentId (sourceId).
        </div>
      </div>
    </div>
  );
}
