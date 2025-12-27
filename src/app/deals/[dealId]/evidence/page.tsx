import { getSupabaseServerClient } from "@/lib/supabase/server";

type Params = Promise<{ dealId: string }>;
type SearchParams = Promise<{ upload_id?: string; chunk_id?: string }>;

export default async function EvidencePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { dealId } = await params;
  const { upload_id: uploadId = "", chunk_id: chunkId = "" } = await searchParams;

  const sb = getSupabaseServerClient();

  // fetch target chunk
  const { data: target } = await sb
    .from("deal_doc_chunks")
    .select("id, deal_id, upload_id, chunk_index, content, page_start, page_end")
    .eq("deal_id", dealId)
    .eq("id", chunkId)
    .maybeSingle();

  // fetch neighbors by chunk_index if possible
  let neighbors: any[] = [];
  if (target?.upload_id && typeof target?.chunk_index === "number") {
    const { data } = await sb
      .from("deal_doc_chunks")
      .select("id, chunk_index, content")
      .eq("deal_id", dealId)
      .eq("upload_id", target.upload_id)
      .gte("chunk_index", Math.max(0, target.chunk_index - 2))
      .lte("chunk_index", target.chunk_index + 2)
      .order("chunk_index", { ascending: true });
    neighbors = data || [];
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Evidence</h1>

      <div className="text-sm border rounded-md p-3">
        <div className="font-mono text-xs opacity-70">
          deal_id={dealId}
          {uploadId ? ` · upload_id=${uploadId}` : ""}
          {chunkId ? ` · chunk_id=${chunkId}` : ""}
        </div>
      </div>

      {!target ? (
        <div className="text-sm opacity-70">
          Could not find chunk. (Maybe this was synthetic data or the ids don't match.)
        </div>
      ) : (
        <div className="space-y-3">
          <div className="border rounded-md p-4">
            <div className="font-mono text-xs opacity-70">
              upload_id={target.upload_id} · chunk_index={target.chunk_index}
            </div>
            <div className="mt-2 text-sm whitespace-pre-wrap">{target.content}</div>
          </div>

          {neighbors.length ? (
            <div className="border rounded-md p-4 space-y-2">
              <div className="text-sm font-medium">Nearby chunks</div>
              {neighbors.map((n) => (
                <div
                  key={n.id}
                  className={`text-sm border rounded-md p-3 ${
                    n.id === target.id ? "bg-gray-50" : ""
                  }`}
                >
                  <div className="font-mono text-[11px] opacity-70">chunk_index={n.chunk_index}</div>
                  <div className="mt-1 whitespace-pre-wrap">{n.content}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
