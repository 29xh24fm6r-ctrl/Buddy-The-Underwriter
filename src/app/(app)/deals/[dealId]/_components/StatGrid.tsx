export function StatGrid({ ctx }: { ctx: any }) {
  const uploads = ctx?.borrower_uploads?.length ?? 0;
  const requests = ctx?.borrower_document_requests?.length ?? 0;
  const conditions = ctx?.deal_conditions?.length ?? 0;
  const intel = ctx?.borrower_upload_extractions?.length ?? 0;

  const items = [
    { label: "Uploads", value: uploads },
    { label: "Doc Requests", value: requests },
    { label: "Conditions", value: conditions },
    { label: "Intel Runs", value: intel },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className="text-sm text-white/60">{it.label}</div>
          <div className="mt-1 text-2xl font-semibold text-white">{it.value}</div>
        </div>
      ))}
    </div>
  );
}
