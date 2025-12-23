export function RawContextPanel({ ctx }: { ctx: any }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
      <div className="text-lg font-semibold text-white">Canonical Context</div>
      <div className="text-sm text-white/60">This is what AI reads</div>

      <pre className="mt-3 max-h-[520px] overflow-auto rounded-xl bg-black/40 p-4 text-xs text-white/70">
        {JSON.stringify(ctx?._meta ? { _meta: ctx._meta, deal_id: ctx.deal_id } : ctx, null, 2)}
      </pre>
    </div>
  );
}
