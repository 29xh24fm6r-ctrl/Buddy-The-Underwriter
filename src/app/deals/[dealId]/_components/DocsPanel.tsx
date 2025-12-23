export function DocsPanel({ ctx }: { dealId: string; ctx: any }) {
  const uploads = (ctx?.borrower_uploads ?? []) as any[];
  const requests = (ctx?.borrower_document_requests ?? []) as any[];

  return (
    <div id="docs" className="rounded-2xl border border-white/10 bg-black/40 p-5">
      <div className="text-lg font-semibold text-white">Documents</div>
      <div className="text-sm text-white/60">Borrower uploads + requests (source of truth)</div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <List title={`Uploads (${uploads.length})`} rows={uploads.slice(0, 12)} />
        <List title={`Doc Requests (${requests.length})`} rows={requests.slice(0, 12)} />
      </div>
    </div>
  );
}

function List({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="mt-2 space-y-2">
        {rows.length === 0 ? (
          <div className="text-sm text-white/50">None</div>
        ) : (
          rows.map((r, idx) => (
            <div key={idx} className="rounded-lg border border-white/10 bg-black/40 p-3">
              <div className="text-sm text-white">{r.name ?? r.filename ?? r.title ?? r.kind ?? "Upload"}</div>
              <div className="mt-1 text-xs text-white/60 break-all">
                {r.id} • {r.status ?? r.state ?? "—"}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
